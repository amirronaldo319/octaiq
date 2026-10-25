import { describe, expect, it } from 'vitest'
import { impliedProb } from '../engine/odds'
import { betProfit, computeStats, type Bet } from './bets'

const bet = (over: Partial<Bet>): Bet => ({
  id: 'x', placedAt: 1, fightLabel: 'A vs B', pick: 'A', american: 100, stake: 10,
  modelProb: 0.55, status: 'open', ...over,
})

describe('betProfit', () => {
  it('pays out winners, charges losers, ignores pushes', () => {
    expect(betProfit(bet({ status: 'won', american: 150 }))).toBeCloseTo(15)
    expect(betProfit(bet({ status: 'lost' }))).toBe(-10)
    expect(betProfit(bet({ status: 'push' }))).toBe(0)
    expect(betProfit(bet({ status: 'open' }))).toBe(0)
  })
})

describe('computeStats', () => {
  it('handles an empty ledger', () => {
    const s = computeStats([], impliedProb)
    expect(s.settled).toBe(0)
    expect(s.roi).toBe(0)
    expect(s.avgClv).toBeNull()
  })

  it('computes roi, hit rate and drawdown', () => {
    const s = computeStats(
      [
        bet({ id: '1', placedAt: 1, status: 'won' }),
        bet({ id: '2', placedAt: 2, status: 'lost' }),
        bet({ id: '3', placedAt: 3, status: 'lost' }),
        bet({ id: '4', placedAt: 4, status: 'open' }),
      ],
      impliedProb,
    )
    expect(s.settled).toBe(3)
    expect(s.profit).toBe(-10)
    expect(s.staked).toBe(30)
    expect(s.hitRate).toBeCloseTo(1 / 3)
    expect(s.curve).toEqual([10, 0, -10])
    expect(s.maxDrawdown).toBe(20)
  })

  it('averages closing line value', () => {
    const s = computeStats([bet({ status: 'won', american: 100, closeFairProb: 0.55 })], impliedProb)
    expect(s.avgClv).toBeCloseTo(0.05)
  })
})
