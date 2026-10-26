import { describe, expect, it } from 'vitest'
import type { OddsEvent } from '../lib/oddsApi.ts'
import { bookEstimates, bookFamily, consensus, marketFromFights } from './consensus.ts'
import { normalizeQuotes } from './quote.ts'

const NOW = new Date('2026-10-26T12:00:00Z')
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString()

interface Book { key: string; a: number; b: number; at?: string | null; title?: string }
const event = (books: Book[], over: Partial<OddsEvent> = {}): OddsEvent => ({
  id: 'ev1', commence_time: '2026-11-01T00:00:00Z', home_team: 'Renato Moicano', away_team: 'Tom Nolan',
  bookmakers: books.map((b) => ({
    key: b.key, title: b.title ?? b.key,
    markets: [{ key: 'h2h', ...(b.at === null ? {} : { last_update: b.at ?? hoursAgo(1) }), outcomes: [{ name: 'Renato Moicano', price: b.a }, { name: 'Tom Nolan', price: b.b }] }],
  })),
  ...over,
})
const fights = [{ id: 'f1', a: { name: 'Renato Moicano' }, b: { name: 'Tom Nolan' } }]
const names = { a: 'Renato Moicano', b: 'Tom Nolan' }

describe('normalizeQuotes', () => {
  it('records decimal and original prices, provider and ingestion times, and the phase', () => {
    const q = normalizeQuotes(event([{ key: 'dk', a: -150, b: 130 }]), NOW)
    expect(q).toHaveLength(2)
    expect(q[0]).toMatchObject({ provider: 'the-odds-api', bookmaker: 'dk', market: 'h2h', american: -150, status: 'open', phase: 'prematch', scheduledStart: '2026-11-01T00:00:00Z' })
    expect(q[0].decimal).toBeCloseTo(1.6667, 4)
    expect(q[0].providerTimestamp).toBe(hoursAgo(1))
    expect(q[0].ingestedAt).toBe(NOW.toISOString())
  })
  it('marks an event that has started as in-play and ignores invalid prices and other markets', () => {
    const inplay = event([{ key: 'dk', a: -150, b: 130 }], { commence_time: '2026-10-26T11:00:00Z' })
    expect(normalizeQuotes(inplay, NOW).every((q) => q.phase === 'inplay')).toBe(true)
    const bad = event([{ key: 'x', a: 50, b: 130 }])
    bad.bookmakers[0].markets.push({ key: 'totals', outcomes: [{ name: 'Over', price: -110 }] })
    expect(normalizeQuotes(bad, NOW)).toHaveLength(1)
  })
})

