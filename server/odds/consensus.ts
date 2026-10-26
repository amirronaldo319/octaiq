import { sameName } from '../lib/names.ts'
import { MAX_BOOKS, PREFERRED_BOOKS, type OddsEvent } from '../lib/oddsApi.ts'
import { normalizeQuotes, type Quote } from './quote.ts'

/** Feeds that are the same business or the same price source under several keys count once. */
export function bookFamily(key: string): string {
  if (/^hardrockbet/.test(key)) return 'hardrockbet'
  if (/^unibet/.test(key)) return 'unibet'
  if (/^betfair/.test(key)) return 'betfair'
  if (/^winamax/.test(key)) return 'winamax'
  if (/^leovegas/.test(key)) return 'leovegas'
  return key
}

export interface BookEstimate {
  bookmaker: string
  family: string
  /** Margin-removed probability that A wins, from this bookmaker's own two prices */
  pA: number
  /** The bookmaker's margin on this market: the two implied probabilities sum to 1 + margin */
  margin: number
  providerTimestamp: string | null
}

export interface Dropped {
  stale: number
  invalid: number
  duplicate: number
  /** Passed every check but left out because more than the maximum number of bookmakers quoted */
  capped: number
}

/** A two-way price pair is believable only with a small positive margin; below 0 would be an arbitrage, far above is a data error. */
export const MIN_MARGIN = 0
export const MAX_MARGIN = 0.3

/**
 * One margin-removed estimate per bookmaker, from both sides of that bookmaker's own market (never mixing best prices from
 * different books). Stale or implausible pairs are dropped and counted. The same bookmaker offered in several regions is
 * kept once, at its newest timestamp.
 */
export function bookEstimates(
  quotes: readonly Quote[],
  names: { a: string; b: string },
  opts: { now: Date; maxAgeHours: number },
): { estimates: BookEstimate[]; dropped: Dropped } {
  const dropped: Dropped = { stale: 0, invalid: 0, duplicate: 0, capped: 0 }
  const byBook = new Map<string, { a?: Quote; b?: Quote }[]>()
  for (const q of quotes) {
    const slot = sameName(q.selection, names.a) ? 'a' : sameName(q.selection, names.b) ? 'b' : null
    if (!slot || q.phase !== 'prematch') continue
    const list = byBook.get(q.bookmaker) ?? []
    // The same bookmaker returned by two regions arrives as separate entries; pair them by their order of appearance.
    const open = list.find((p) => !p[slot])
    if (open) open[slot] = q
    else list.push({ [slot]: q })
    byBook.set(q.bookmaker, list)
  }

  const found: BookEstimate[] = []
  for (const [bookmaker, pairs] of byBook) {
    const valid = pairs.filter((p): p is { a: Quote; b: Quote } => Boolean(p.a && p.b))
    if (valid.length === 0) {
      dropped.invalid++
      continue
    }
    const ranked = [...valid].sort((x, y) => Date.parse(y.a.providerTimestamp ?? y.a.ingestedAt) - Date.parse(x.a.providerTimestamp ?? x.a.ingestedAt))
    if (ranked.length > 1) dropped.duplicate += ranked.length - 1
    const { a, b } = ranked[0]
    const ts = a.providerTimestamp
    if (ts && opts.now.getTime() - Date.parse(ts) > opts.maxAgeHours * 3_600_000) {
      dropped.stale++
      continue
    }
    const qa = 1 / a.decimal
    const qb = 1 / b.decimal
    const margin = qa + qb - 1
    if (!(margin >= MIN_MARGIN) || margin > MAX_MARGIN) {
      dropped.invalid++
      continue
    }
    found.push({ bookmaker, family: bookFamily(bookmaker), pA: qa / (qa + qb), margin, providerTimestamp: ts })
  }

  // One estimate per family, then the preferred bookmakers first when more than the maximum are available.
  const byFamily = new Map<string, BookEstimate>()
  for (const e of found) {
    const prior = byFamily.get(e.family)
    if (!prior) byFamily.set(e.family, e)
    else {
      dropped.duplicate++
      if (Date.parse(e.providerTimestamp ?? '') > Date.parse(prior.providerTimestamp ?? '')) byFamily.set(e.family, e)
    }
  }
  const rank = (k: string): number => { const i = PREFERRED_BOOKS.indexOf(k); return i === -1 ? PREFERRED_BOOKS.length : i }
  const ordered = [...byFamily.values()].sort((x, y) => rank(x.bookmaker) - rank(y.bookmaker) || x.bookmaker.localeCompare(y.bookmaker))
  dropped.capped = Math.max(0, ordered.length - MAX_BOOKS)
  return { estimates: ordered.slice(0, MAX_BOOKS), dropped }
}

export interface Consensus {
  /** Equal-weight mean of the bookmakers' margin-removed probabilities for A */
  pA: number
  median: number
  pLo: number
  pHi: number
  books: number
  /** The oldest and newest provider timestamps behind this consensus, when the provider gave them */
  oldestQuote: string | null
  newestQuote: string | null
  dropped: Dropped
}

export function consensus(estimates: readonly BookEstimate[], dropped: Dropped): Consensus | null {
  if (estimates.length === 0) return null
  const ps = estimates.map((e) => e.pA).sort((x, y) => x - y)
  const mid = Math.floor(ps.length / 2)
  const stamps = estimates.map((e) => e.providerTimestamp).filter((t): t is string => t !== null).sort()
  return {
    pA: ps.reduce((s, v) => s + v, 0) / ps.length,
    median: ps.length % 2 ? ps[mid] : (ps[mid - 1] + ps[mid]) / 2,
    pLo: ps[0],
    pHi: ps[ps.length - 1],
    books: ps.length,
    oldestQuote: stamps[0] ?? null,
    newestQuote: stamps[stamps.length - 1] ?? null,
    dropped,
  }
}

export interface FightRef {
  id: string
  a: { name: string }
  b: { name: string }
}

/** Consensus for each fight that any provider event matches, oriented to the card's fighter order. */
export function marketFromFights(fights: readonly FightRef[], odds: readonly OddsEvent[], now: Date, maxAgeHours = 12): Record<string, Consensus> {
  const out: Record<string, Consensus> = {}
  for (const fight of fights) {
    for (const ev of odds) {
      const direct = sameName(ev.home_team, fight.a.name) && sameName(ev.away_team, fight.b.name)
      const reversed = sameName(ev.home_team, fight.b.name) && sameName(ev.away_team, fight.a.name)
      if (!direct && !reversed) continue
      const quotes = normalizeQuotes(ev, now)
      const { estimates, dropped } = bookEstimates(quotes, { a: fight.a.name, b: fight.b.name }, { now, maxAgeHours })
      const c = consensus(estimates, dropped)
      if (c) {
        out[fight.id] = c
        break
      }
    }
  }
  return out
}
