import { buildNameIndex, normalizeName, slugify } from '../lib/names.ts'
import type { Bout, MethodKind } from './dataset.ts'
import { eloAfter, scoreOfResult } from './features.ts'

export interface CareerRow {
  /** ISO day, e.g. 2026-10-17 */
  date: string
  event: string
  opponent: string
  result: 'W' | 'L' | 'D' | 'NC'
  method: string
  weightClass: string
  /** Elo rating after this fight */
  eloAfter: number
  /** The opponent's rating going into the fight, so form can be read against who it came against */
  oppElo: number
  /** Scheduled rounds (3 or 5) when known */
  rounds: number | null
  /** Significant strikes landed per minute, and what that opponent's earlier opponents landed on them per minute */
  sigPerMin?: number
  oppUsualSigAbsorbed?: number | null
  /** Takedowns landed per 15 minutes, and what that opponent usually gave up per 15 */
  tdPer15?: number
  oppUsualTdAbsorbed?: number | null
}

export interface RecentForm {
  fights: number
  sigLandedPerMin: number
  sigAbsorbedPerMin: number
  sigAccuracy: number
  tdPer15: number
  subPer15: number
  /** Share of fight time spent in control minus time controlled, as a fraction of fight time */
  netControl: number
}

export interface Career {
  name: string
  slug: string
  /** False when the name has no UFC fights in the dataset (a debut, or a different spelling) */
  matched: boolean
  fights: number
  wins: number
  losses: number
  draws: number
  noContests: number
  koWins: number
  subWins: number
  decisionWins: number
  eloNow: number | null
  eloPeak: number | null
  /** Newest first */
  timeline: CareerRow[]
  /** Oldest first, for charting */
  eloSeries: { date: string; elo: number }[]
  recent: RecentForm | null
}

const METHOD_LABEL: Record<MethodKind, string> = { ko: 'KO/TKO', sub: 'Submission', dec: 'Decision', dq: 'Disqualification', other: 'Other' }
const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
const round1 = (n: number): number => Math.round(n * 10) / 10
const round2 = (n: number): number => Math.round(n * 100) / 100

function recentForm(key: string, bouts: readonly Bout[], count: number): RecentForm | null {
  const withStats = bouts.filter((b) => b.stats && (b.a === key || b.b === key)).slice(-count)
  if (withStats.length === 0) return null
  let minutes = 0, landed = 0, absorbed = 0, attempted = 0, td = 0, sub = 0, ctrl = 0, ctrlAgainst = 0
  for (const b of withStats) {
    const st = b.stats as NonNullable<Bout['stats']>
    const own = b.a === key ? st.a : st.b
    const opp = b.a === key ? st.b : st.a
    minutes += st.minutes
    landed += own.sigLanded
    absorbed += opp.sigLanded
    attempted += own.sigAttempted
    td += own.tdLanded
    sub += own.subAttempts
    ctrl += own.ctrlSeconds
    ctrlAgainst += opp.ctrlSeconds
  }
  return {
    fights: withStats.length,
    sigLandedPerMin: round2(landed / minutes),
    sigAbsorbedPerMin: round2(absorbed / minutes),
    sigAccuracy: round2(attempted > 0 ? landed / attempted : 0),
    tdPer15: round2((td / minutes) * 15),
    subPer15: round2((sub / minutes) * 15),
    netControl: round2((ctrl - ctrlAgainst) / 60 / minutes),
  }
}

const MIN_HISTORY_MINUTES = 15

/** A fighter's output in one bout next to what that opponent's earlier opponents usually managed against them. */
function adjusted(b: Bout, side: 'a' | 'b', cum: ReadonlyMap<string, { min: number; sigAbs: number; tdAbs: number }>): Pick<CareerRow, 'sigPerMin' | 'oppUsualSigAbsorbed' | 'tdPer15' | 'oppUsualTdAbsorbed'> {
  if (!b.stats || b.stats.minutes <= 0) return {}
  const own = side === 'a' ? b.stats.a : b.stats.b
  const oppUsual = cum.get(side === 'a' ? b.b : b.a)
  const known = oppUsual !== undefined && oppUsual.min >= MIN_HISTORY_MINUTES
  return {
    sigPerMin: round2(own.sigLanded / b.stats.minutes),
    oppUsualSigAbsorbed: known ? round2(oppUsual.sigAbs / oppUsual.min) : null,
    tdPer15: round2((own.tdLanded / b.stats.minutes) * 15),
    oppUsualTdAbsorbed: known ? round2((oppUsual.tdAbs / oppUsual.min) * 15) : null,
  }
}