describe('bookEstimates', () => {
  const opts = { now: NOW, maxAgeHours: 12 }
  it('removes the margin proportionally from each bookmaker’s own pair', () => {
    const { estimates } = bookEstimates(normalizeQuotes(event([{ key: 'dk', a: -150, b: 130 }]), NOW), names, opts)
    const qa = 1 / 1.6667
    const qb = 1 / 2.3
    expect(estimates[0].pA).toBeCloseTo(qa / (qa + qb), 4)
    expect(estimates[0].margin).toBeCloseTo(qa + qb - 1, 4)
  })

  it('never combines the best price from one book with the best from another', () => {
    // Book 1 is generous on A, book 2 on B. A "best price" fair line would show a market that no one offers.
    const e = event([{ key: 'one', a: 140, b: -170 }, { key: 'two', a: 100, b: -120 }])
    const { estimates } = bookEstimates(normalizeQuotes(e, NOW), names, opts)
    expect(estimates.map((x) => x.bookmaker).sort()).toEqual(['one', 'two'])
    const mixed = (1 / 2.4) / (1 / 2.4 + 1 / (1 + 100 / 120))
    expect(estimates.every((x) => Math.abs(x.pA - mixed) > 1e-6)).toBe(true)
  })

  it('drops stale quotes, implausible margins and quotes with only one side, and counts them', () => {
    const e = event([
      { key: 'fresh', a: -110, b: -110 },
      { key: 'old', a: -110, b: -110, at: hoursAgo(30) },
      { key: 'arb', a: 150, b: 150 },
      { key: 'huge', a: -300, b: -300 },
    ])
    e.bookmakers.push({ key: 'half', title: 'half', markets: [{ key: 'h2h', outcomes: [{ name: 'Renato Moicano', price: -110 }] }] })
    const { estimates, dropped } = bookEstimates(normalizeQuotes(e, NOW), names, opts)
    expect(estimates.map((x) => x.bookmaker)).toEqual(['fresh'])
    expect(dropped).toMatchObject({ stale: 1, invalid: 3 })
  })

  it('counts a bookmaker offered in two regions once, at its newest timestamp, and related feeds as one family', () => {
    const e = event([{ key: 'betonlineag', a: -120, b: 100, at: hoursAgo(5) }, { key: 'betonlineag', a: -130, b: 110, at: hoursAgo(1) }, { key: 'hardrockbet', a: -110, b: -110 }, { key: 'hardrockbet_fl', a: -115, b: -105 }])
    const { estimates, dropped } = bookEstimates(normalizeQuotes(e, NOW), names, opts)
    expect(estimates.map((x) => x.family).sort()).toEqual(['betonlineag', 'hardrockbet'])
    expect(dropped.duplicate).toBe(2)
    expect(estimates.find((x) => x.bookmaker === 'betonlineag')?.providerTimestamp).toBe(hoursAgo(1))
    expect(bookFamily('unibet_eu')).toBe('unibet')
    expect(bookFamily('draftkings')).toBe('draftkings')
  })

  it('caps at ten, keeping the preferred bookmakers, and ignores in-play quotes', () => {
    const keys = ['pinnacle', 'draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'bovada', 'betonlineag', 'betrivers', 'espnbet', 'fanatics', 'zz1', 'zz2']
    const { estimates, dropped } = bookEstimates(normalizeQuotes(event(keys.map((k) => ({ key: k, a: -110, b: -110 }))), NOW), names, opts)
    expect(estimates).toHaveLength(10)
    expect(estimates.map((x) => x.bookmaker)).not.toContain('zz1')
    expect(dropped.capped).toBe(2)
    const started = event([{ key: 'dk', a: -110, b: -110 }], { commence_time: '2026-10-26T11:00:00Z' })
    expect(bookEstimates(normalizeQuotes(started, NOW), names, opts).estimates).toEqual([])
  })
})

describe('consensus and marketFromFights', () => {
  it('averages the books equally and reports the spread, median and quote times', () => {
    const e = event([{ key: 'a1', a: -110, b: -110, at: hoursAgo(3) }, { key: 'a2', a: -200, b: 170, at: hoursAgo(1) }, { key: 'a3', a: 120, b: -140, at: hoursAgo(2) }])
    const { estimates, dropped } = bookEstimates(normalizeQuotes(e, NOW), names, { now: NOW, maxAgeHours: 12 })
    const c = consensus(estimates, dropped)!
    expect(c.books).toBe(3)
    expect(c.pA).toBeCloseTo(estimates.reduce((s, x) => s + x.pA, 0) / 3, 10)
    expect(c.pLo).toBeLessThanOrEqual(c.median)
    expect(c.median).toBeLessThanOrEqual(c.pHi)
    expect(c.oldestQuote).toBe(hoursAgo(3))
    expect(c.newestQuote).toBe(hoursAgo(1))
  })

  it('orients to the card and returns nothing for an unpriced bout', () => {
    const direct = marketFromFights(fights, [event([{ key: 'dk', a: 150, b: -170 }])], NOW).f1.pA
    const reversed = event([{ key: 'dk', a: 150, b: -170 }], { home_team: 'Tom Nolan', away_team: 'Renato Moicano' })
    reversed.bookmakers[0].markets[0].outcomes.reverse()
    const flipped = marketFromFights(fights, [reversed], NOW).f1.pA
    expect(flipped).toBeCloseTo(direct, 10)
    expect(marketFromFights([{ id: 'x', a: { name: 'Nobody Known' }, b: { name: 'Also Nobody' } }], [event([{ key: 'dk', a: 150, b: -170 }])], NOW)).toEqual({})
    expect(consensus([], { stale: 0, invalid: 0, duplicate: 0, capped: 0 })).toBeNull()
  })

  it('treats a missing provider timestamp as unknown rather than stale', () => {
    const c = marketFromFights(fights, [event([{ key: 'dk', a: -110, b: -110, at: null }])], NOW).f1
    expect(c.books).toBe(1)
    expect(c.newestQuote).toBeNull()
  })
})
