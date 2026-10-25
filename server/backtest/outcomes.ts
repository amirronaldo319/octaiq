import type { FeatureRow } from './features.ts'
import { bootstrapLogLoss, logLossOne, type EventAgg, type Interval } from './metrics.ts'
import { predictLogistic, trainLogistic, type LogisticModel } from './models.ts'

/**
 * How a fight ends: goes the distance, or a knockout or submission win.
 * The goes-the-distance model uses symmetric matchup features; the method model asks, for a finish by
 * a given winner, how likely it is to be a knockout. They combine with the win probability into one
 * coherent distribution over (winner, method).
 */
export const WEIGHT_CLASSES = [
  'Flyweight', 'Bantamweight', 'Featherweight', 'Lightweight', 'Welterweight', 'Middleweight', 'Light Heavyweight', 'Heavyweight',
  "Women's Strawweight", "Women's Flyweight", "Women's Bantamweight", "Women's Featherweight",
] as const

/** "Women's Flyweight Bout" and "Women's Flyweight" give the same key; catch and open weights give null. */
export function weightClassKey(raw: string): string | null {
  const cleaned = raw.replace(/\s+Bout$/i, '').replace(/^UFC\s+/i, '').replace(/\s+Title$/i, '').trim()
  return (WEIGHT_CLASSES as readonly string[]).find((c) => c.toLowerCase() === cleaned.toLowerCase()) ?? null
}

export const wcOneHot = (raw: string): number[] => {
  const key = weightClassKey(raw)
  return WEIGHT_CLASSES.map((c) => (c === key ? 1 : 0))
}

export const distanceInput = (r: Pick<FeatureRow, 'dist' | 'ctx'>): number[] => [1, ...r.dist, r.ctx.rounds === 5 ? 1 : 0, ...wcOneHot(r.ctx.weightClass)]
export const methodInput = (v: readonly number[], weightClass: string): number[] => [1, ...v, ...wcOneHot(weightClass)]

type Labeled = FeatureRow & { ctx: FeatureRow['ctx'] }

const isDistanceRow = (r: Labeled): boolean => r.ctx.result !== 'nc' && (r.ctx.method === 'ko' || r.ctx.method === 'sub' || r.ctx.method === 'dec')
const isFinishWinRow = (r: Labeled): boolean => (r.ctx.result === 'a' || r.ctx.result === 'b') && (r.ctx.method === 'ko' || r.ctx.method === 'sub')
const isJointRow = (r: Labeled): boolean => (r.ctx.result === 'a' || r.ctx.result === 'b') && (r.ctx.method === 'ko' || r.ctx.method === 'sub' || r.ctx.method === 'dec')

export interface OutcomeModels {
  dist: LogisticModel
  ko: LogisticModel
  /** Share of fights that go the distance, in the training data */
  distPrior: number
  /** Share of finishes that are knockouts, in the training data */
  koPrior: number
  /** Shares of (ko, sub, dec) among decisive fights, in the training data */
  methodPrior: { ko: number; sub: number; dec: number }
}

const mean = (v: readonly number[]): number => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0.5)

/** Trains on labelled rows only; the caller is responsible for passing rows dated before the prediction. */
export function trainOutcomeModels(rows: readonly FeatureRow[], ridge: number): OutcomeModels {
  const d = rows.filter(isDistanceRow)
  const f = rows.filter(isFinishWinRow)
  const j = rows.filter(isJointRow)
  const dy = d.map((r) => (r.ctx.method === 'dec' ? 1 : 0))
  const ky = f.map((r) => (r.ctx.method === 'ko' ? 1 : 0))
  const winnerVec = (r: FeatureRow): number[] => methodInput(r.ctx.result === 'a' ? r.mw[0] : r.mw[1], r.ctx.weightClass)
  const count = (m: string): number => j.filter((r) => r.ctx.method === m).length / Math.max(1, j.length)
  return {
    dist: trainLogistic(d.map(distanceInput), dy, ridge),
    ko: trainLogistic(f.map(winnerVec), ky, ridge),
    distPrior: mean(dy),
    koPrior: mean(ky),
    methodPrior: { ko: count('ko'), sub: count('sub'), dec: count('dec') },
  }
}

export interface OutcomeProbs {
  /** Probability the fight goes the distance */
  distance: number
  /** Probability a finish is a knockout, if A wins by finishing */
  koIfA: number
  /** ... if B wins by finishing */
  koIfB: number
}

export function predictOutcomeProbs(m: OutcomeModels, r: Pick<FeatureRow, 'dist' | 'ctx' | 'mw'>): OutcomeProbs {
  return {
    distance: predictLogistic(m.dist, distanceInput(r)),
    koIfA: predictLogistic(m.ko, methodInput(r.mw[0], r.ctx.weightClass)),
    koIfB: predictLogistic(m.ko, methodInput(r.mw[1], r.ctx.weightClass)),
  }
}

export interface JointProbs {
  aKo: number
  aSub: number
  aDec: number
  bKo: number
  bSub: number
  bDec: number
}

/**
 * Combines the win probability with the method model. The six probabilities sum to one. This assumes the
 * winner and the method are independent given the features, a simplification: a heavy favourite is
 * somewhat more likely to win by finish than this allows.
 */
