import { describe, expect, it } from 'vitest'
import { createRng } from '../../src/engine/rng.ts'
import type { FeatureRow } from './features.ts'
import { classOf, hybridJoint, predictDirect, trainDirect } from './jointDirect.ts'

const row = (x: number[], result: 'a' | 'b', method: 'ko' | 'sub' | 'dec', i: number): FeatureRow => ({
  id: String(i), event: 'e', date: i, y: result === 'a' ? 1 : 0, x, priorA: 5, priorB: 5,
  ctx: { rounds: 3, weightClass: 'Lightweight Bout', method, result }, dist: new Array(11).fill(0), mw: [[0, 0, 0, 0], [0, 0, 0, 0]],
})

describe('direct joint model', () => {
  // Fighter A is stronger when x[0] > 0, and a favourite mostly wins by KO; an underdog who wins mostly wins by decision.
  const rng = createRng(11)
  const rows: FeatureRow[] = Array.from({ length: 1500 }, (_, i) => {
    const x = (rng() * 2 - 1) * 1.5
    const aWins = rng() < 1 / (1 + Math.exp(-2 * x))
    const favourite = (x > 0) === aWins
    const method = favourite ? (rng() < 0.7 ? 'ko' : 'dec') : (rng() < 0.2 ? 'ko' : 'dec')
    return row([x], aWins ? 'a' : 'b', method, i)
  })
  const model = trainDirect(rows, [0], { iterations: 150 })
  const at = (x: number) => predictDirect(model, { x: [x], dist: new Array(11).fill(0), ctx: { rounds: 3, weightClass: 'Lightweight Bout', method: 'dec', result: 'a' } }, [0])

  it('sums to one and is exactly antisymmetric', () => {
    const p = at(0.8)
    const q = at(-0.8)
    expect(Object.values(p).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 10)
    expect(p.aKo).toBeCloseTo(q.bKo, 12)
    expect(p.aDec).toBeCloseTo(q.bDec, 12)
    const even = at(0)
    expect(even.aKo).toBeCloseTo(even.bKo, 12)
  })

  it('lets the method depend on who is expected to win', () => {
    const p = at(1.2)
    const koIfA = p.aKo / (p.aKo + p.aSub + p.aDec)
    const koIfB = p.bKo / (p.bKo + p.bSub + p.bDec)
    expect(koIfA).toBeGreaterThan(koIfB + 0.2)
  })

  it('hybrid keeps the validated win probability and the per-winner method split', () => {
    const j = hybridJoint(0.6, at(0.5))
    expect(j.aKo + j.aSub + j.aDec).toBeCloseTo(0.6, 12)
    expect(j.bKo + j.bSub + j.bDec).toBeCloseTo(0.4, 12)
  })

  it('classifies only decisive results by the three main methods', () => {
    expect(classOf(row([0], 'b', 'sub', 1))).toBe(4)
    expect(classOf({ ctx: { result: 'a', method: 'dq', rounds: 3, weightClass: '' } })).toBeNull()
    expect(classOf({ ctx: { result: 'draw', method: 'dec', rounds: 3, weightClass: '' } })).toBeNull()
  })
})
