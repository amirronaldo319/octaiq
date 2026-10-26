import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderResearch, type NeuralResults, type Results, type RoundsResults } from './researchMd.ts'

const dir = resolve(import.meta.dirname, '../../data/experiments')
const have = existsSync(resolve(dir, 'results.json'))
const read = <T>(f: string): T | null => (existsSync(resolve(dir, f)) ? (JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as T) : null)

describe('committed research results', () => {
  it.skipIf(!have)('reproduce the TypeScript baseline and obey the protocol they describe', () => {
    const r = read<Results>('results.json') as Results
    expect(Math.abs(r.replication.difference)).toBeLessThan(5e-5)
    expect(r.protocol.noUntouchedHoldout).toBe(true)
    expect(r.protocol.ensembleMembers.length).toBeGreaterThanOrEqual(5)
    for (const [k, m] of Object.entries(r.models)) {
      if (!m.decision) continue
      expect(['promote', 'shadow', 'reject'], k).toContain(m.decision.mode)
      // A "promote" must satisfy every part of the predeclared gate, however it was computed.
      if (m.decision.mode === 'promote') {
        expect(m.vsBaseline!.hi, k).toBeLessThan(0)
        expect(m.vsBaseline!.estimate, k).toBeLessThanOrEqual(-0.002)
        expect(m.decision.adjustedInterval!.hi, k).toBeLessThan(0)
      }
    }
  })

  it.skipIf(!have)('render into a report with no placeholders', () => {
    const md = renderResearch(read<Results>('results.json') as Results, read<NeuralResults>('neural.json'), read<RoundsResults>('rounds.json'))
    expect(md).toContain('Reproduction check')
    expect(md).toContain('There is no untouched holdout')
    expect(md).not.toMatch(/NaN|undefined|\[object/)
  })

  it.skipIf(!have)('keep round forecasts off unless an interval against the base rate is below zero', () => {
    const rounds = read<RoundsResults>('rounds.json')
    if (!rounds) return
    const anyBelowZero = Object.values(rounds.results).some((v) => v.logLoss.difference.hi < 0)
    expect(rounds.status).toBe(anyBelowZero ? 'experimental' : 'unavailable')
  })
})
