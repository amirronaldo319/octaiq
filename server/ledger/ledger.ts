import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { EventPayload, JointOutcome } from '../../src/engine/eventTypes.ts'

/**
 * An append-only record of what the model said before each event. Entries are never edited, and nothing
 * is recorded once the event has started, so the file's git history is a public, timestamped track record.
 */
export interface LedgerBout {
  id: string
  a: string
  b: string
  probA: number
  probLo?: number
  probHi?: number
  /** Probability the fight goes the distance */
  distance?: number
  joint?: JointOutcome
}

import { createHash } from 'node:crypto'

export interface LedgerEntry {
  recordedAt: string
  model: string
  /** Version of the data and feature pipeline behind this forecast (absent on the first entries) */
  dataVersion?: string
  featurePipeline?: string
  codeCommit?: string
  /** Latest fight in the training data when this was made */
  dataThrough?: string
  cardVersion: number
  bouts: LedgerBout[]
}

export interface Ledger {
  eventId: string
  title: string
  /** No entry may be recorded at or after this time */
  lockedAt: string
  mainCardStart: string
  entries: LedgerEntry[]
}

/** A new entry is recorded only when it says something different: a changed card or a probability that moved. */
export const CHANGE_THRESHOLD = 0.005

export function entryFromPayload(payload: EventPayload, now: Date): LedgerEntry | null {
  const model = payload.resultsModel
  if (model.status !== 'available') return null
  return {
    recordedAt: now.toISOString(),
    model: model.version,
    ...(model.dataVersion ? { dataVersion: model.dataVersion } : {}),
    ...(model.featurePipeline ? { featurePipeline: model.featurePipeline } : {}),
    ...(model.codeCommit ? { codeCommit: model.codeCommit } : {}),
    dataThrough: model.trainedThrough,
    cardVersion: payload.snapshot.version,
    bouts: payload.fights
      .map((f): LedgerBout | null => {
        const r = model.bouts[f.id]
        if (!r) return null
        return {
          id: f.id, a: f.a.name, b: f.b.name, probA: round4(r.probA),
          ...(r.probLo !== undefined ? { probLo: round4(r.probLo) } : {}),
          ...(r.probHi !== undefined ? { probHi: round4(r.probHi) } : {}),
          ...(r.distance !== undefined ? { distance: round4(r.distance) } : {}),
          ...(r.joint ? { joint: Object.fromEntries(Object.entries(r.joint).map(([k, v]) => [k, round4(v)])) as unknown as JointOutcome } : {}),
        }
      })
      .filter((b): b is LedgerBout => b !== null),
  }
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000

/** A stable ID for one saved forecast version. Pure in the event, the save time and the model, so older entries get the same ID today as they will tomorrow. */
export function forecastIdOf(eventId: string, e: Pick<LedgerEntry, 'recordedAt' | 'model'>): string {
  return `fc_${createHash('sha256').update(`${eventId}|${e.recordedAt}|${e.model}`).digest('hex').slice(0, 12)}`
}

/** One saved forecast, trimmed for the public site: win probability of fighter A for each bout and why it was saved. */
export interface LedgerHistoryEntry {
  /** Canonical ID of this version, the one it replaced, and when it was published relative to the event */
  forecastId: string
  supersedes: string | null
  dataVersion?: string
  featurePipeline?: string
  /** Hours between saving this version and the main card, the forecast's prediction horizon */
  horizonHours: number
  at: string
  model: string
  dataThrough?: string
  cardVersion: number
  /** Plain-language reason this version exists */
  reason: string
  probs: Record<string, number>
}

/** Why `next` was saved after `prev`, in words a visitor can read. */
export function describeChange(prev: LedgerEntry | undefined, next: LedgerEntry): string {
  if (!prev) return 'First forecast for this card'
  const before = new Set(prev.bouts.map((b) => `${b.id}|${b.a}|${b.b}`))
  if (before.size !== next.bouts.length || next.bouts.some((b) => !before.has(`${b.id}|${b.a}|${b.b}`))) return 'The card changed'
  if (prev.model !== next.model) return `The model was updated (${next.model})`
  if (prev.dataThrough !== next.dataThrough) return `New results were added (data through ${next.dataThrough ?? 'a later date'})`
  return 'A small shift in the probabilities'
}

export function historyOf(ledger: Ledger): LedgerHistoryEntry[] {
  return ledger.entries.map((e, i) => ({
    forecastId: forecastIdOf(ledger.eventId, e),
    supersedes: i > 0 ? forecastIdOf(ledger.eventId, ledger.entries[i - 1]) : null,
    ...(e.dataVersion ? { dataVersion: e.dataVersion } : {}),
    ...(e.featurePipeline ? { featurePipeline: e.featurePipeline } : {}),
    horizonHours: Math.round(((Date.parse(ledger.mainCardStart) - Date.parse(e.recordedAt)) / 3_600_000) * 10) / 10,
    at: e.recordedAt, model: e.model, dataThrough: e.dataThrough, cardVersion: e.cardVersion,
    reason: describeChange(ledger.entries[i - 1], e),
    probs: Object.fromEntries(e.bouts.map((b) => [b.id, b.probA])),
  }))
}

export type RecordDecision = { record: true; reason: string } | { record: false; reason: string }

/** Pure decision: should `next` be appended to a ledger that already holds `entries`? */
export function shouldRecord(ledger: Ledger | null, next: LedgerEntry, lockedAt: string): RecordDecision {
  if (Date.parse(next.recordedAt) >= Date.parse(lockedAt)) return { record: false, reason: 'The event has started, so the ledger is locked.' }
  const last = ledger?.entries[ledger.entries.length - 1]
  if (!last) return { record: true, reason: 'First entry for this event.' }
  const before = new Map(last.bouts.map((b) => [b.id, b]))
  if (before.size !== next.bouts.length || next.bouts.some((b) => !before.has(b.id) || before.get(b.id)?.a !== b.a || before.get(b.id)?.b !== b.b)) {
    return { record: true, reason: 'The card changed.' }
  }
  if (last.model !== next.model) return { record: true, reason: 'The model version changed.' }
  const moved = next.bouts.some((b) => Math.abs((before.get(b.id)?.probA ?? 0) - b.probA) >= CHANGE_THRESHOLD)
  return moved ? { record: true, reason: 'A probability moved.' } : { record: false, reason: 'Nothing changed.' }
}

export const ledgerPath = (root: string, eventId: string): string => resolve(root, 'data/ledger', `${eventId}.json`)

export function readLedger(root: string, eventId: string): Ledger | null {
  const path = ledgerPath(root, eventId)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as Ledger
}

export function readAllLedgers(root: string): Ledger[] {
  const dir = resolve(root, 'data/ledger')
  if (!existsSync(dir)) return []
  const out: Ledger[] = []
  for (const name of readdirSync(dir).sort()) {
    if (name.endsWith('.json')) out.push(JSON.parse(readFileSync(resolve(dir, name), 'utf8')) as Ledger)
  }
  return out
}


export interface RecordResult {
  eventId: string
  recorded: boolean
  reason: string
}

/**
 * Appends to each event's ledger when warranted. Existing entries are carried over untouched; the file is
 * rewritten only to add a new final entry.
 */
export function recordLedgers(root: string, payloads: readonly EventPayload[], now: Date): RecordResult[] {
  return payloads.map((p) => {
    const entry = entryFromPayload(p, now)
    if (!entry) return { eventId: p.event.id, recorded: false, reason: p.resultsModel.reason ?? 'No model output.' }
    const existing = readLedger(root, p.event.id)
    const decision = shouldRecord(existing, entry, p.event.prelimsStart)
    if (!decision.record) return { eventId: p.event.id, recorded: false, reason: decision.reason }
    const ledger: Ledger = {
      eventId: p.event.id,
      title: p.event.title,
      lockedAt: p.event.prelimsStart,
      mainCardStart: p.event.mainCardStart,
      entries: [...(existing?.entries ?? []), entry],
    }
    const path = ledgerPath(root, p.event.id)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`)
    return { eventId: p.event.id, recorded: true, reason: decision.reason }
  })
}
