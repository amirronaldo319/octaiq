import { describe, expect, it } from 'vitest'
import { extractBooks, isOddsEvents, MAX_BOOKS, oddsUrl, PREFERRED_BOOKS, regionsFor, type OddsEvent } from './oddsApi.ts'

const book = (key: string, a = -150, b = 130) => ({
  key, title: key.toUpperCase(),
  markets: [{ key: 'h2h', outcomes: [{ name: 'A Fighter', price: a }, { name: 'B Fighter', price: b }] }],
})
const event = (keys: string[]): OddsEvent => ({
  id: 'e', commence_time: '2026-11-01T00:00:00Z', home_team: 'A Fighter', away_team: 'B Fighter',
  bookmakers: keys.map((k) => book(k)),
})

describe('extractBooks', () => {
  it('averages at most ten bookmakers, preferring the listed ones', () => {
    const extra = Array.from({ length: 6 }, (_, i) => `zz_extra_${i}`)
    const lines = extractBooks(event([...extra, ...PREFERRED_BOOKS]))
    expect(lines).toHaveLength(MAX_BOOKS)
    expect(lines.map((l) => l.book)).toEqual(PREFERRED_BOOKS.slice(0, MAX_BOOKS).map((k) => k.toUpperCase()).sort())
  })

  it('fills remaining places with unlisted bookmakers and keeps all when fewer than ten', () => {
    expect(extractBooks(event(['draftkings', 'someother']))).toHaveLength(2)
  })

  it('ignores duplicate bookmakers and invalid prices', () => {
    const ev = event(['draftkings', 'draftkings'])
    ev.bookmakers.push(book('fanduel', 0, 130), book('betmgm', 1.9, 2.1))
    expect(extractBooks(ev).map((l) => l.book)).toEqual(['DRAFTKINGS'])
  })

  it('asks for the US, extra US and EU regions', () => {
    const url = new URL(oddsUrl('k'))
    expect(url.searchParams.get('regions')).toBe('us,us2,eu')
  })

  it('lets a valid region list override the default, and ignores anything else', () => {
    expect(new URL(oddsUrl('k', 'us')).searchParams.get('regions')).toBe('us')
    expect(regionsFor('us,uk')).toBe('us,uk')
    expect(regionsFor('us;drop table')).toBe('us,us2,eu')
    expect(regionsFor('')).toBe('us,us2,eu')
  })

  it('accepts only responses with the fields it relies on', () => {
    expect(isOddsEvents([event(['dk'])])).toBe(true)
    expect(isOddsEvents([])).toBe(true)
    expect(isOddsEvents({})).toBe(false)
    expect(isOddsEvents([{ id: 'x' }])).toBe(false)
    expect(isOddsEvents([{ ...event(['dk']), commence_time: 'not a date' }])).toBe(false)
  })
})
