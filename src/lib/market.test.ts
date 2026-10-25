import { describe, expect, it } from 'vitest'
import { gapPoints, isMarketFile, marketFor, type MarketFile } from './market'

const file: MarketFile = { generatedAt: 'x', source: 's', attribution: 'a', events: { e1: { 'e1-1': { pA: 0.6, pLo: 0.58, pHi: 0.62, books: 4 } } } }

describe('market helpers', () => {
  it('finds a bout and returns undefined for anything missing', () => {
    expect(marketFor(file, 'e1', 'e1-1')?.books).toBe(4)
    expect(marketFor(file, 'e1', 'e1-2')).toBeUndefined()
    expect(marketFor(file, 'e2', 'e1-1')).toBeUndefined()
    expect(marketFor(undefined, 'e1', 'e1-1')).toBeUndefined()
    expect(marketFor(file, null, 'e1-1')).toBeUndefined()
  })

  it('measures the gap in points, signed toward fighter A', () => {
    expect(gapPoints(0.55, file.events.e1['e1-1'])).toBeCloseTo(-5)
    expect(gapPoints(0.7, file.events.e1['e1-1'])).toBeCloseTo(10)
  })

  it('recognises a market file by shape', () => {
    expect(isMarketFile(file)).toBe(true)
    expect(isMarketFile({ events: null })).toBe(false)
    expect(isMarketFile('x')).toBe(false)
  })
})
