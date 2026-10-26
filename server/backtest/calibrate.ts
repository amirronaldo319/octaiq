import { bootstrapLogLoss, calibrationFit, logLossOne, type EventAgg, type Interval } from './metrics.ts'
import { applyTemperature, fitTemperature, logit } from './models.ts'

/**
 * Probability calibrators, all trained on mirrored data (every fight also entered with the fighters swapped), so a calibrated
 * forecast of A and of B always add to one. Each is fitted only on forecasts that were made out of sample.
 */
export interface Platt {
  slope: number
  intercept: number
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))
const mirror = (p: readonly number[], y: readonly number[]): { p: number[]; y: number[] } => ({ p: [...p, ...p.map((v) => 1 - v)], y: [...y, ...y.map((v) => 1 - v)] })

export function fitPlatt(p: readonly number[], y: readonly number[]): Platt | null {
  const m = mirror(p, y)
  const fit = calibrationFit(m.p, m.y)
  return fit ? { slope: fit.slope, intercept: fit.intercept } : null
}
export const applyPlatt = (p: number, f: Platt): number => sigmoid(f.intercept + f.slope * logit(p))

export interface Isotonic {
  /** Increasing forecast cut points and the calibrated value at each */
  xs: number[]
  ys: number[]
}

/** Pool-adjacent-violators: the best non-decreasing step function through the outcomes. */
export function fitIsotonic(p: readonly number[], y: readonly number[]): Isotonic | null {
  const m = mirror(p, y)
  const order = m.p.map((_, i) => i).sort((a, b) => m.p[a] - m.p[b])
  const blocks: { sum: number; n: number; x: number }[] = []
  for (const i of order) {
    blocks.push({ sum: m.y[i], n: 1, x: m.p[i] })
    while (blocks.length > 1 && blocks[blocks.length - 2].sum / blocks[blocks.length - 2].n >= blocks[blocks.length - 1].sum / blocks[blocks.length - 1].n) {
      const b = blocks.pop() as { sum: number; n: number; x: number }
      const a = blocks[blocks.length - 1]
      a.sum += b.sum
      a.n += b.n
      a.x = (a.x * (a.n - b.n) + b.x * b.n) / a.n
    }
  }
  if (blocks.length < 2) return null
  return { xs: blocks.map((b) => b.x), ys: blocks.map((b) => b.sum / b.n) }
}

/** Linear interpolation between block centres, held flat beyond the ends, and kept away from 0 and 1. */
export function applyIsotonic(p: number, f: Isotonic): number {
  const { xs, ys } = f
  const clamp = (v: number): number => Math.min(0.98, Math.max(0.02, v))
  if (p <= xs[0]) return clamp(ys[0])
  if (p >= xs[xs.length - 1]) return clamp(ys[ys.length - 1])
  let lo = 0
  let hi = xs.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid] <= p) lo = mid
    else hi = mid
  }
  const t = (p - xs[lo]) / (xs[hi] - xs[lo] || 1)
  return clamp(ys[lo] + t * (ys[hi] - ys[lo]))
}

export interface CalibrationRow {
  year: number
  event: string
  p: number
  y: number
}

export interface CalibrationComparison {
  method: 'none' | 'temperature' | 'platt' | 'isotonic'
  n: number
  logLoss: number
  /** Paired log-loss difference against no calibration, event-level bootstrap; negative is better */
  vsNone: Interval | null
  /** The same difference in each yearly fold, for the promotion gate */
  foldDiffs: number[]
}

/**
 * Calibrates each test year with a calibrator fitted on the forecasts from earlier years only, and compares methods on the same fights.
 * Needs at least `minRows` earlier forecasts before a year is scored.
 */
export function compareCalibrators(rows: readonly CalibrationRow[], opts: { minRows: number; bootstrap: number; seed: number }): CalibrationComparison[] | null {
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b)
  const scored: { year: number; event: string; y: number; ps: Record<CalibrationComparison['method'], number> }[] = []
  for (const year of years) {
    const prior = rows.filter((r) => r.year < year)
    if (prior.length < opts.minRows) continue
    const pp = prior.map((r) => r.p)
    const py = prior.map((r) => r.y)
    const temp = fitTemperature(pp, py)
    const platt = fitPlatt(pp, py)
    const iso = fitIsotonic(pp, py)
    for (const r of rows.filter((x) => x.year === year)) {
      scored.push({
        year, event: `${year}|${r.event}`, y: r.y,
        ps: { none: r.p, temperature: applyTemperature(r.p, temp), platt: platt ? applyPlatt(r.p, platt) : r.p, isotonic: iso ? applyIsotonic(r.p, iso) : r.p },
      })
    }
  }
  if (scored.length < 200) return null
  const methods: CalibrationComparison['method'][] = ['none', 'temperature', 'platt', 'isotonic']
  const by = new Map<string, EventAgg>()
  for (const s of scored) {
    const a = by.get(s.event) ?? { n: 0, ll: methods.map(() => 0) }
    a.n++
    methods.forEach((m, i) => { a.ll[i] += logLossOne(s.ps[m], s.y) })
    by.set(s.event, a)
  }
  const boot = opts.bootstrap > 0 ? bootstrapLogLoss([...by.values()], 0, opts.bootstrap, opts.seed) : null
  return methods.map((m, i) => ({
    method: m, n: scored.length,
    logLoss: scored.reduce((s, r) => s + logLossOne(r.ps[m], r.y), 0) / scored.length,
    vsNone: m === 'none' || !boot ? null : boot.diffVsRef[i],
    foldDiffs: m === 'none' ? [] : [...new Set(scored.map((r) => r.year))].sort((a, b) => a - b).map((yr) => {
      const sub = scored.filter((r) => r.year === yr)
      return sub.reduce((s, r) => s + logLossOne(r.ps[m], r.y) - logLossOne(r.ps.none, r.y), 0) / sub.length
    }),
  }))
}
