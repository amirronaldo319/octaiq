import type { Interval } from './metrics.ts'

/**
 * Rules for letting a challenger replace the production model, fixed in code before any result is read.
 * A challenger is promoted only if all of these hold against the incumbent on the same fights:
 *  1. the paired 95% interval for its log-loss difference lies entirely below zero,
 *  2. the estimated improvement is at least MIN_IMPROVEMENT (a gap too small to matter in practice is not worth the risk),
 *  3. it beat the incumbent in at least MIN_FOLD_WIN_SHARE of the yearly folds (it is not one lucky period),
 *  4. its calibration slope is within CALIBRATION_BAND of 1 (better log loss bought with distorted probabilities is not an upgrade).
 * Short of that, a challenger that still looks better runs in shadow mode; otherwise it is rejected.
 */
export const MIN_IMPROVEMENT = 0.002
export const MIN_FOLD_WIN_SHARE = 0.6
export const CALIBRATION_BAND: [number, number] = [0.8, 1.2]

export interface Challenger {
  name: string
  incumbent: string
  /** Challenger minus incumbent log loss on the same fights, with event-level interval; negative means the challenger is better */
  diff: Interval
  /** The same difference in each chronological fold; fewer than three folds cannot show stability */
  foldDiffs: readonly number[]
  calibrationSlope: number | null
}

export interface Decision {
  name: string
  incumbent: string
  mode: 'promote' | 'shadow' | 'reject'
  reasons: string[]
  estimate: number
  foldWinShare: number | null
}

export function decide(c: Challenger): Decision {
  const reasons: string[] = []
  const fmt = (n: number): string => (n >= 0 ? '+' : '') + n.toFixed(4)
  const wins = c.foldDiffs.filter((d) => d < 0).length
  const share = c.foldDiffs.length >= 3 ? wins / c.foldDiffs.length : null
  const intervalOk = c.diff.hi < 0
  const sizeOk = c.diff.estimate <= -MIN_IMPROVEMENT
  const foldsOk = share !== null && share >= MIN_FOLD_WIN_SHARE
  const slopeOk = c.calibrationSlope === null || (c.calibrationSlope >= CALIBRATION_BAND[0] && c.calibrationSlope <= CALIBRATION_BAND[1])

  reasons.push(`log loss ${fmt(c.diff.estimate)} versus ${c.incumbent} [${fmt(c.diff.lo)}, ${fmt(c.diff.hi)}]`)
  reasons.push(intervalOk ? 'the interval is entirely below zero' : 'the interval includes zero')
  reasons.push(sizeOk ? `the improvement is at least ${MIN_IMPROVEMENT}` : `the improvement is under the ${MIN_IMPROVEMENT} minimum`)
  reasons.push(share === null ? 'too few yearly folds to judge stability' : `better in ${wins} of ${c.foldDiffs.length} yearly folds${foldsOk ? '' : ` (needs ${Math.round(MIN_FOLD_WIN_SHARE * 100)}%)`}`)
  if (c.calibrationSlope !== null) reasons.push(slopeOk ? `calibration slope ${c.calibrationSlope.toFixed(2)} is acceptable` : `calibration slope ${c.calibrationSlope.toFixed(2)} is outside ${CALIBRATION_BAND[0]} to ${CALIBRATION_BAND[1]}`)

  const mode: Decision['mode'] = intervalOk && sizeOk && foldsOk && slopeOk ? 'promote' : c.diff.estimate < 0 && slopeOk ? 'shadow' : 'reject'
  return { name: c.name, incumbent: c.incumbent, mode, reasons, estimate: c.diff.estimate, foldWinShare: share }
}
