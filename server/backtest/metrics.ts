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

export interface CalibrationFit {
  /** Slope of the outcome on the forecast's log-odds: 1 is well calibrated, below 1 means forecasts are too extreme */
  slope: number
  /** Intercept at the same fit: 0 means no overall bias toward fighter A */
  intercept: number
}

const logit = (p: number): number => Math.log(clamp(p) / (1 - clamp(p)))

/**
 * Logistic recalibration of outcomes on forecast log-odds, fitted by Newton's method with a tiny ridge for stability.
 * The slope and intercept describe calibration without the binning choices that an error summary depends on.
 * Returns null with too few fights or an outcome that never varies.
 */
export function calibrationFit(preds: readonly number[], y: readonly number[]): CalibrationFit | null {
  const n = preds.length
  if (n < 30 || y.every((v) => v === y[0])) return null
  const z = preds.map(logit)
  // Identical forecasts (a coin flip) have no spread to fit a slope to.
  if (z.every((v) => Math.abs(v - z[0]) < 1e-9)) return null
  let a = 0
  let b = 1
  for (let it = 0; it < 25; it++) {
    let ga = 0, gb = 0, haa = 1e-6, hab = 0, hbb = 1e-6
    for (let i = 0; i < n; i++) {
      const p = 1 / (1 + Math.exp(-(a + b * z[i])))
      const r = p - y[i]
      const w = p * (1 - p)
      ga += r
      gb += r * z[i]
      haa += w
      hab += w * z[i]
      hbb += w * z[i] * z[i]
    }
    const det = haa * hbb - hab * hab
    if (Math.abs(det) < 1e-12) return null
    const da = (hbb * ga - hab * gb) / det
    const db = (haa * gb - hab * ga) / det
    a -= da
    b -= db
    if (Math.max(Math.abs(da), Math.abs(db)) < 1e-9) break
  }
  return { slope: b, intercept: a }
}

export interface Metrics {
  n: number
  logLoss: number
  brier: number
  accuracy: number
  /** Expected calibration error over 10 bins of the favored side's probability */
  ece: number
  reliability: ReliabilityBin[]
  /** Calibration slope and intercept; null when there are too few fights */
  calibration: CalibrationFit | null
}

/** Folds every prediction onto the favored side so calibration is not diluted by orientation. */
export function metrics(preds: readonly number[], y: readonly number[], bins = 10): Metrics {
  const n = preds.length
  if (n === 0) return { n: 0, logLoss: NaN, brier: NaN, accuracy: NaN, ece: NaN, reliability: [], calibration: null }
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
  return { n, logLoss: ll / n, brier: br / n, accuracy: correct / n, ece, reliability, calibration: calibrationFit(preds, y) }
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
