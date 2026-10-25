import { describe, expect, it } from 'vitest'
import { FEATURE_NAMES } from './features.ts'
import { explain } from './reasons.ts'

const col = (n: string): number => FEATURE_NAMES.indexOf(n as (typeof FEATURE_NAMES)[number])

describe('explain', () => {
  it('sums related factors so a correlated pair cannot argue with itself', () => {
    // Elo and opposition quality push toward A; the "experience" weight is negative (they overlap), which would read as
    // a contradiction if shown alone. Within one family only the net push is reported.
    const columns = [col('elo'), col('oppElo'), col('experience'), col('age')]
    const why = explain(columns, [0.5, 0.4, 0.6, -0.2], [0.4, 0.7, -0.5, 0.4], 0.7)
    expect(why.pick).toBe('a')
    expect(why.for.map((r) => r.text.split(':')[0])).toEqual(['Record and ratings', 'Age and reach'])
    expect(why.for[0].strength).toBeCloseTo(0.6, 5)
    expect(why.against).toEqual([])
    // The overlapping factor stays in the detail list, with its negative push visible.
    expect(why.details.find((d) => d.text === 'More UFC experience')?.strength).toBeCloseTo(-0.5, 5)
  })

  it('names the biggest contributors that agree with a family\'s net direction', () => {
    const why = explain([col('elo'), col('winRate')], [0.5, 0.5], [1.0, -0.2], 0.7)
    // Win rate pushes against the net direction, so only Elo is named.
    expect(why.for[0].text).toBe('Record and ratings: higher Elo rating')
  })

  it('describes the reasons from the favoured fighter\'s side when B is the pick', () => {
    const why = explain([col('elo')], [-0.5], [-0.8], 0.3)
    expect(why.pick).toBe('b')
    expect(why.for).toEqual([{ text: 'Record and ratings: higher Elo rating', strength: 0.8 }])
  })

  it('puts families that work against the pick under "against"', () => {
    const why = explain([col('elo'), col('reach')], [0.5, -0.4], [0.9, -0.3], 0.7)
    expect(why.against.map((r) => r.text)).toEqual(['Age and reach: shorter reach'])
  })

  it('ignores tiny contributions and features without a phrase', () => {
    const why = explain([col('southpaw'), col('elo')], [1, 0.01], [0.9, 0.01], 0.55)
    expect(why.for).toEqual([])
    expect(why.against).toEqual([])
  })
})
