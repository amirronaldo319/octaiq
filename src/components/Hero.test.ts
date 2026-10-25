import { describe, expect, it } from 'vitest'
import { splitTitle, venueTime } from './Hero'

describe('splitTitle', () => {
  it('splits the series from the headline', () => {
    expect(splitTitle('UFC Fight Night: Moicano vs. Nolan')).toEqual({ series: 'UFC Fight Night', headline: 'Moicano vs. Nolan' })
    expect(splitTitle('UFC 334: Gane vs. Hokit')).toEqual({ series: 'UFC 334', headline: 'Gane vs. Hokit' })
    expect(splitTitle('Just a title')).toEqual({ series: '', headline: 'Just a title' })
  })
})

describe('venueTime', () => {
  it('shows venue time with Eastern in brackets', () => {
    expect(venueTime('2026-11-01T00:00:00Z', 'America/Los_Angeles')).toBe('5:00 PM PDT (8:00 PM EDT)')
    expect(venueTime('2026-11-21T18:00:00Z', 'Asia/Qatar')).toMatch(/^9:00 PM .+ \(1:00 PM EST\)$/)
  })
  it('does not repeat itself when the venue is on Eastern time', () => {
    expect(venueTime('2026-11-15T02:00:00Z', 'America/New_York')).toBe('9:00 PM EST')
  })
})
