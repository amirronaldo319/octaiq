import { describe, expect, it } from 'vitest'
import { resolveZone } from './timezone'

describe('resolveZone', () => {
  it('uses the venue by default and a named zone when chosen', () => {
    expect(resolveZone('venue', 'Asia/Qatar')).toBe('Asia/Qatar')
    expect(resolveZone('Europe/London', 'Asia/Qatar')).toBe('Europe/London')
  })
  it('falls back to the venue for anything unknown', () => {
    expect(resolveZone('Mars/Olympus', 'America/New_York')).toBe('America/New_York')
  })
  it('reads the device zone', () => {
    expect(resolveZone('device', 'America/New_York').length).toBeGreaterThan(2)
  })
})
