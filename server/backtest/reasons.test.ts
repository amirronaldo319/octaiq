import { describe, expect, it } from 'vitest'
import { FEATURE_NAMES } from './features.ts'
import { explain } from './reasons.ts'

const col = (n: string): number => FEATURE_NAMES.indexOf(n as (typeof FEATURE_NAMES)[number])

describe('explain', () => {
  it('lists the biggest pushes toward the pick and the biggest against', () => {
    const columns = [col('elo'), col('age'), col('reach'), col('koLossRate')]
    // A is ahead on Elo (+1.0 log-odds), younger (age diff negative, weight positive => helps A), shorter reach (hurts A slightly)
    const why = explain(columns, [0.5, -0.2, -0.1, -0.05], [1.0, 0.4, -0.1, 0.2], 0.7)
    expect(why.pick).toBe('a')
    expect(why.for.map((r) => r.text)).toEqual(['Higher Elo rating', 'Younger', 'Fewer knockout losses'])
    expect(why.against.map((r) => r.text)).toEqual(['Shorter reach'])
  })

  it('describes the reasons from the favoured fighter\'s side when B is the pick', () => {
    const why = explain([col('elo')], [-0.5], [-0.8], 0.3)
    expect(why.pick).toBe('b')
    expect(why.for).toEqual([{ text: 'Higher Elo rating', strength: 0.8 }])
  })

  it('ignores tiny contributions and features without a phrase', () => {
    const why = explain([col('southpaw'), col('elo')], [1, 0.01], [0.9, 0.01], 0.55)
    expect(why.for).toEqual([])
    expect(why.against).toEqual([])
  })
})
