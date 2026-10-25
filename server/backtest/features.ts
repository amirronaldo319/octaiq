import type { Bout, FighterProfile, MethodKind, ResultKind, SideStats } from './dataset.ts'
import { logit } from './models.ts'

export const RESULT_FEATURES = [
  'elo', 'experience', 'winRate', 'finishRate', 'koLossRate', 'subLossRate', 'form',
  'layoff', 'age', 'reach', 'debut', 'ageMissing', 'reachMissing',
  'oppElo', 'activity', 'southpaw', 'wcMove', 'eloWc', 'agePast', 'ageClass', 'sinceLoss', 'koRecent',
] as const

/** Rolling striking and grappling features built from earlier fights' statistics. */
export const STATS_FEATURES = [
  'sigDiff', 'sigLanded', 'sigAbsorbed', 'sigAcc', 'tdRate', 'tdDef', 'subRate', 'ctrlNet', 'kdFor', 'kdAgainst',
  'cageMin', 'tdClash', 'kdClash',
] as const

/**
 * Tried and not adopted: stance, weight-class moves and Elo, age decline, time since a loss, recent knockouts,
 * cage minutes and style clashes. They did not improve the walk-forward log loss, so they are excluded from
 * the default model; the backtest reports an ablation with them so the null result stays visible.
 */
export const EXPERIMENTAL_FEATURES: readonly string[] = [
  'southpaw', 'wcMove', 'eloWc', 'agePast', 'ageClass', 'sinceLoss', 'koRecent', 'cageMin', 'tdClash', 'kdClash',
]

export const FEATURE_NAMES = [...RESULT_FEATURES, ...STATS_FEATURES] as const

export interface FeatureRow {
  id: string
  event: string
  date: number
  /** 1 when A won, 0 when B won, null for draws and no-contests (never used for training or scoring) */
  y: 0 | 1 | null
  /** Antisymmetric features: value(A) - value(B). Swapping the fighters negates the vector. */
  x: number[]
  /** Prior UFC bouts for each fighter, used for subgroup reporting */
  priorA: number
  priorB: number
  /** Bout context and outcome, for the goes-the-distance and method models */
  ctx: { rounds: number | null; weightClass: string; method: MethodKind; result: ResultKind }
  /** Symmetric features: A plus B, so they describe how finish-prone the matchup is */
  dist: number[]
  /** Method features from each side's perspective as the winner: [A wins, B wins] */
  mw: [number[], number[]]
}

export const DIST_DIM = 11
export const METH_DIM = 4

/** Decayed running totals of a fighter's earlier fights. */
interface Roll {
  min: number
  sigL: number
  sigAbs: number
  sigAtt: number
  kdFor: number
  kdAg: number
  tdL: number
  tdAtt: number
  oppTdL: number
  oppTdAtt: number
  sub: number
  ctrlFor: number
  ctrlAg: number
}

interface State {
  elo: number
  n: number
  wins: number
  finishWins: number
  koWins: number
  koLosses: number
  subWins: number
  subLosses: number
  form: number
  /** Sum of the opponents' ratings at the time of each fight, for the strength-of-schedule feature */
  oppEloSum: number
  /** Fights counted with a two-year exponential memory, so it measures recent activity */
  activity: number
  /** Minutes fought in the cage, from fights with recorded statistics */
  totalMin: number
  lastLossDate: number | null
  /** Knockout losses with a three-year half-life, as of koDate */
  koRecent: number
  koDate: number | null
  /** Weight-class index of the previous fight */
  lastWc: number | null
  /** Elo earned inside each weight class */
  eloWc: Record<string, number>
  lastDate: number | null
  roll: Roll
}

const zeroRoll = (): Roll => ({ min: 0, sigL: 0, sigAbs: 0, sigAtt: 0, kdFor: 0, kdAg: 0, tdL: 0, tdAtt: 0, oppTdL: 0, oppTdAtt: 0, sub: 0, ctrlFor: 0, ctrlAg: 0 })
const fresh = (): State => ({ elo: 1500, n: 0, wins: 0, finishWins: 0, koWins: 0, koLosses: 0, subWins: 0, subLosses: 0, form: 0.5, oppEloSum: 0, activity: 0, totalMin: 0, lastLossDate: null, koRecent: 0, koDate: null, lastWc: null, eloWc: {}, lastDate: null, roll: zeroRoll() })
const DAY = 86_400_000

