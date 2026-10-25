import { describe, expect, it } from 'vitest'
import {
  americanToDecimal,
  closingLineValue,
  decimalToAmerican,
  devig,
  expectedValue,
  impliedProb,
  kellyFraction,
  payout,
  probToAmerican,
} from './odds'

describe('odds conversions', () => {
  it('converts American to decimal', () => {
    expect(americanToDecimal(150)).toBeCloseTo(2.5)
    expect(americanToDecimal(-200)).toBeCloseTo(1.5)
  })
  it('rejects invalid odds', () => {
    expect(() => americanToDecimal(0)).toThrow()
  })
  it('round trips decimal and American', () => {
    expect(decimalToAmerican(2.5)).toBe(150)
    expect(decimalToAmerican(1.5)).toBe(-200)
  })
  it('computes implied probability', () => {
    expect(impliedProb(-200)).toBeCloseTo(2 / 3)
    expect(impliedProb(200)).toBeCloseTo(1 / 3)
  })
  it('converts probability to American', () => {
    expect(probToAmerican(0.5)).toBe(100)
    expect(probToAmerican(0.75)).toBe(-300)
  })
})

describe('devig', () => {
  it('normalises to 1 and reports vig', () => {
    const r = devig(-110, -110)
    expect(r.a).toBeCloseTo(0.5)
    expect(r.a + r.b).toBeCloseTo(1)
    expect(r.vig).toBeCloseTo(0.0476, 3)
  })
})

describe('expected value and kelly', () => {
  it('is zero at fair odds', () => {
    expect(expectedValue(0.5, 100)).toBeCloseTo(0)
  })
  it('is positive with an edge', () => {
    expect(expectedValue(0.6, 100)).toBeCloseTo(0.2)
  })
  it('returns no stake without an edge', () => {
    expect(kellyFraction(0.4, 100)).toBe(0)
  })
  it('caps the stake', () => {
    expect(kellyFraction(0.9, 100, 1, 0.05)).toBe(0.05)
  })
  it('scales by fraction', () => {
    expect(kellyFraction(0.6, 100, 1, 1)).toBeCloseTo(0.2)
    expect(kellyFraction(0.6, 100, 0.5, 1)).toBeCloseTo(0.1)
  })
  it('calculates payout', () => {
    expect(payout(10, 150)).toBeCloseTo(15)
  })
})

describe('closing line value', () => {
  it('is positive when the close moved your way', () => {
    expect(closingLineValue(150, 120, -140)).toBeGreaterThan(0)
  })
  it('is negative when the close moved against you', () => {
    expect(closingLineValue(120, 160, -190)).toBeLessThan(0)
  })
})
