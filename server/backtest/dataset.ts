import { parseCsv } from '../lib/csv.ts'
import { normalizeName } from '../lib/names.ts'

export type ResultKind = 'a' | 'b' | 'draw' | 'nc'
export type MethodKind = 'ko' | 'sub' | 'dec' | 'dq' | 'other'

/** Per-fight totals for one fighter, summed over rounds. */
export interface SideStats {
  sigLanded: number
  sigAttempted: number
  knockdowns: number
  tdLanded: number
  tdAttempted: number
  subAttempts: number
  ctrlSeconds: number
}

export interface BoutStats {
  a: SideStats
  b: SideStats
  /** Fight length in minutes, from the results file */
  minutes: number
}

export interface Bout {
  id: string
  event: string
  /** UTC midnight of the event date, ms */
  date: number
  /** Canonical keys (normalised names). Orientation is randomised, see orient(). */
  a: string
  b: string
  nameA: string
  nameB: string
  result: ResultKind
  method: MethodKind
  weightClass: string
  /** Scheduled rounds from the results file's time format (3 or 5 for almost every bout), null if unknown */
  scheduledRounds?: number | null
  /** Post-fight statistics. Only ever read for fights that happened BEFORE the bout being predicted. */
  stats?: BoutStats
}

export interface FighterProfile {
  dob: number | null
  reachCm: number | null
  /** True for a southpaw; null when the stance is unknown. Stance does not change over a career. */
  southpaw?: boolean | null
}

export interface RawFiles {
  events: string
  results: string
  fighters: string
  /** ufc_fight_stats.csv; optional */
  stats?: string
}

export interface IngestStats {
  rowsRead: number
  bouts: number
  droppedNoEvent: number
  droppedBadBout: number
  droppedBadOutcome: number
  results: Record<ResultKind, number>
  fighterProfiles: number
  ambiguousNames: number
  firstDate: string
  lastDate: string
  statsCoverage: { boutsWithStats: number; statsRowsSkipped: number; statsBoutsUnmatched: number }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Parses "October 17, 2026" and "Jul 13, 1978" to UTC ms; null when invalid. */
export function parseDate(text: string): number | null {
  const m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s*(\d{4})$/.exec(text.trim())
  if (!m) return null
  const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase())
  if (month < 0) return null
  const ms = Date.UTC(Number(m[3]), month, Number(m[2]))
  return Number.isNaN(ms) ? null : ms
}

/** "3 Rnd (5-5-5)" gives 3, "5 Rnd (5-5-5-5-5)" gives 5, "No Time Limit" gives null. */
export function scheduledRounds(timeFormat: string): number | null {
  const m = /^(\d+)\s*Rnd/i.exec(timeFormat.trim())
  return m ? Number(m[1]) : null
}

export function classifyMethod(raw: string): MethodKind {
  const m = raw.trim().toLowerCase()
  if (m.startsWith('ko') || m.startsWith('tko')) return 'ko'
  if (m.startsWith('submission')) return 'sub'
  if (m.startsWith('decision')) return 'dec'
  if (m === 'dq') return 'dq'
  return 'other'
}

/** FNV-1a, used only to pick a stable pseudo-random orientation per bout. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

const parseOutcome = (raw: string): ResultKind | null => {
  switch (raw.trim()) {
    case 'W/L': return 'a'
    case 'L/W': return 'b'
    case 'D/D': return 'draw'
    case 'NC/NC': return 'nc'
    default: return null
  }
}

const parseReach = (raw: string): number | null => {
  const inches = Number.parseFloat(raw.replace('"', ''))
  return Number.isFinite(inches) && inches > 40 ? Math.round(inches * 2.54) : null
}

export function parseProfiles(csvText: string): { profiles: Map<string, FighterProfile>; ambiguous: number } {
  const rows = parseCsv(csvText)
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(normalizeName(r.fighter ?? ''), (counts.get(normalizeName(r.fighter ?? '')) ?? 0) + 1)
  const profiles = new Map<string, FighterProfile>()
  let ambiguous = 0
  for (const r of rows) {
    const key = normalizeName(r.fighter ?? '')
    if (!key) continue
    // Two people sharing a name cannot be told apart in the results file, so their bio is unusable.
    if ((counts.get(key) ?? 0) > 1) {
      ambiguous++
      profiles.set(key, { dob: null, reachCm: null, southpaw: null })
      continue
    }
    const stance = (r.stance ?? '').trim().toLowerCase()
    profiles.set(key, { dob: parseDate(r.dob ?? ''), reachCm: parseReach(r.reach ?? ''), southpaw: stance === '' ? null : stance === 'southpaw' })
  }
  return { profiles, ambiguous }
}


const OF = /^(\d+)\s+of\s+(\d+)$/

/** Parses "9 of 37" into [landed, attempted]; null for "---" or malformed values. */
export function parseOf(text: string): [number, number] | null {
  const m = OF.exec((text ?? '').trim())
  return m ? [Number(m[1]), Number(m[2])] : null
}

