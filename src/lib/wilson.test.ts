import { describe, expect, it } from 'vitest'
import { wilson } from './wilson'

describe('wilson', () => {
  it('matches the textbook value for 60 of 100', () => {
    const w = wilson(60, 100)
    expect(w.lo).toBeCloseTo(0.502, 2)
    expect(w.hi).toBeCloseTo(0.691, 2)
  })
  it('is wide for a tiny sample and never leaves 0 to 1', () => {
    const w = wilson(3, 3)
    expect(w.hi).toBe(1)
    expect(w.lo).toBeGreaterThan(0.4)
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 })
    expect(wilson(0, 10).lo).toBe(0)
  })
})