const CLASS_ORDER = ['strawweight', 'flyweight', 'bantamweight', 'featherweight', 'lightweight', 'welterweight', 'middleweight', 'light heavyweight', 'heavyweight']
/** 1 (strawweight) to 9 (heavyweight) from a results-file weight class; null for catch weight, open weight and unknowns. */
export function weightClassIndex(name: string): number | null {
  const t = name.toLowerCase()
  let found: number | null = null
  CLASS_ORDER.forEach((c, i) => {
    if (t.includes(c) && (found === null || c.length > CLASS_ORDER[found - 1].length)) found = i + 1
  })
  return found
}
const YEAR = 365.25 * DAY

/** Pseudo-observations that pull a thin history toward the running league average. */
const K_MIN = 15
const K_STRIKES = 30
const K_TD = 6
const K_OPP = 3

function addStats(prev: Roll, own: SideStats, opp: SideStats, minutes: number, decay: number): Roll {
  const r = { ...prev }
  for (const k of Object.keys(r) as (keyof Roll)[]) r[k] *= decay
  r.min += minutes
  r.sigL += own.sigLanded
  r.sigAbs += opp.sigLanded
  r.sigAtt += own.sigAttempted
  r.kdFor += own.knockdowns
  r.kdAg += opp.knockdowns
  r.tdL += own.tdLanded
  r.tdAtt += own.tdAttempted
  r.oppTdL += opp.tdLanded
  r.oppTdAtt += opp.tdAttempted
  r.sub += own.subAttempts
  r.ctrlFor += own.ctrlSeconds
  r.ctrlAg += opp.ctrlSeconds
  return r
}

/** League-wide running averages, used as the shrinkage target. Constants apply until data accumulates. */
interface Global {
  min: number
  sigL: number
  sigAtt: number
  tdL: number
  tdAtt: number
  sub: number
  kd: number
}
const zeroGlobal = (): Global => ({ min: 0, sigL: 0, sigAtt: 0, tdL: 0, tdAtt: 0, sub: 0, kd: 0 })

function describeStats(r: Roll, g: Global): number[] {
  const perMin = g.min > 200 ? g.sigL / g.min : 3.2
  const acc = g.sigAtt > 500 ? g.sigL / g.sigAtt : 0.45
  const tdSuccess = g.tdAtt > 100 ? g.tdL / g.tdAtt : 0.4
  const tdPerMin = g.min > 200 ? g.tdL / g.min : 0.08
  const subPerMin = g.min > 200 ? g.sub / g.min : 0.03
  const kdPerMin = g.min > 200 ? g.kd / g.min : 0.012
  const rate = (count: number, prior: number): number => (count + prior * K_MIN) / (r.min + K_MIN)

  const landed = rate(r.sigL, perMin)
  const absorbed = rate(r.sigAbs, perMin)
  return [
    landed - absorbed,
    landed,
    absorbed,
    (r.sigL + acc * K_STRIKES) / (r.sigAtt + K_STRIKES),
    rate(r.tdL, tdPerMin) * 15,
    1 - (r.oppTdL + tdSuccess * K_TD) / (r.oppTdAtt + K_TD),
    rate(r.sub, subPerMin) * 15,
    (r.ctrlFor - r.ctrlAg) / 60 / (r.min + K_MIN),
    rate(r.kdFor, kdPerMin) * 15,
    rate(r.kdAg, kdPerMin) * 15,
  ]
}

/** Finish-proneness descriptors for one fighter; the matchup vector is the sum over both fighters. */
function symVector(s: State, p: FighterProfile | undefined, date: number, g: Global): number[] {
  const age = p?.dob != null ? (date - p.dob) / YEAR : null
  const [, landed, absorbed, , tdRate, , subRate, , kdFor, kdAgainst] = describeStats(s.roll, g)
  return [
    (s.finishWins + 1) / (s.n + 4),
    s.koLosses / (s.n + 4),
    s.subLosses / (s.n + 4),
    landed, absorbed, tdRate, subRate, kdFor, kdAgainst,
    Math.log1p(s.n),
    age === null ? 0 : (age - 30) / 10,
  ]
}

/** How a finish by `w` over `l` would most likely come: knockout or submission. */
function methodVector(w: State, l: State, g: Global): number[] {
  const koWinShare = (w.koWins + 1) / (w.finishWins + 2)
  const koLossShare = (l.koLosses + 1) / (l.koLosses + l.subLosses + 2)
  const [, , , , tdRate, , subRate] = describeStats(w.roll, g)
  return [logit(koWinShare), logit(koLossShare), tdRate, subRate]
}

