import { describe, expect, it } from 'vitest'
import { apportion, pctPair } from './rounding'

describe('pctPair', () => {
  it('always adds to 100, even at x.5 splits', () => {
    for (const p of [0.495, 0.505, 0.5, 0.605, 0.3949, 0.9999, 0.0001, 0, 1]) {
      const [a, b] = pctPair(p)
      expect(a + b).toBe(100)
    }
    expect(pctPair(0.605)).toEqual([61, 39])
  })
})

describe('apportion', () => {
  it('splits a total so the whole numbers add up', () => {
    const out = apportion([0.1743, 0.1436, 0.1742], 49)
    expect(out.reduce((s, v) => s + v, 0)).toBe(49)
    expect(out).toEqual([18, 14, 17])
  })
  it('handles zeros and degenerate input', () => {
    expect(apportion([0, 0, 0], 10)).toEqual([0, 0, 0])
    expect(apportion([1, 0], 7)).toEqual([7, 0])
    for (let n = 1; n < 50; n++) expect(apportion([0.333, 0.333, 0.334], n).reduce((s, v) => s + v, 0)).toBe(n)
  })
})
