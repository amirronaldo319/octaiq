import { describe, expect, it } from 'vitest'
import { FIGHTS } from '../data/card'
import type { Fight } from '../engine/types'
import { analyzeCard, analyzeFight, findValue } from './analysis'
import { agreementLabel, buildNarrative } from './narrative'

describe('analysis', () => {
  const analyses = analyzeCard(FIGHTS, 0.25)

  it('produces fair probabilities that sum to one', () => {
    for (const an of analyses) {
      expect((an.a.fairProb ?? NaN) + (an.b.fairProb ?? NaN)).toBeCloseTo(1)
      expect(an.vig).toBeGreaterThan(0)
    }
  })

  it('picks the highest price across books', () => {
    const an = analyses[0]
    const max = Math.max(...an.fight.books.map((l) => l.a))
    expect(an.a.bestOdds).toBe(max)
  })

  it('only returns positive-EV opportunities, best first', () => {
    const ops = findValue(analyses, 0)
    for (const o of ops) expect(o.ev).toBeGreaterThan(0)
    for (let i = 1; i < ops.length; i++) expect(ops[i - 1].ev).toBeGreaterThanOrEqual(ops[i].ev)
  })

  it('respects the minimum edge threshold', () => {
    const strict = findValue(analyses, 0.5)
    expect(strict).toHaveLength(0)
  })
})

describe('unpriced and stat-less fights', () => {
  const unpriced: Fight = { ...FIGHTS[0], books: [], history: [] }
  const noStats: Fight = { ...FIGHTS[1], statsMissing: true }

  it('has no market fields when no books exist', () => {
    const an = analyzeFight(unpriced, 0.25)
    expect(an.a).toMatchObject({ priced: false, fairProb: null, bestOdds: null, bestBook: null, edge: 0, ev: 0, kelly: 0 })
    expect(an.vig).toBeNull()
    expect(an.modelValid).toBe(true)
  })

  it('reports no edge or EV when the model is not valid, even with odds', () => {
    const an = analyzeFight(noStats, 0.25)
    expect(an.modelValid).toBe(false)
    expect(an.a.priced).toBe(true)
    expect(an.a.ev).toBe(0)
    expect(an.b.edge).toBe(0)
  })

  it('never lists value for fights without a valid model or price', () => {
    expect(findValue([analyzeFight(unpriced, 0.25), analyzeFight(noStats, 0.25)], -1)).toEqual([])
  })
})

describe('narrative', () => {
  it('builds evidence-linked reasons and always includes the unvalidated caveat', () => {
    const an = analyzeFight(FIGHTS[0], 0.25)
    const n = buildNarrative(FIGHTS[0], an.prediction)
    expect(n.forA.length + n.forB.length).toBeGreaterThan(0)
    expect(n.risks[0]).toContain('unvalidated')
    for (const line of [...n.forA, ...n.forB]) expect(line).toMatch(/:/)
  })

  it('flags long layoffs and small samples from the data', () => {
    const f: Fight = { ...FIGHTS[0], a: { ...FIGHTS[0].a, layoffDays: 700, record: '3-1-0' } }
    const n = buildNarrative(f, analyzeFight(f, 0.25).prediction)
    expect(n.risks.join(' ')).toContain('inactive for about 700 days')
    expect(n.risks.join(' ')).toContain('only 4 recorded fights')
  })

  it('labels agreement by threshold', () => {
    expect(agreementLabel(0.01)).toBe('Low')
    expect(agreementLabel(0.05)).toBe('Moderate')
    expect(agreementLabel(0.2)).toBe('High')
  })
})
