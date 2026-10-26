import { describe, expect, it } from 'vitest'
import { fairPrice, showPrice } from './oddsFormat'
import { agoText, marketState } from './marketState'

const at = (iso: string): number => Date.parse(iso)
const START = '2026-11-01T22:00:00Z'

describe('agoText', () => {
  it('reads seconds, minutes, hours and days', () => {
    expect(agoText(45_000)).toBe('45 seconds ago')
    expect(agoText(60_000)).toBe('1 minute ago')
    expect(agoText(3 * 3_600_000)).toBe('3 hours ago')
    expect(agoText(72 * 3_600_000)).toBe('3 days ago')
  })
})

describe('marketState', () => {
  const market = { newestQuote: '2026-10-31T09:50:00Z' }
  it('is unavailable without a price', () => {
    expect(marketState(undefined, undefined, START, at('2026-10-31T10:00:00Z')).state).toBe('unavailable')
  })
  it('is fresh, then aging, then stale, by the age of the last collection', () => {
    const fetched = '2026-10-31T10:00:00Z'
    expect(marketState(market, fetched, START, at('2026-10-31T10:10:00Z')).state).toBe('fresh')
    expect(marketState(market, fetched, START, at('2026-10-31T14:00:00Z')).state).toBe('aging')
    expect(marketState(market, fetched, START, at('2026-10-31T20:00:00Z')).state).toBe('stale')
    expect(marketState(market, fetched, START, at('2026-10-31T10:00:45Z')).label).toBe('Updated 45 seconds ago')
  })
  it('says plainly that only pre-fight prices exist once the event has started', () => {
    const s = marketState(market, '2026-11-01T20:00:00Z', START, at('2026-11-01T23:00:00Z'))
    expect(s.state).toBe('closed')
    expect(s.detail).toContain('In-play prices are not shown')
  })
  it('mentions bookmaker quotes that are much older than the collection', () => {
    const s = marketState({ newestQuote: '2026-10-31T01:00:00Z' }, '2026-10-31T10:00:00Z', START, at('2026-10-31T10:10:00Z'))
    expect(s.detail).toContain('newest bookmaker quote')
  })
})

describe('price formats', () => {
  it('shows a fair price in American or decimal and converts bookmaker prices', () => {
    expect(fairPrice(0.5, 'decimal')).toBe('2.00')
    expect(fairPrice(0.6, 'american')).toBe('-150')
    expect(fairPrice(0.4, 'american')).toBe('+150')
    expect(showPrice(-150, 'decimal')).toBe('1.67')
    expect(showPrice(130, 'decimal')).toBe('2.30')
    expect(showPrice(130, 'american')).toBe('+130')
  })
})