/** Parses "1:08" into seconds; null for "--" or malformed values. */
export function parseClock(text: string): number | null {
  const m = /^(\d+):(\d{2})$/.exec((text ?? '').trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** Fight length in minutes from the results row: full earlier rounds plus the time in the last round. */
export function fightMinutes(timeFormat: string, round: string, time: string): number | null {
  const endRound = Number.parseInt(round, 10)
  const clock = parseClock(time)
  if (!Number.isFinite(endRound) || endRound < 1 || clock === null) return null
  const lengths = /\(([\d-]+)\)/.exec(timeFormat)?.[1]?.split('-').map(Number).filter((n) => n > 0)
  const roundLen = (i: number): number => lengths?.[i] ?? 5
  let minutes = 0
  for (let i = 0; i < endRound - 1; i++) minutes += roundLen(i)
  return minutes + clock / 60
}

const emptySide = (): SideStats => ({ sigLanded: 0, sigAttempted: 0, knockdowns: 0, tdLanded: 0, tdAttempted: 0, subAttempts: 0, ctrlSeconds: 0 })

/**
 * Sums round rows into per-fighter fight totals, keyed by "event|bout" then normalised fighter name.
 * Rows with a missing round or unparsable striking numbers are skipped and counted.
 */
export function parseFightStats(csvText: string): { byBout: Map<string, Map<string, SideStats>>; skipped: number } {
  const byBout = new Map<string, Map<string, SideStats>>()
  let skipped = 0
  for (const r of parseCsv(csvText)) {
    const sig = parseOf(r['sig.str.'] ?? '')
    if (!r.round || !sig) { skipped++; continue }
    const td = parseOf(r.td ?? '') ?? [0, 0]
    const key = `${(r.event ?? '').trim()}|${(r.bout ?? '').trim()}`
    const fighters = byBout.get(key) ?? new Map<string, SideStats>()
    const name = normalizeName(r.fighter ?? '')
    const side = fighters.get(name) ?? emptySide()
    side.sigLanded += sig[0]
    side.sigAttempted += sig[1]
    side.knockdowns += Number(r.kd) || 0
    side.tdLanded += td[0]
    side.tdAttempted += td[1]
    side.subAttempts += Number(r['sub.att']) || 0
    side.ctrlSeconds += parseClock(r.ctrl ?? '') ?? 0
    fighters.set(name, side)
    byBout.set(key, fighters)
  }
  return { byBout, skipped }
}

/**
 * Joins results with event dates and randomises which fighter is "A".
 * The raw file lists winners first far more often than chance, so using the listed order
 * as a label would leak the outcome.
 */
export function parseBouts(files: RawFiles): { bouts: Bout[]; stats: IngestStats } {
  const eventDates = new Map<string, number>()
  for (const e of parseCsv(files.events)) {
    const d = parseDate(e.date ?? '')
    if (d !== null) eventDates.set((e.event ?? '').trim(), d)
  }
  const rows = parseCsv(files.results)
  const stats: IngestStats = {
    rowsRead: rows.length, bouts: 0, droppedNoEvent: 0, droppedBadBout: 0, droppedBadOutcome: 0,
    results: { a: 0, b: 0, draw: 0, nc: 0 }, fighterProfiles: 0, ambiguousNames: 0, firstDate: '', lastDate: '',
    statsCoverage: { boutsWithStats: 0, statsRowsSkipped: 0, statsBoutsUnmatched: 0 },
  }
  const parsedStats = files.stats ? parseFightStats(files.stats) : null
  if (parsedStats) stats.statsCoverage.statsRowsSkipped = parsedStats.skipped
  const usedStatsKeys = new Set<string>()
  const bouts: Bout[] = []
  for (const r of rows) {
    const parts = (r.bout ?? '').split(' vs. ')
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) { stats.droppedBadBout++; continue }
    const date = eventDates.get((r.event ?? '').trim())
    if (date === undefined) { stats.droppedNoEvent++; continue }
    const outcome = parseOutcome(r.outcome ?? '')
    if (outcome === null) { stats.droppedBadOutcome++; continue }

    const flip = fnv1a(r.url || `${r.event}|${r.bout}`) % 2 === 1
    const [first, second] = [parts[0].trim(), parts[1].trim()]
    const [nameA, nameB] = flip ? [second, first] : [first, second]
    const result: ResultKind = !flip ? outcome : outcome === 'a' ? 'b' : outcome === 'b' ? 'a' : outcome
    const key = `${(r.event ?? '').trim()}|${(r.bout ?? '').trim()}`
    const rawStats = parsedStats?.byBout.get(key)
    const minutes = fightMinutes(r['time format'] ?? '', r.round ?? '', r.time ?? '')
    const sa = rawStats?.get(normalizeName(nameA))
    const sb = rawStats?.get(normalizeName(nameB))
    let boutStats: BoutStats | undefined
    if (sa && sb && minutes !== null && minutes > 0) {
      boutStats = { a: sa, b: sb, minutes }
      usedStatsKeys.add(key)
      stats.statsCoverage.boutsWithStats++
    }
    bouts.push({
      id: r.url || `${r.event}|${r.bout}`,
      event: (r.event ?? '').trim(),
      date,
      a: normalizeName(nameA),
      b: normalizeName(nameB),
      nameA,
      nameB,
      result,
      method: classifyMethod(r.method ?? ''),
      weightClass: (r.weightclass ?? '').trim(),
      scheduledRounds: scheduledRounds(r['time format'] ?? ''),
      ...(boutStats ? { stats: boutStats } : {}),
    })
    stats.results[result]++
  }
  if (parsedStats) stats.statsCoverage.statsBoutsUnmatched = [...parsedStats.byBout.keys()].filter((k) => !usedStatsKeys.has(k)).length
  // Oldest first; ties keep file order reversed so card order is stable.
  bouts.reverse()
  bouts.sort((x, y) => x.date - y.date)
  stats.bouts = bouts.length
  if (bouts.length > 0) {
    stats.firstDate = new Date(bouts[0].date).toISOString().slice(0, 10)
    stats.lastDate = new Date(bouts[bouts.length - 1].date).toISOString().slice(0, 10)
  }
  const { profiles, ambiguous } = parseProfiles(files.fighters)
  stats.fighterProfiles = profiles.size
  stats.ambiguousNames = ambiguous
  return { bouts, stats }
}

export function profilesFor(files: RawFiles): Map<string, FighterProfile> {
  return parseProfiles(files.fighters).profiles
}
