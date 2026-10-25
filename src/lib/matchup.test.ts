import { describe, expect, it } from 'vitest'
import type { Career, CareerRow } from '../../server/backtest/careers'
import { adjustedForm, conditionsFor, lastFive, oppositionLabel, pathsToVictory, roundHistory, whatCouldChange } from './matchup'

const row = (over: Partial<CareerRow> = {}): CareerRow => ({
  date: '2026-01-10', event: 'E', opponent: 'O', result: 'W', method: 'Decision', weightClass: 'Lightweight Bout', eloAfter: 1550, oppElo: 1500, rounds: 3, ...over,
})
const career = (timeline: CareerRow[], over: Partial<Career> = {}): Career => ({
  name: 'X', slug: 'x', matched: true, fights: timeline.length, wins: timeline.filter((r) => r.result === 'W').length,
  losses: timeline.filter((r) => r.result === 'L').length, draws: 0, noContests: 0, koWins: 0, subWins: 0, decisionWins: 0,
  eloNow: 1550, eloPeak: 1600, timeline, eloSeries: [], recent: null, ...over,
})

describe('opposition and round history', () => {
  it('labels who a fighter faced against their own rating', () => {
    expect(oppositionLabel(1640, 1550)).toBe('Tougher')
    expect(oppositionLabel(1560, 1550)).toBe('Similar')
    expect(oppositionLabel(1400, 1550)).toBe('Easier')
  })
  it('splits results by three and five rounds and ignores unknown lengths', () => {
    const c = career([row({ rounds: 5 }), row({ rounds: 5, result: 'L' }), row(), row({ rounds: null })])
    expect(roundHistory(c)).toEqual({ three: { wins: 1, losses: 0, fights: 1 }, five: { wins: 1, losses: 1, fights: 2 } })
  })
  it('takes the five most recent fights', () => {
    expect(lastFive(career(Array.from({ length: 8 }, () => row())))).toHaveLength(5)
    expect(lastFive(undefined)).toEqual([])
  })
})

describe('adjustedForm', () => {
  it('measures output against what those opponents usually absorbed', () => {
    const rows = [row({ sigPerMin: 4, oppUsualSigAbsorbed: 2, tdPer15: 3, oppUsualTdAbsorbed: 1.5 }), row({ sigPerMin: 3, oppUsualSigAbsorbed: 3, tdPer15: 0, oppUsualTdAbsorbed: 1.5 })]
    expect(adjustedForm(career(rows))).toEqual({ fights: 2, strikes: 1.4, takedowns: 1 })
  })
  it('says nothing with fewer than two comparable fights', () => {
    expect(adjustedForm(career([row({ sigPerMin: 4, oppUsualSigAbsorbed: 2 }), row({ sigPerMin: 3, oppUsualSigAbsorbed: null })]))).toBeNull()
  })
})

describe('conditionsFor', () => {
  it('flags a long layoff and a move in weight', () => {
    const c = career([row({ date: '2025-06-01', weightClass: 'Welterweight Bout' })])
    const out = conditionsFor(c, '2026-11-01T00:00:00Z', 'Lightweight')
    expect(out.map((o) => o.text).join(' | ')).toMatch(/months since the last fight/)
    expect(out.some((o) => o.text.startsWith('Dropping down'))).toBe(true)
  })
  it('flags a quick turnaround and stays quiet for a normal gap', () => {
    expect(conditionsFor(career([row({ date: '2026-10-10' })]), '2026-11-01T00:00:00Z', 'Lightweight').map((o) => o.text)).toEqual(['Fought only 22 days earlier'])
    expect(conditionsFor(career([row({ date: '2026-06-01' })]), '2026-11-01T00:00:00Z', 'Lightweight')).toEqual([])
  })
  it('is empty for a debutant', () => {
    expect(conditionsFor(career([]), '2026-11-01T00:00:00Z', 'Lightweight')).toEqual([])
  })
})

describe('pathsToVictory', () => {
  it('lists only paths the record supports, at most three', () => {
    const self = career(Array.from({ length: 5 }, () => row()), { wins: 5, koWins: 3, subWins: 2, decisionWins: 0 })
    const opp = career([row({ result: 'L', method: 'KO/TKO' }), row({ result: 'L', method: 'Submission' })], { losses: 2, wins: 0 })
    const out = pathsToVictory(self, opp)
    expect(out.length).toBeLessThanOrEqual(3)
    expect(out[0]).toContain('3 of 5 wins')
    expect(out.join(' ')).toContain('finished in 2 of 2')
  })
  it('gives nothing for an unmatched or empty record', () => {
    expect(pathsToVictory(undefined, undefined)).toEqual([])
    expect(pathsToVictory(career([], { matched: false }), undefined)).toEqual([])
  })
})

describe('whatCouldChange', () => {
  it('always ends with what the model cannot see, and adds only the points that apply', () => {
    const none = whatCouldChange({ tags: [], priorMin: 12, rangeWidth: 0.1, marketGapPoints: 1, conditions: [] })
    expect(none).toHaveLength(1)
    expect(none[0]).toContain('Injuries')
    const many = whatCouldChange({ tags: ['Replacement opponent'], priorMin: 1, rangeWidth: 0.3, marketGapPoints: -8, conditions: [{ text: 'x', tone: 'warn' }] })
    expect(many).toHaveLength(6)
    expect(many.join(' ')).toContain('8 points')
  })
})