function describe(s: State, p: FighterProfile | undefined, date: number, g: Global, wc: number | null): number[] {
  const age = p?.dob != null ? (date - p.dob) / YEAR : null
  const reach = p?.reachCm ?? null
  const layoffDays = s.lastDate === null ? 0 : Math.min((date - s.lastDate) / DAY, 1095)
  return [
    (s.elo - 1500) / 400,
    Math.log1p(s.n),
    (s.wins + 2) / (s.n + 4),
    (s.finishWins + 1) / (s.n + 4),
    s.koLosses / (s.n + 4),
    s.subLosses / (s.n + 4),
    s.form,
    Math.log1p(layoffDays / 30),
    age === null ? 0 : (age - 30) / 10,
    reach === null ? 0 : (reach - 180) / 10,
    s.n === 0 ? 1 : 0,
    age === null ? 1 : 0,
    reach === null ? 1 : 0,
    (((s.oppEloSum + 1500 * K_OPP) / (s.n + K_OPP)) - 1500) / 400,
    Math.log1p(s.lastDate === null ? 0 : s.activity * 0.5 ** ((date - s.lastDate) / (2 * YEAR))),
    p?.southpaw ? 1 : 0,
    wc !== null && s.lastWc !== null ? Math.max(-2, Math.min(2, wc - s.lastWc)) / 2 : 0,
    ((s.eloWc[String(wc)] ?? s.elo) - 1500) / 400,
    age === null ? 0 : Math.max(0, age - 34) / 5,
    age === null ? 0 : ((age - 30) / 10) * (((wc ?? 5) - 5) / 4),
    s.n === 0 ? 0 : s.lastLossDate === null ? 1 : Math.min((date - s.lastLossDate) / YEAR, 5) / 5,
    s.koDate === null ? 0 : s.koRecent * 0.5 ** ((date - s.koDate) / (3 * YEAR)),
    ...describeStats(s.roll, g),
    Math.log1p(s.totalMin / 60),
  ]
}

const scoreOf = (result: 'a' | 'b' | 'draw', side: 'a' | 'b'): number => (result === 'draw' ? 0.5 : result === side ? 1 : 0)
const expected = (eloSelf: number, eloOpp: number): number => 1 / (1 + 10 ** ((eloOpp - eloSelf) / 400))

/** New Elo rating after a result. Shared with the career timelines so charts and predictions use one formula. */
export const eloAfter = (self: number, opponent: number, score: number, k: number): number => self + k * (score - expected(self, opponent))
export const scoreOfResult = (result: 'a' | 'b' | 'draw', side: 'a' | 'b'): number => (result === 'draw' ? 0.5 : result === side ? 1 : 0)

function update(
  s: State, opp: State, score: number, kElo: number, won: boolean, lost: boolean,
  method: MethodKind, date: number, roll: Roll, wc: number | null, minutes: number,
): State {
  const wcKey = String(wc)
  return {
    elo: eloAfter(s.elo, opp.elo, score, kElo),
    n: s.n + 1,
    wins: s.wins + (won ? 1 : 0),
    finishWins: s.finishWins + (won && (method === 'ko' || method === 'sub') ? 1 : 0),
    koWins: s.koWins + (won && method === 'ko' ? 1 : 0),
    subWins: s.subWins + (won && method === 'sub' ? 1 : 0),
    koLosses: s.koLosses + (lost && method === 'ko' ? 1 : 0),
    subLosses: s.subLosses + (lost && method === 'sub' ? 1 : 0),
    form: 0.7 * s.form + 0.3 * score,
    oppEloSum: s.oppEloSum + opp.elo,
    activity: (s.lastDate === null ? 0 : s.activity * 0.5 ** ((date - s.lastDate) / (2 * YEAR))) + 1,
    totalMin: s.totalMin + minutes,
    lastLossDate: lost ? date : s.lastLossDate,
    koRecent: (s.koDate === null ? 0 : s.koRecent * 0.5 ** ((date - s.koDate) / (3 * YEAR))) + (lost && method === 'ko' ? 1 : 0),
    koDate: lost && method === 'ko' ? date : s.koDate,
    lastWc: wc ?? s.lastWc,
    eloWc: { ...s.eloWc, [wcKey]: eloAfter(s.eloWc[wcKey] ?? s.elo, opp.eloWc[wcKey] ?? opp.elo, score, kElo) },
    lastDate: date,
    roll,
  }
}

