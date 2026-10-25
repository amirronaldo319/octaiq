import { describe, expect, it } from 'vitest'
import { checkFreshness } from './freshness.ts'

const now = new Date('2026-10-25T12:00:00Z')

describe('checkFreshness', () => {
  it('passes with recent results and a new report', () => {
    expect(checkFreshness({ now, lastBoutDate: '2026-10-24', reportGeneratedAt: '2026-10-25T11:30:00Z' })).toEqual([])
  })
  it('flags results older than thirty days', () => {
    expect(checkFreshness({ now, lastBoutDate: '2026-09-01', reportGeneratedAt: '2026-10-25T11:30:00Z' })[0].message).toContain('stopped')
  })
  it('flags a report that was not regenerated, and bad dates', () => {
    expect(checkFreshness({ now, lastBoutDate: '2026-10-24', reportGeneratedAt: '2026-10-20T00:00:00Z' })).toHaveLength(1)
    expect(checkFreshness({ now, lastBoutDate: 'nonsense', reportGeneratedAt: 'x' })).toHaveLength(2)
  })
})
