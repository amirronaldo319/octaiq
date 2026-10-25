import { describe, expect, it } from 'vitest'
import { createRng } from '../../src/engine/rng'
import { predictTrees, trainTrees } from './trees.ts'

describe('boosted trees', () => {
  const rng = createRng(3)
  const xs = Array.from({ length: 600 }, () => [rng() * 2 - 1, rng() * 2 - 1])
  const ys = xs.map((x) => (rng() < 1 / (1 + Math.exp(-3 * x[0])) ? 1 : 0))
  const model = trainTrees(xs, ys, { rounds: 40, minLeaf: 20 })

  it('learns the signal feature', () => {
    expect(predictTrees(model, [0.9, 0])).toBeGreaterThan(0.7)
    expect(predictTrees(model, [-0.9, 0])).toBeLessThan(0.3)
  })

  it('is exactly antisymmetric: swapping the fighters flips the probability', () => {
    const x = [0.4, -0.2]
    expect(predictTrees(model, x) + predictTrees(model, x.map((v) => -v))).toBeCloseTo(1, 12)
    expect(predictTrees(model, [0, 0])).toBeCloseTo(0.5, 12)
  })
})
