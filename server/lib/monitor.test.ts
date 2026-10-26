import { describe, expect, it } from 'vitest'
import type { EventPayload } from '../../src/engine/eventTypes.ts'
import { buildMonitor, type MonitorInput } from './monitor.ts'

const NOW = new Date('2026-10-26T12:00:00Z')
const event = (probs: number[], priors: [number, number] = [5, 5]): EventPayload => ({
  event: { id: 'e' },
  fights: probs.map((_, i) => ({ id: `e-${i}` })),
  resultsModel: { bouts: Object.fromEntries(probs.map((p, i) => [`e-${i}`, { probA: p, probB: 1 - p, priorA: priors[0], priorB: priors[1], eloDiff: 0 }])) },
}) as unknown as EventPayload

const base: MonitorInput = { now: NOW, events: [event([0.6, 0.55, 0.7, 0.62, 0.58, 0.66, 0.6, 0.57, 0.64, 0.61])], graded: [], identity: { checked: 20, quarantined: 0 }, market: null, trainingMeanConfidence: 0.62, trainingLogLoss: 0.65 }

describe('buildMonitor', () => {
  it('is quiet when nothing is wrong, and says no forecast has been graded', () => {
    const m = buildMonitor(base)
    expect(m.alerts).toEqual([])
    expect(m.prospective.note).toContain('No published forecast')
    expect(m.inputs).toMatchObject({ fights: 10, withForecast: 10, debutantBouts: 0 })
  })

  it('computes rolling log loss and accuracy over graded published forecasts', () => {
    const graded = [{ probA: 0.7, winner: 'a' as const }, { probA: 0.7, winner: 'b' as const }]
    const m = buildMonitor({ ...base, graded })
    expect(m.prospective.correct).toBe(1)
    expect(m.prospective.logLoss).toBeCloseTo((-Math.log(0.7) - Math.log(0.3)) / 2, 8)
  })

  it('raises an alert only for a sample large enough to matter', () => {
    const bad = (n: number) => Array.from({ length: n }, () => ({ probA: 0.8, winner: 'b' as const }))
    expect(buildMonitor({ ...base, graded: bad(10) }).alerts).toEqual([])
    expect(buildMonitor({ ...base, graded: bad(60) }).alerts.join(' ')).toContain('worse than a coin flip')
  })

  it('flags a shift in the forecast distribution, unmatched names, missing forecasts and stale prices', () => {
    const drifted = buildMonitor({ ...base, trainingMeanConfidence: 0.8 })
    expect(drifted.drift.flagged).toBe(true)
    const q = buildMonitor({ ...base, identity: { checked: 20, quarantined: 2 } })
    expect(q.alerts.join(' ')).toContain('2 fighter names need a person')
    const missing = buildMonitor({ ...base, events: [{ ...event([0.6]), fights: [{ id: 'e-0' }, { id: 'e-1' }] } as unknown as EventPayload] })
    expect(missing.alerts.join(' ')).toContain('no forecast')
    const stale = buildMonitor({ ...base, market: { generatedAt: '2026-10-25T00:00:00Z', source: '', attribution: '', events: { e: { 'e-0': { pA: 0.5, pLo: 0.4, pHi: 0.6, books: 5 } } } } })
    expect(stale.market).toMatchObject({ pricedBouts: 1, fights: 10 })
    expect(stale.alerts.join(' ')).toContain('hours ago')
  })

  it('compares the shadow challenger with production on graded forecasts that carry both', () => {
    const graded = [{ probA: 0.6, winner: 'a' as const, shadowProbA: 0.7 }, { probA: 0.6, winner: 'b' as const, shadowProbA: 0.5 }, { probA: 0.6, winner: 'a' as const }]
    const m = buildMonitor({ ...base, graded })
    expect(m.shadow?.graded).toBe(2)
    expect(m.shadow?.difference).toBeCloseTo(m.shadow!.shadowLogLoss - m.shadow!.productionLogLoss, 12)
    expect(buildMonitor(base).shadow).toBeNull()
  })

  it('counts bouts with a debutant', () => {
    expect(buildMonitor({ ...base, events: [event([0.6, 0.7], [0, 4])] }).inputs.debutantBouts).toBe(2)
  })
})
