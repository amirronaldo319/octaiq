import { describe, expect, it } from 'vitest'
import { stageOf } from './lifecycle'

const lock = '2026-10-31T21:00:00Z'
const at = (iso: string): number => Date.parse(iso)

describe('stageOf', () => {
  it('is Draft before anything has been saved', () => {
    expect(stageOf({ lockedAt: lock, entries: 0, status: 'upcoming' }, at('2026-10-26T00:00:00Z')).stage).toBe('draft')
  })

  it('is Published before the lock, even though a forecast is already saved', () => {
    expect(stageOf({ lockedAt: lock, entries: 1, status: 'upcoming' }, at('2026-10-26T00:00:00Z')).stage).toBe('published')
  })
  it('is Updated once a second version has been saved', () => {
    expect(stageOf({ lockedAt: lock, entries: 3, status: 'upcoming' }, at('2026-10-26T00:00:00Z')).stage).toBe('updated')
  })
  it('is Locked from the lock time until results arrive', () => {
    expect(stageOf({ lockedAt: lock, entries: 2, status: 'upcoming' }, at('2026-10-31T22:00:00Z')).stage).toBe('locked')
    const s = stageOf({ lockedAt: lock, entries: 2, status: 'awaiting-results' }, at('2026-11-02T00:00:00Z'))
    expect(s.stage).toBe('locked')
    expect(s.detail).toContain('Waiting')
  })
  it('is Graded once results are in', () => {
    expect(stageOf({ lockedAt: lock, entries: 2, status: 'graded' }, at('2026-11-05T00:00:00Z')).stage).toBe('graded')
  })
})