/**
 * Career timelines and Elo curves for the named fighters. Elo uses the same update as the prediction
 * features: same-day results are applied together, so a fighter's rating never reflects a result that
 * had not happened yet on that date.
 */
export function buildCareers(
  bouts: readonly Bout[],
  names: readonly string[],
  opts: { eloK: number; aliases?: Record<string, string> },
): Record<string, Career> {
  const sorted = [...bouts].sort((x, y) => x.date - y.date)
  const known = buildNameIndex([...new Set(sorted.flatMap((b) => [b.a, b.b]))].map((key) => ({ key })), (f) => f.key)
  const wanted = new Map<string, string>() // dataset key -> display name
  const out: Record<string, Career> = {}

  for (const name of names) {
    const aliased = opts.aliases?.[normalizeName(name)] ?? name
    const key = known.find(aliased)?.key
    const slug = slugify(name)
    out[slug] = {
      name, slug, matched: Boolean(key), fights: 0, wins: 0, losses: 0, draws: 0, noContests: 0,
      koWins: 0, subWins: 0, decisionWins: 0, eloNow: null, eloPeak: null, timeline: [], eloSeries: [], recent: null,
    }
    if (key) wanted.set(key, slug)
  }

  const elo = new Map<string, number>()
  /** Running totals of what each fighter has absorbed, to judge a performance against the opponent's usual */
  const cum = new Map<string, { min: number; sigAbs: number; tdAbs: number }>()
  const get = (k: string): number => elo.get(k) ?? 1500
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j < sorted.length && sorted[j].date === sorted[i].date) j++
    const group = sorted.slice(i, j)
    const updates: [string, number][] = []
    const pre = new Map<string, [number, number]>()
    for (const b of group) pre.set(b.id, [get(b.a), get(b.b)])
    for (const b of group) {
      if (b.result === 'nc') continue
      const [ea, eb] = [get(b.a), get(b.b)]
      updates.push([b.a, eloAfter(ea, eb, scoreOfResult(b.result, 'a'), opts.eloK)])
      updates.push([b.b, eloAfter(eb, ea, scoreOfResult(b.result, 'b'), opts.eloK)])
    }
    for (const [k, v] of updates) elo.set(k, v)

    for (const b of group) {
      for (const side of ['a', 'b'] as const) {
        const key = b[side]
        const slug = wanted.get(key)
        if (!slug) continue
        const c = out[slug]
        const opponent = side === 'a' ? b.nameB : b.nameA
        const result: CareerRow['result'] = b.result === 'nc' ? 'NC' : b.result === 'draw' ? 'D' : b.result === side ? 'W' : 'L'
        const after = get(key)
        const [preA, preB] = pre.get(b.id) as [number, number]
        const usual = adjusted(b, side, cum)
        c.timeline.push({
          date: day(b.date), event: b.event, opponent, result, method: METHOD_LABEL[b.method], weightClass: b.weightClass, eloAfter: round1(after),
          oppElo: round1(side === 'a' ? preB : preA), rounds: b.scheduledRounds ?? null, ...usual,
        })
        c.eloSeries.push({ date: day(b.date), elo: round1(after) })
        c.fights++
        if (result === 'W') {
          c.wins++
          if (b.method === 'ko') c.koWins++
          else if (b.method === 'sub') c.subWins++
          else if (b.method === 'dec') c.decisionWins++
        } else if (result === 'L') c.losses++
        else if (result === 'D') c.draws++
        else c.noContests++
      }
    }
    for (const b of group) {
      if (!b.stats) continue
      for (const [key, opp] of [[b.a, b.stats.b], [b.b, b.stats.a]] as const) {
        const c = cum.get(key) ?? { min: 0, sigAbs: 0, tdAbs: 0 }
        cum.set(key, { min: c.min + b.stats.minutes, sigAbs: c.sigAbs + opp.sigLanded, tdAbs: c.tdAbs + opp.tdLanded })
      }
    }
    i = j
  }

  for (const [key, slug] of wanted) {
    const c = out[slug]
    c.timeline.reverse()
    c.eloNow = c.eloSeries.length ? c.eloSeries[c.eloSeries.length - 1].elo : null
    c.eloPeak = c.eloSeries.length ? Math.max(...c.eloSeries.map((p) => p.elo)) : null
    c.recent = recentForm(key, sorted, 5)
  }
  return out
}