export interface FeatureOptions {
  eloK: number
  /** Per-fight multiplier applied to older statistics (1 = no decay, 0.8 = fast decay). Default 0.9. */
  statsDecay?: number
}

/**
 * Builds one feature row per bout in chronological order. Every feature for a bout is computed from
 * state that existed BEFORE that event date: outcomes and fight statistics are applied only after all
 * bouts on the same date have been featurised, so nothing from the bout itself or from later bouts
 * (including its own post-fight statistics) can leak in.
 */
export function buildFeatureRows(
  bouts: readonly Bout[],
  profiles: ReadonlyMap<string, FighterProfile>,
  opts: FeatureOptions,
): FeatureRow[] {
  const decay = opts.statsDecay ?? 0.9
  const states = new Map<string, State>()
  const get = (key: string): State => states.get(key) ?? fresh()
  const global = zeroGlobal()
  const rows: FeatureRow[] = []

  let i = 0
  while (i < bouts.length) {
    let j = i
    while (j < bouts.length && bouts[j].date === bouts[i].date) j++
    const group = bouts.slice(i, j)
    const snapshot = { ...global }

    for (const b of group) {
      const sa = get(b.a)
      const sb = get(b.b)
      const wc = weightClassIndex(b.weightClass)
      const fa = describe(sa, profiles.get(b.a), b.date, snapshot, wc)
      const fb = describe(sb, profiles.get(b.b), b.date, snapshot, wc)
      const ta = describeStats(sa.roll, snapshot)
      const tb = describeStats(sb.roll, snapshot)
      const clash = [ta[4] * (1 - tb[5]) - tb[4] * (1 - ta[5]), ta[8] * tb[9] - tb[8] * ta[9]]
      const symA = symVector(sa, profiles.get(b.a), b.date, snapshot)
      const symB = symVector(sb, profiles.get(b.b), b.date, snapshot)
      rows.push({
        id: b.id,
        event: b.event,
        date: b.date,
        y: b.result === 'a' ? 1 : b.result === 'b' ? 0 : null,
        x: [...fa.map((v, k) => v - fb[k]), ...clash],
        priorA: sa.n,
        priorB: sb.n,
        ctx: { rounds: b.scheduledRounds ?? null, weightClass: b.weightClass, method: b.method, result: b.result },
        dist: symA.map((v, k) => v + symB[k]),
        mw: [methodVector(sa, sb, snapshot), methodVector(sb, sa, snapshot)],
      })
    }

    // Apply results and statistics after the whole date has been featurised.
    const pending: [string, State][] = []
    for (const b of group) {
      const sa = get(b.a)
      const sb = get(b.b)
      const rollA = b.stats ? addStats(sa.roll, b.stats.a, b.stats.b, b.stats.minutes, decay) : sa.roll
      const rollB = b.stats ? addStats(sb.roll, b.stats.b, b.stats.a, b.stats.minutes, decay) : sb.roll
      if (b.stats) {
        global.min += b.stats.minutes
        global.sigL += b.stats.a.sigLanded + b.stats.b.sigLanded
        global.sigAtt += b.stats.a.sigAttempted + b.stats.b.sigAttempted
        global.tdL += b.stats.a.tdLanded + b.stats.b.tdLanded
        global.tdAtt += b.stats.a.tdAttempted + b.stats.b.tdAttempted
        global.sub += b.stats.a.subAttempts + b.stats.b.subAttempts
        global.kd += b.stats.a.knockdowns + b.stats.b.knockdowns
      }
      if (b.result === 'nc') {
        // A no-contest still happened: keep its statistics but leave ratings and records alone.
        if (b.stats) {
          pending.push([b.a, { ...sa, roll: rollA }])
          pending.push([b.b, { ...sb, roll: rollB }])
        }
        continue
      }
      const res = b.result
      const wc = weightClassIndex(b.weightClass)
      const minutes = b.stats?.minutes ?? 0
      pending.push([b.a, update(sa, sb, scoreOf(res, 'a'), opts.eloK, res === 'a', res === 'b', b.method, b.date, rollA, wc, minutes)])
      pending.push([b.b, update(sb, sa, scoreOf(res, 'b'), opts.eloK, res === 'b', res === 'a', b.method, b.date, rollB, wc, minutes)])
    }
    for (const [key, st] of pending) states.set(key, st)
    i = j
  }
  return rows
}
