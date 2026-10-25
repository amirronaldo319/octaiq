import { describe, expect, it } from 'vitest'
import { bandsOf, reviewEvent, type ReviewBout } from './review'

const bout = (a: string, b: string, probA: number, winner?: 'a' | 'b'): ReviewBout => ({ a, b, probA, winner })

describe('reviewEvent', () => {
  it('says nothing for a card with no results', () => {
    expect(reviewEvent([bout('A', 'B', 0.6)])).toBeNull()
  })

  it('finds the most confident miss, the biggest upset, and the coin flips', () => {
    const r = reviewEvent([
      bout('Ann', 'Bea', 0.8, 'b'),
      bout('Cat', 'Dee', 0.7, 'a'),
      bout('Eve', 'Fay', 0.52, 'a'),
      bout('Gus', 'Hal', 0.45, 'a'),
    ])
    expect(r?.picked).toBe(2)
    expect(r?.misses).toEqual([{ pick: 'Ann', winner: 'Bea', confidence: 0.8 }, { pick: 'Hal', winner: 'Gus', confidence: 0.55 }])
    const text = r?.lines.join(' ') ?? ''
    expect(text).toContain('Most confident miss: Ann at 80% lost to Bea')
    expect(text).toContain('Biggest upset: Bea won with a 20% chance')
    expect(text).toContain('Near coin flips (under 60%): right 1 of 2')
  })

  it('tells luck from a real miss using the model’s own probabilities', () => {
    const bad = Array.from({ length: 12 }, (_, i) => bout(`A${i}`, `B${i}`, 0.75, 'b'))
    expect(reviewEvent(bad)?.lines.join(' ')).toContain('worse than its own confidence')
    const fine = Array.from({ length: 12 }, (_, i) => bout(`A${i}`, `B${i}`, 0.75, i < 9 ? 'a' : 'b'))
    expect(reviewEvent(fine)?.lines.join(' ')).toContain('within the normal swing')
  })
})

describe('bandsOf', () => {
  it('flags only bands with enough fights that fell well short of what was said', () => {
    const weak = Array.from({ length: 40 }, (_, i) => bout('A', 'B', 0.8, i < 24 ? 'a' : 'b'))
    const ok = Array.from({ length: 40 }, (_, i) => bout('C', 'D', 0.55, i < 22 ? 'a' : 'b'))
    const { bands, weaknesses } = bandsOf([weak, ok])
    expect(bands.map((b) => b.n)).toEqual([40, 0, 40])
    expect(weaknesses).toHaveLength(1)
    expect(weaknesses[0]).toContain('70% and up')
    expect(weaknesses[0]).toContain('60%')
  })
  it('ignores ungraded bouts and small samples', () => {
    expect(bandsOf([[bout('A', 'B', 0.9)], [bout('A', 'B', 0.9, 'b')]]).weaknesses).toEqual([])
  })
})
