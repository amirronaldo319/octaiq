import { describe, expect, it } from 'vitest'
import { decide, MIN_IMPROVEMENT, type Challenger } from './promotion.ts'

const base: Challenger = {
  name: 'challenger', incumbent: 'baseline',
  diff: { estimate: -0.006, lo: -0.011, hi: -0.001 },
  foldDiffs: [-0.01, -0.004, -0.008, 0.002, -0.006, -0.005],
  calibrationSlope: 1.02,
}

describe('promotion gate', () => {
  it('promotes only when every condition holds', () => {
    expect(decide(base).mode).toBe('promote')
  })

  it('runs in shadow mode when the gain looks real but the interval includes zero', () => {
    const d = decide({ ...base, diff: { estimate: -0.004, lo: -0.011, hi: 0.003 } })
    expect(d.mode).toBe('shadow')
    expect(d.reasons.join(' ')).toContain('includes zero')
  })

  it('does not promote a gain smaller than the minimum, however narrow the interval', () => {
    const d = decide({ ...base, diff: { estimate: -(MIN_IMPROVEMENT / 2), lo: -0.002, hi: -0.0001 } })
    expect(d.mode).not.toBe('promote')
    expect(d.reasons.join(' ')).toContain('minimum')
  })

  it('does not promote an improvement that comes from a minority of periods', () => {
    const d = decide({ ...base, foldDiffs: [-0.03, 0.004, 0.003, 0.002, -0.001, 0.003] })
    expect(d.mode).toBe('shadow')
    expect(d.foldWinShare).toBeCloseTo(2 / 6)
  })

  it('does not promote better log loss with distorted calibration', () => {
    expect(decide({ ...base, calibrationSlope: 0.6 }).mode).toBe('reject')
  })

  it('rejects a challenger that is not better, and cannot judge stability with few folds', () => {
    expect(decide({ ...base, diff: { estimate: 0.003, lo: 0.0, hi: 0.006 } }).mode).toBe('reject')
    const few = decide({ ...base, foldDiffs: [-0.01, -0.02] })
    expect(few.mode).toBe('shadow')
    expect(few.foldWinShare).toBeNull()
  })
})
