import { describe, expect, it } from 'vitest'
import { FIGHTS } from '../data/card'
import type { ResultsModel, ResultsModelBout } from '../engine/eventTypes'
import { analyzeFight } from './analysis'
import { accuracyStrip, buildHighlights, leanOf, primaryView, sortRows, trustFor, type SortRow } from './primary'

const rb = (probA: number, priorA = 10, priorB = 10): ResultsModelBout => ({ probA, probB: 1 - probA, priorA, priorB, eloDiff: 0 })

describe('primaryView', () => {
  const withStats = analyzeFight(FIGHTS[0], 0.25)
  const noStats = analyzeFight({ ...FIGHTS[0], statsMissing: true }, 0.25)

  it('prefers the backtested model, then the baseline, then nothing', () => {
    expect(primaryView(withStats, rb(0.7))).toMatchObject({ source: 'validated', probA: 0.7 })
    expect(primaryView(withStats).source).toBe('baseline')
    expect(primaryView(noStats)).toEqual({ source: 'none', probA: 0.5, probB: 0.5 })
  })
})

describe('primaryView with a market', () => {
  const an = analyzeFight(FIGHTS[0], 0.25)
  const mkt = { pA: 0.62, pLo: 0.6, pHi: 0.64, books: 5 }

  it('headlines the market only when the market view is chosen', () => {
    expect(primaryView(an, rb(0.7), mkt, 'market')).toEqual({ source: 'market', probA: 0.62, probB: 1 - 0.62 })
    expect(primaryView(an, rb(0.7), mkt, 'model')).toMatchObject({ source: 'validated', probA: 0.7 })
    expect(primaryView(an, rb(0.7), undefined, 'market').source).toBe('validated')
  })
})

describe('leanOf', () => {
  it('labels the size of the gap and picks the favoured side', () => {
    expect(leanOf(0.51).label).toBe('Toss-up')
    expect(leanOf(0.56).label).toBe('Slight lean')
    expect(leanOf(0.65)).toMatchObject({ label: 'Clear lean', side: 'a' })
    expect(leanOf(0.2)).toMatchObject({ label: 'Big lean', side: 'b' })
    expect(leanOf(0.5).side).toBe('a')
  })
})

describe('trustFor', () => {
  it('is never higher than Moderate and drops to Low on thin history', () => {
    expect(trustFor(rb(0.9, 20, 20)).level).toBe('Moderate')
    expect(trustFor(rb(0.9, 0, 20)).level).toBe('Low')
    expect(trustFor(rb(0.9, 2, 20)).reason).toContain('only 2 UFC fights')
    expect(trustFor(rb(0.9, 1, 20)).reason).toContain('only 1 UFC fight ')
    expect(trustFor().level).toBe('Low')
  })
})

describe('buildHighlights', () => {
  const items = [
    { id: 'a', nameA: 'A1', nameB: 'A2', probA: 0.8, priorA: 9, priorB: 9 },
    { id: 'b', nameA: 'B1', nameB: 'B2', probA: 0.51, priorA: 9, priorB: 9 },
    { id: 'c', nameA: 'C1', nameB: 'C2', probA: 0.3, priorA: 0, priorB: 5 },
  ]

  it('finds the biggest lean, the closest call and the thinnest history', () => {
    const h = buildHighlights(items)
    expect(h.map((x) => x.key)).toEqual(['strongest', 'closest', 'thin'])
    expect(h[0]).toMatchObject({ fightId: 'a', detail: 'A1 over A2', value: '80%' })
    expect(h[1]).toMatchObject({ fightId: 'b', value: '51% / 49%' })
    expect(h[2]).toMatchObject({ fightId: 'c', value: 'A newcomer' })
  })

  it('omits cards that would repeat a bout or have nothing to say', () => {
    expect(buildHighlights([items[0]]).map((x) => x.key)).toEqual(['strongest'])
    expect(buildHighlights([items[0], items[1]]).map((x) => x.key)).toEqual(['strongest', 'closest'])
    expect(buildHighlights([])).toEqual([])
  })
})

describe('accuracyStrip', () => {
  const meta = (market?: ResultsModel['backtest'] extends infer B ? (B extends { market?: infer M } ? M : never) : never): ResultsModel => ({
    status: 'available', version: 'v', bouts: {},
    backtest: { period: '2014-2026', n: 6288, logLoss: 0.65, logLossLo: 0.64, logLossHi: 0.66, coinLogLoss: 0.69, eloLogLoss: 0.68, resultsOnlyLogLoss: 0.66, accuracy: 0.616, datasetRetrieved: '', generatedAt: '', market },
  })

  it('uses same-sample accuracy when prices exist and falls back to the full test otherwise', () => {
    const withMarket = accuracyStrip(meta({ period: '2014-2020', n: 2735, marketLogLoss: 0.618, modelLogLoss: 0.666, marketAccuracy: 0.644, modelAccuracy: 0.603, gap: 0.048, gapLo: 0.03, gapHi: 0.06 }))
    expect(withMarket).toMatchObject({ model: 0.603, market: 0.644, n: 2735 })
    expect(accuracyStrip(meta())).toMatchObject({ model: 0.616, market: null, n: 6288 })
    expect(accuracyStrip(undefined)).toBeNull()
  })
})

describe('sortRows', () => {
  const rows: (SortRow & { id: string })[] = [
    { id: 'a', order: 1, hasModel: true, probA: 0.55, thinnest: 10 },
    { id: 'b', order: 2, hasModel: true, probA: 0.85, thinnest: 1 },
    { id: 'c', order: 3, hasModel: false, probA: 0.5, thinnest: null },
    { id: 'd', order: 4, hasModel: true, probA: 0.2, thinnest: 6 },
  ]
  const ids = (key: Parameters<typeof sortRows>[1]): string => sortRows(rows, key).map((r) => r.id).join('')

  it('orders by card position, lean, closeness and thin data', () => {
    expect(ids('order')).toBe('abcd')
    expect(ids('lean')).toBe('bdac')
    expect(ids('close')).toBe('adbc')
    expect(ids('thin')).toBe('bdac')
  })

  it('always puts bouts without a prediction last in model-based orders and never mutates the input', () => {
    const before = rows.map((r) => r.id).join('')
    for (const k of ['lean', 'close', 'thin'] as const) expect(ids(k).endsWith('c')).toBe(true)
    expect(rows.map((r) => r.id).join('')).toBe(before)
  })
})
