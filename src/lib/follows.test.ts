import { describe, expect, it } from 'vitest'
import { emptyFollows, nextBouts, toggleBout, toggleFighter } from './follows'
import { slugify } from './slug'

describe('follows', () => {
  it('follows and unfollows without mutating the old state', () => {
    const base = emptyFollows()
    const one = toggleFighter(base, 'jon-jones', 'Jon Jones', 1)
    expect(base.fighters).toEqual({})
    expect(one.fighters['jon-jones']).toEqual({ name: 'Jon Jones', at: 1 })
    expect(toggleFighter(one, 'jon-jones', 'Jon Jones')).toEqual(emptyFollows())
  })

  it('saves and removes a bout', () => {
    const b = { boutId: 'e-1', eventId: 'e', eventTitle: 'E', a: 'A', b: 'B', at: 1 }
    const saved = toggleBout(emptyFollows(), b)
    expect(saved.bouts['e-1']).toEqual(b)
    expect(toggleBout(saved, b).bouts).toEqual({})
  })

  const ev = (id: string, main: string, prelim: string) => ({
    event: { id, title: id, prelimsStart: prelim, mainCardStart: main },
    fights: [
      { id: `${id}-1`, a: { name: 'Jon Jones' }, b: { name: 'Tom Aspinall' }, bout: { card: 'main' as const } },
      { id: `${id}-2`, a: { name: 'Ann Lee' }, b: { name: 'Bea Kim' }, bout: { card: 'prelim' as const } },
    ],
  })

  it("finds a followed fighter's next bout, uses the right card start, and skips finished events", () => {
    const f = toggleFighter(toggleFighter(emptyFollows(), 'jon-jones', 'Jon Jones'), 'bea-kim', 'Bea Kim')
    const now = Date.parse('2026-11-10T00:00:00Z')
    const out = nextBouts(f, [ev('past', '2026-10-01T00:00:00Z', '2026-09-30T20:00:00Z'), ev('soon', '2026-11-15T02:00:00Z', '2026-11-14T22:00:00Z')], slugify, now)
    expect(out.map((o) => [o.eventId, o.fighter, o.opponent, o.start])).toEqual([
      ['soon', 'Bea Kim', 'Ann Lee', '2026-11-14T22:00:00Z'],
      ['soon', 'Jon Jones', 'Tom Aspinall', '2026-11-15T02:00:00Z'],
    ])
  })
})
