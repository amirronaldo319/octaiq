import { describe, expect, it } from 'vitest'
import { FIGHTS } from '../data/card'
import { computeFactors, predict } from './model'
import { priceParlay } from './parlay'
import { createRng } from './rng'

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = createRng(42)
    const b = createRng(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
  it('stays within [0,1)', () => {
    const r = createRng(1)
    for (let i = 0; i < 1000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('predict', () => {
  it('returns coherent probabilities for every fight', () => {
    for (const fight of FIGHTS) {
      const p = predict(fight, 4000)
      expect(p.probA + p.probB).toBeCloseTo(1)
      const sumMethods =
        Object.values(p.methodA).reduce((s, v) => s + v, 0) + Object.values(p.methodB).reduce((s, v) => s + v, 0)
      expect(sumMethods).toBeCloseTo(1, 5)
      expect(p.distance).toBeGreaterThanOrEqual(0)
      expect(p.finishByRound).toHaveLength(fight.rounds)
    }
  })
  it('is reproducible with the same seed', () => {
    expect(predict(FIGHTS[0], 3000, 5)).toEqual(predict(FIGHTS[0], 3000, 5))
  })
  it('is symmetric when fighters swap sides', () => {
    const f = FIGHTS[0]
    const swapped = { ...f, a: f.b, b: f.a }
    const p1 = predict(f, 20000, 3).probA
    const p2 = predict(swapped, 20000, 3).probB
    expect(Math.abs(p1 - p2)).toBeLessThan(0.03)
  })
  it('favors the fighter with the better factor sum', () => {
    const f = FIGHTS[1]
    const gap = computeFactors(f.a, f.b, f.rounds).reduce((s, x) => s + x.value, 0)
    const p = predict(f, 10000)
    expect(gap > 0 ? p.probA > 0.5 : p.probA < 0.5).toBe(true)
  })
})

describe('priceParlay', () => {
  it('returns null for no legs', () => {
    expect(priceParlay([])).toBeNull()
  })
  it('multiplies decimal odds and probabilities', () => {
    const r = priceParlay([
      { label: 'a', american: 100, modelProb: 0.6 },
      { label: 'b', american: 100, modelProb: 0.6 },
    ])
    expect(r?.decimal).toBeCloseTo(4)
    expect(r?.american).toBe(300)
    expect(r?.modelProb).toBeCloseTo(0.36)
    expect(r?.ev).toBeCloseTo(0.36 * 3 - 0.64)
  })
})
