import { createRng } from '../../src/engine/rng.ts'

const EPS = 1e-6
const clamp = (p: number): number => Math.min(1 - EPS, Math.max(EPS, p))

export const logLossOne = (p: number, y: number): number => -(y * Math.log(clamp(p)) + (1 - y) * Math.log(1 - clamp(p)))
export const brierOne = (p: number, y: number): number => (p - y) ** 2

export interface ReliabilityBin {
  /** Predicted probability range, folded so the bin describes the favored side */
  lo: number
  hi: number
  n: number
  meanPredicted: number
  observed: number
}

export interface Metrics {
  n: number
  logLoss: number
  brier: number
  accuracy: number
  /** Expected calibration error over 10 bins of the favored side's probability */
  ece: number
  reliability: ReliabilityBin[]
}

/** Folds every prediction onto the favored side so calibration is not diluted by orientation. */
export function metrics(preds: readonly number[], y: readonly number[], bins = 10): Metrics {
  const n = preds.length
  if (n === 0) return { n: 0, logLoss: NaN, brier: NaN, accuracy: NaN, ece: NaN, reliability: [] }
  let ll = 0
  let br = 0
  let correct = 0
  const acc = Array.from({ length: bins }, () => ({ n: 0, p: 0, o: 0 }))
  for (let i = 0; i < n; i++) {
    ll += logLossOne(preds[i], y[i])
    br += brierOne(preds[i], y[i])
    const favA = preds[i] >= 0.5
    if (preds[i] !== 0.5 && (favA ? y[i] === 1 : y[i] === 0)) correct++
    if (preds[i] === 0.5) correct += 0.5
    const pf = favA ? preds[i] : 1 - preds[i]
    const of = favA ? y[i] : 1 - y[i]
    const k = Math.min(bins - 1, Math.floor(((pf - 0.5) / 0.5) * bins))
    acc[k].n++
    acc[k].p += pf
    acc[k].o += of
  }
  const reliability = acc.map((b, k) => ({
    lo: 0.5 + (k / bins) * 0.5,
    hi: 0.5 + ((k + 1) / bins) * 0.5,
    n: b.n,
    meanPredicted: b.n ? b.p / b.n : NaN,
    observed: b.n ? b.o / b.n : NaN,
  }))
  const ece = acc.reduce((s, b) => s + (b.n ? (b.n / n) * Math.abs(b.p / b.n - b.o / b.n) : 0), 0)
  return { n, logLoss: ll / n, brier: br / n, accuracy: correct / n, ece, reliability }
}

export interface EventAgg {
  n: number
  /** Per-model summed log loss, in the same model order as the caller */
  ll: number[]
}

export interface Interval {
  estimate: number
  lo: number
  hi: number
}

/**
 * Event-level bootstrap (fights on one card are not independent). Returns 95% percentile intervals
 * for each model's mean log loss and for the paired difference to a reference model.
 */
export function bootstrapLogLoss(
  events: readonly EventAgg[],
  refIndex: number,
  iterations: number,
  seed: number,
): { logLoss: Interval[]; diffVsRef: Interval[] } {
  const k = events[0]?.ll.length ?? 0
  const total = (sel: readonly EventAgg[]): { n: number; ll: number[] } => {
    const ll = new Array<number>(k).fill(0)
    let n = 0
    for (const e of sel) {
      n += e.n
      for (let m = 0; m < k; m++) ll[m] += e.ll[m]
    }
    return { n, ll }
  }
  const point = total(events)
  const rng = createRng(seed)
  const draws: { ll: number[]; diff: number[] }[] = []
  for (let it = 0; it < iterations; it++) {
    const sample: EventAgg[] = []
    for (let i = 0; i < events.length; i++) sample.push(events[Math.floor(rng() * events.length)])
    const t = total(sample)
    draws.push({ ll: t.ll.map((v) => v / t.n), diff: t.ll.map((v) => (v - t.ll[refIndex]) / t.n) })
  }
  const pct = (vals: number[], q: number): number => {
    const s = [...vals].sort((x, y) => x - y)
    return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))]
  }
  const interval = (est: number, vals: number[]): Interval =>
    vals.length === 0 ? { estimate: est, lo: est, hi: est } : { estimate: est, lo: pct(vals, 0.025), hi: pct(vals, 0.975) }
  return {
    logLoss: point.ll.map((v, m) => interval(v / point.n, draws.map((d) => d.ll[m]))),
    diffVsRef: point.ll.map((v, m) => interval((v - point.ll[refIndex]) / point.n, draws.map((d) => d.diff[m]))),
  }
}
