import { describe, expect, it } from 'vitest'
import { score, togglePick, type MyPick } from './picks'

const pick = (boutId: string, side: 'a' | 'b', extra: Partial<MyPick> = {}): MyPick => ({ boutId, side, a: 'A', b: 'B', eventTitle: 'E', at: 1, ...extra })

describe('picks', () => {
  it('sets, switches and removes a pick without mutating the old object', () => {
    const empty = {}
    const one = togglePick(empty, pick('x-1', 'a'))
    expect(empty).toEqual({})
    expect(one['x-1'].side).toBe('a')
    expect(togglePick(one, pick('x-1', 'b'))['x-1'].side).toBe('b')
    expect(togglePick(one, pick('x-1', 'a'))).toEqual({})
  })

  it('scores yours, the model and the market on graded bouts only', () => {
    const picks = {
      'x-1': pick('x-1', 'a', { modelProbA: 0.7, marketProbA: 0.4 }),
      'x-2': pick('x-2', 'b', { modelProbA: 0.3 }),
      'x-3': pick('x-3', 'a'),
    }
    const card = score(picks, { 'x-1': 'a', 'x-2': 'a' })
    expect(card).toEqual({ graded: 2, yours: 1, model: 1, market: 0, marketGraded: 1 })
  })
})
