import type { Bout } from '../backtest/dataset.ts'
import { normalizeName } from '../lib/names.ts'
import type { Ledger, LedgerBout, LedgerEntry } from './ledger.ts'

export interface GradedBout extends LedgerBout {
  /** Filled in once the fight is in the results data */
  result?: 'a' | 'b' | 'draw' | 'nc'
  method?: 'ko' | 'sub' | 'dec' | 'dq' | 'other'
  correct?: boolean
  /** Log loss of the win probability for the actual winner; decisive results only */
  logLoss?: number
}

export interface GradedEvent {
  eventId: string
  title: string
  mainCardStart: string
  lockedAt: string
  entries: number
  firstRecordedAt: string | null
  /** The entry that counts: the last one recorded before the event started */
  scoredEntryAt: string | null
  bouts: GradedBout[]
  graded: number
  correct: number
  logLoss: number | null
  status: 'upcoming' | 'awaiting-results' | 'graded'
}

const tokenKey = (n: string): string => normalizeName(n).split(' ').filter(Boolean).sort().join(' ')
const pairKey = (a: string, b: string): string => [tokenKey(a), tokenKey(b)].sort().join('|')
const DAY = 86_400_000

/** The entry that counts is the last one made strictly before the lock; later ones are ignored even if present. */
export function scoredEntry(ledger: Ledger): LedgerEntry | null {
  const lock = Date.parse(ledger.lockedAt)
  const valid = ledger.entries.filter((e) => Date.parse(e.recordedAt) < lock)
  return valid.length ? valid[valid.length - 1] : null
}

/**
 * Grades a ledger against the results dataset. A bout is matched on its two names and a date within a
 * day of the event; its result is then read from the dataset, never from the site's own card.
 */
export function gradeLedger(ledger: Ledger, dataset: readonly Bout[], now: Date): GradedEvent {
  const entry = scoredEntry(ledger)
  const start = Date.parse(ledger.mainCardStart)
  const lo = Date.parse(ledger.lockedAt) - 2 * DAY
  const hi = start + 2 * DAY
  const index = new Map<string, Bout[]>()
  for (const b of dataset) {
    if (b.date < lo || b.date > hi) continue
    const k = pairKey(b.nameA, b.nameB)
    index.set(k, [...(index.get(k) ?? []), b])
  }

  const bouts: GradedBout[] = (entry?.bouts ?? []).map((lb) => {
    const found = index.get(pairKey(lb.a, lb.b))
    if (!found || found.length !== 1) return { ...lb }
    const d = found[0]
    // Orient the dataset's result to the ledger's A corner.
    const sameCorner = tokenKey(d.nameA) === tokenKey(lb.a)
    const result = d.result === 'a' || d.result === 'b' ? ((d.result === 'a') === sameCorner ? 'a' : 'b') : d.result
    const decisive = result === 'a' || result === 'b'
    const pWinner = result === 'a' ? lb.probA : 1 - lb.probA
    return {
      ...lb,
      result, method: d.method,
      ...(decisive ? { correct: (lb.probA >= 0.5) === (result === 'a'), logLoss: -Math.log(Math.max(1e-6, pWinner)) } : {}),
    }
  })

  const decided = bouts.filter((b) => b.correct !== undefined)
  const status: GradedEvent['status'] = decided.length > 0 ? 'graded' : now.getTime() > start + 6 * 3_600_000 ? 'awaiting-results' : 'upcoming'
  return {
    eventId: ledger.eventId, title: ledger.title, mainCardStart: ledger.mainCardStart, lockedAt: ledger.lockedAt,
    entries: ledger.entries.length,
    firstRecordedAt: ledger.entries[0]?.recordedAt ?? null,
    scoredEntryAt: entry?.recordedAt ?? null,
    bouts, graded: decided.length, correct: decided.filter((b) => b.correct).length,
    logLoss: decided.length ? decided.reduce((s, b) => s + (b.logLoss ?? 0), 0) / decided.length : null,
    status,
  }
}

export interface LedgerSummary {
  events: GradedEvent[]
  graded: number
  correct: number
  logLoss: number | null
}

export function summarizeLedgers(events: readonly GradedEvent[]): LedgerSummary {
  const graded = events.reduce((s, e) => s + e.graded, 0)
  const correct = events.reduce((s, e) => s + e.correct, 0)
  const ll = events.reduce((s, e) => s + (e.logLoss ?? 0) * e.graded, 0)
  return { events: [...events], graded, correct, logLoss: graded ? ll / graded : null }
}
