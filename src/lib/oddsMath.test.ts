import { describe, expect, it } from 'vitest'
import { parseOdds, removeMargin } from './oddsMath'

describe('parseOdds', () => {
  it('reads the three formats to the same probability', () => {
    const a = parseOdds('+150', 'american')
    const d = parseOdds('2.5', 'decimal')
    const f = parseOdds('3/2', 'fractional')
    for (const p of [a, d, f]) expect(p?.implied).toBeCloseTo(0.4, 6)
    expect(parseOdds('-200', 'american')?.implied).toBeCloseTo(2 / 3, 6)
    expect(parseOdds('1.5', 'decimal')?.american).toBe(-200)
    expect(parseOdds('5/2', 'fractional')?.american).toBe(250)
  })

  it('rejects values that are not odds', () => {
    for (const [t, f] of [['', 'american'], ['abc', 'american'], ['50', 'american'], ['0.9', 'decimal'], ['1', 'decimal'], ['3/0', 'fractional'], ['0/5', 'fractional'], ['2.5', 'fractional']] as const) {
      expect(parseOdds(t, f)).toBeNull()
    }
  })
})

describe('removeMargin', () => {
  it('splits the margin out of a two-way market', () => {
    const r = removeMargin(parseOdds('-150', 'american')!, parseOdds('+130', 'american')!)
    expect(r.fairA + r.fairB).toBeCloseTo(1, 10)
    expect(r.margin).toBeCloseTo(0.6 + 100 / 230 - 1, 6)
    expect(r.fairA).toBeGreaterThan(0.55)
  })
})
