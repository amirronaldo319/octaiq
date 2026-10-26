import { describe, expect, it } from 'vitest'
import { creditsPerCall, estimateUsage, isPollDue, PLANS, pollIntervalMinutes } from './plan.ts'

describe('credit cost', () => {
  it('is markets times regions', () => {
    expect(creditsPerCall(1, 'us,us2,eu')).toBe(3)
    expect(creditsPerCall(2, 'us')).toBe(2)
  })
})

describe('pollIntervalMinutes', () => {
  it('asks more often as the event approaches, never faster than 10 minutes, and stops at the start', () => {
    const hours = [200, 100, 48, 12, 3, 0.5]
    const intervals = hours.map((h) => pollIntervalMinutes(h) as number)
    expect(intervals).toEqual([720, 360, 180, 60, 15, 10])
    expect(pollIntervalMinutes(0)).toBeNull()
    expect(pollIntervalMinutes(-5)).toBeNull()
  })
})

describe('estimateUsage', () => {
  const DAY = 86_400_000
  const from = Date.UTC(2026, 10, 1)
  const to = from + 30 * DAY
  const weekly = [from + 5 * DAY, from + 12 * DAY, from + 19 * DAY, from + 26 * DAY]

  it('shows the free tier cannot follow weekly cards with three regions, and that the $30 plan can', () => {
    const u = estimateUsage(weekly, from, to, creditsPerCall())
    expect(u.credits).toBeGreaterThan(PLANS[0].creditsPerMonth)
    expect(u.credits).toBeLessThan(PLANS[1].creditsPerMonth)
  })

  it('uses nothing when no event is within two weeks', () => {
    expect(estimateUsage([from + 90 * DAY], from, to, 3).calls).toBe(0)
  })

  it('does not poll after an event has started', () => {
    const one = estimateUsage([from + 1 * DAY], from, to, 3)
    const none = estimateUsage([from - 1 * DAY], from, to, 3)
    expect(one.calls).toBeGreaterThan(0)
    expect(none.calls).toBe(0)
  })
})

describe('isPollDue', () => {
  const H = 3_600_000
  const now = Date.UTC(2026, 10, 1, 12)
  it('waits for the interval that fits the distance, with some slack', () => {
    expect(isPollDue(now + 100 * H, now - 5 * H, now).due).toBe(false)
    expect(isPollDue(now + 100 * H, now - 6 * H, now).due).toBe(true)
    expect(isPollDue(now + 3 * H, now - 20 * 60_000, now).due).toBe(true)
  })
  it('collects the first time, and never for no event, a far event or a started event', () => {
    expect(isPollDue(now + 10 * H, null, now).due).toBe(true)
    expect(isPollDue(undefined, null, now).due).toBe(false)
    expect(isPollDue(now + 20 * 24 * H, null, now).due).toBe(false)
    expect(isPollDue(now - H, null, now).reason).toContain('started')
  })
})
