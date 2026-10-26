import { describe, expect, it } from 'vitest'
import { emptyRegistry, recordRun, rollback, type RunSummary } from './registry.ts'

const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  model: 'm-0.2', at: '2026-10-26T00:00:00Z', dataVersion: 'aaaa', featurePipeline: 'features-3', codeCommit: 'abc123', seed: 1, testPeriod: '2014-2026', n: 100,
  logLoss: { estimate: 0.65, lo: 0.64, hi: 0.66 }, brier: 0.23, accuracy: 0.6, calibrationSlope: 0.95, config: {},
  challengers: [
    { name: 'Boosted trees', incumbent: 'logistic', mode: 'reject', reasons: ['worse'], estimate: 0.004, foldWinShare: 0.3 },
    { name: 'Ensemble', incumbent: 'logistic', mode: 'shadow', reasons: ['inconclusive'], estimate: -0.0005, foldWinShare: 0.6 },
    { name: 'Stats', incumbent: 'results', mode: 'promote', reasons: ['better'], estimate: -0.007, foldWinShare: 0.8 },
  ], ...over,
})

describe('recordRun', () => {
  it('records production once and the non-promoted challengers with their decision', () => {
    const reg = recordRun(emptyRegistry(), run())
    expect(reg.production).toBe('m-0.2@aaaa')
    expect(reg.records.map((r) => [r.model, r.status])).toEqual([['m-0.2', 'production'], ['Boosted trees', 'rejected'], ['Ensemble', 'shadow']])
    expect(reg.records[2].decision).toContain('inconclusive')
  })

  it('is idempotent for the same model and data, and demotes the old production record for new data', () => {
    const once = recordRun(emptyRegistry(), run())
    expect(recordRun(once, run()).records).toHaveLength(once.records.length)
    const next = recordRun(once, run({ dataVersion: 'bbbb', codeCommit: 'def456' }))
    expect(next.production).toBe('m-0.2@bbbb')
    expect(next.records.find((r) => r.id === 'm-0.2@aaaa')?.status).toBe('previous')
    expect(next.records.filter((r) => r.status === 'production')).toHaveLength(1)
  })

  it('does not mutate the registry it was given', () => {
    const reg = recordRun(emptyRegistry(), run())
    const copy = JSON.stringify(reg)
    recordRun(reg, run({ dataVersion: 'cccc' }))
    expect(JSON.stringify(reg)).toBe(copy)
  })
})

describe('rollback', () => {
  const reg = recordRun(recordRun(emptyRegistry(), run()), run({ dataVersion: 'bbbb', codeCommit: 'def456' }))
  it('points production at an earlier record and says how to restore its code', () => {
    const { registry, instructions } = rollback(reg, 'm-0.2@aaaa')
    expect(registry.production).toBe('m-0.2@aaaa')
    expect(registry.records.filter((r) => r.status === 'production')).toHaveLength(1)
    expect(instructions).toContain('git checkout abc123')
  })
  it('refuses unknown records and ones that were never in production', () => {
    expect(() => rollback(reg, 'nope')).toThrow(/No record/)
    expect(() => rollback(reg, 'Boosted trees@aaaa')).toThrow(/never in production/)
  })
})