export function jointProbs(pA: number, o: OutcomeProbs): JointProbs {
  const pB = 1 - pA
  const fin = 1 - o.distance
  return {
    aKo: pA * fin * o.koIfA,
    aSub: pA * fin * (1 - o.koIfA),
    aDec: pA * o.distance,
    bKo: pB * fin * o.koIfB,
    bSub: pB * fin * (1 - o.koIfB),
    bDec: pB * o.distance,
  }
}

export interface OutcomeMetric {
  n: number
  logLoss: Interval
  baselineLogLoss: number
  /** Model minus baseline log loss with a 95% interval; negative means the model is better */
  gain: Interval
  accuracy: number
  baselineAccuracy: number
}

export interface OutcomeReport {
  period: string
  distance: OutcomeMetric
  koShare: OutcomeMetric
  joint: OutcomeMetric
  note: string
}

const yearStart = (y: number): number => Date.UTC(y, 0, 1)
const yearOf = (ms: number): number => new Date(ms).getUTCFullYear()

interface Scored {
  event: string
  model: number
  base: number
  correct: boolean
  baseCorrect: boolean
}

function summarize(items: readonly Scored[], iterations: number, seed: number): OutcomeMetric {
  const byEvent = new Map<string, EventAgg>()
  for (const it of items) {
    const a = byEvent.get(it.event) ?? { n: 0, ll: [0, 0] }
    a.n++
    a.ll[0] += it.model
    a.ll[1] += it.base
    byEvent.set(it.event, a)
  }
  const b = bootstrapLogLoss([...byEvent.values()], 1, iterations, seed)
  return {
    n: items.length,
    logLoss: b.logLoss[0],
    baselineLogLoss: b.logLoss[1].estimate,
    gain: b.diffVsRef[0],
    accuracy: items.filter((i) => i.correct).length / Math.max(1, items.length),
    baselineAccuracy: items.filter((i) => i.baseCorrect).length / Math.max(1, items.length),
  }
}

/**
 * Walk-forward evaluation of the goes-the-distance model, the knockout-share model, and the joint
 * (winner, method) distribution, each against the simplest baseline: the training-period base rate.
 * `pA` maps a bout id to the win probability made for it without hindsight.
 */
export function evaluateOutcomes(
  rows: readonly FeatureRow[],
  pA: ReadonlyMap<string, number>,
  opts: { firstTestYear: number; ridge: number; bootstrap: number; seed: number },
): OutcomeReport | null {
  const dist: Scored[] = []
  const ko: Scored[] = []
  const joint: Scored[] = []
  const years = [...new Set(rows.map((r) => yearOf(r.date)))].filter((y) => y >= opts.firstTestYear).sort((a, b) => a - b)

  for (const year of years) {
    const train = rows.filter((r) => r.date < yearStart(year))
    const test = rows.filter((r) => yearOf(r.date) === year)
    if (train.filter(isDistanceRow).length < 300 || train.filter(isFinishWinRow).length < 200) continue
    const models = trainOutcomeModels(train, opts.ridge)

    for (const r of test) {
      const probs = predictOutcomeProbs(models, r)
      if (isDistanceRow(r)) {
        const y = r.ctx.method === 'dec' ? 1 : 0
        dist.push({ event: `${year}|${r.event}`, model: logLossOne(probs.distance, y), base: logLossOne(models.distPrior, y), correct: (probs.distance >= 0.5) === (y === 1), baseCorrect: (models.distPrior >= 0.5) === (y === 1) })
      }
      if (isFinishWinRow(r)) {
        const p = r.ctx.result === 'a' ? probs.koIfA : probs.koIfB
        const y = r.ctx.method === 'ko' ? 1 : 0
        ko.push({ event: `${year}|${r.event}`, model: logLossOne(p, y), base: logLossOne(models.koPrior, y), correct: (p >= 0.5) === (y === 1), baseCorrect: (models.koPrior >= 0.5) === (y === 1) })
      }
      const pWin = pA.get(r.id)
      if (isJointRow(r) && pWin !== undefined) {
        const j = jointProbs(pWin, probs)
        const key = `${r.ctx.result === 'a' ? 'a' : 'b'}${r.ctx.method === 'ko' ? 'Ko' : r.ctx.method === 'sub' ? 'Sub' : 'Dec'}` as keyof JointProbs
        const prior = models.methodPrior
        const baseP: JointProbs = {
          aKo: 0.5 * prior.ko, aSub: 0.5 * prior.sub, aDec: 0.5 * prior.dec,
          bKo: 0.5 * prior.ko, bSub: 0.5 * prior.sub, bDec: 0.5 * prior.dec,
        }
        const argmax = (d: JointProbs): string => (Object.entries(d) as [string, number][]).reduce((a, b) => (b[1] > a[1] ? b : a))[0]
        joint.push({
          event: `${year}|${r.event}`,
          model: -Math.log(Math.max(1e-6, j[key])),
          base: -Math.log(Math.max(1e-6, baseP[key])),
          correct: argmax(j) === key,
          baseCorrect: argmax(baseP) === key,
        })
      }
    }
  }
  if (dist.length < 100 || ko.length < 100 || joint.length < 100) return null
  return {
    period: `${years[0]}-${years[years.length - 1]}`,
    distance: summarize(dist, opts.bootstrap, opts.seed + 11),
    koShare: summarize(ko, opts.bootstrap, opts.seed + 12),
    joint: summarize(joint, opts.bootstrap, opts.seed + 13),
    note: 'The joint distribution multiplies the win probability by the method model, assuming winner and method are independent given the features.',
  }
}
