import { describe, expect, it } from 'vitest'
import type { EventPayload } from '../engine/eventTypes'
import { isFightDay, untilText } from './FightNight'

const at = (iso: string): number => Date.parse(iso)

describe('untilText', () => {
  it('reads days, hours and minutes, and is null once passed', () => {
    expect(untilText('2026-11-01T12:00:00Z', at('2026-10-30T09:00:00Z'))).toBe('2d 3h')
    expect(untilText('2026-11-01T12:00:00Z', at('2026-11-01T09:50:00Z'))).toBe('2h 10m')
    expect(untilText('2026-11-01T12:00:00Z', at('2026-11-01T11:25:00Z'))).toBe('35m')
    expect(untilText('2026-11-01T12:00:00Z', at('2026-11-01T12:00:00Z'))).toBeNull()
  })
})

describe('isFightDay', () => {
  const p = { event: { prelimsStart: '2026-11-01T18:00:00Z', mainCardStart: '2026-11-01T22:00:00Z' } } as unknown as EventPayload
  it('is true from the morning of the event until a few hours after the main card', () => {
    expect(isFightDay(p, at('2026-11-01T06:00:00Z'))).toBe(true)
    expect(isFightDay(p, at('2026-11-02T02:00:00Z'))).toBe(true)
  })
  it('is false days before and well after', () => {
    expect(isFightDay(p, at('2026-10-29T06:00:00Z'))).toBe(false)
    expect(isFightDay(p, at('2026-11-02T12:00:00Z'))).toBe(false)
  })
})
