import { describe, expect, it } from 'vitest'
import { appendPoint, lineMovement, MOVE_THRESHOLD, toPublished } from './priceHistory.ts'

const bout = (pA: number, books = 8) => ({ pA, pLo: pA - 0.02, pHi: pA + 0.02, books })
const T = (h: number) => new Date(Date.UTC(2026, 10, 1, h))

describe('price history', () => {
  it('starts a history and stores only the consensus and bookmaker count', () => {
    const h = appendPoint(undefined, 'e', { '1': bout(0.6) }, T(0))
    expect(h?.points).toEqual([{ t: T(0).toISOString(), bouts: { '1': { pA: 0.6, books: 8 } } }])
    expect(JSON.stringify(h)).not.toContain('pLo')
  })

  it('does not add a point for noise, but does for a real move or a new bout', () => {
    const h1 = appendPoint(undefined, 'e', { '1': bout(0.6) }, T(0)) ?? undefined
    expect(appendPoint(h1, 'e', { '1': bout(0.6 + MOVE_THRESHOLD / 2) }, T(6))).toBeNull()
    expect(appendPoint(h1, 'e', { '1': bout(0.6 + MOVE_THRESHOLD * 2) }, T(6))?.points).toHaveLength(2)
    expect(appendPoint(h1, 'e', { '1': bout(0.6), '2': bout(0.5) }, T(6))?.points).toHaveLength(2)
  })

  it('adds nothing when no bout is priced', () => {
    expect(appendPoint(undefined, 'e', {}, T(0))).toBeNull()
  })

  it('reports opening, latest and movement once there are two looks', () => {
    let h = appendPoint(undefined, 'e', { '1': bout(0.6) }, T(0)) ?? undefined
    expect(lineMovement(h, '1')).toBeNull()
    h = appendPoint(h, 'e', { '1': bout(0.66) }, T(6)) ?? undefined
    const m = lineMovement(h, '1')
    expect(m?.open).toBe(0.6)
    expect(m?.latest).toBe(0.66)
    expect(m?.move).toBeCloseTo(0.06)
    expect(m?.looks).toBe(2)
  })

  it('publishes points keyed by event', () => {
    const h = appendPoint(undefined, 'e', { '1': bout(0.6) }, T(0))
    expect(Object.keys(toPublished(h ? [h] : [], T(1)).events)).toEqual(['e'])
  })
})
