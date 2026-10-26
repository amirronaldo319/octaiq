import { readFileSync } from 'node:fs'
import { marketFromFights } from '../odds/consensus.ts'
import { latestSnapshot, parseEventFile } from './event.ts'
import { listEventFiles } from './eventService.ts'
import type { OddsEvent } from './oddsApi.ts'

/** What the public site shows about prices. Per-bookmaker quotes are never included. */
export interface MarketBout {
  /** Equal-weight mean of margin-removed probabilities that fighter A wins, one estimate per bookmaker family */
  pA: number
  /** Lowest and highest single-bookmaker margin-removed probability for A */
  pLo: number
  pHi: number
  /** Number of bookmakers behind the consensus */
  books: number
  /** The middle bookmaker estimate, less sensitive to one outlier */
  median?: number
  /** Oldest and newest provider timestamps behind the consensus */
  oldestQuote?: string | null
  newestQuote?: string | null
}

export interface MarketFile {
  /** When this file was built, which is also when the provider was last asked */
  generatedAt: string
  source: string
  attribution: string
  /** How the numbers were made, for anyone reading the file */
  method?: string
  /** Event id -> fight id -> consensus */
  events: Record<string, Record<string, MarketBout>>
}

export const MARKET_ATTRIBUTION = 'Prices: The Odds API. Shown as a consensus probability with the bookmaker margin removed; individual quotes are not published.'
export const MARKET_METHOD = 'For each bookmaker, both moneyline prices from that bookmaker are converted to decimal, inverted, and divided by their sum (proportional margin removal). Estimates from bookmakers that are stale, implausible or duplicate feeds are dropped, and the rest are averaged with equal weight. This is a market-implied estimate, not a true probability.'

export const isMarketFile = (v: unknown): v is MarketFile =>
  typeof v === 'object' && v !== null && typeof (v as MarketFile).events === 'object' && (v as MarketFile).events !== null

const r4 = (n: number): number => Math.round(n * 10_000) / 10_000

/**
 * Turns live odds into per-bout consensus probabilities for every event file in `dir`.
 * Bouts nobody has priced are left out, so the site shows nothing rather than a guess.
 */
export function buildMarketSnapshot(dir: string, odds: readonly OddsEvent[], now: Date): MarketFile {
  const events: MarketFile['events'] = {}
  for (const f of listEventFiles(dir).files) {
    const file = parseEventFile(JSON.parse(readFileSync(f.path, 'utf8')))
    const snapshot = latestSnapshot(file)
    const fights = snapshot.bouts.map((b) => ({ id: `${file.event.id}-${b.order}`, a: b.a, b: b.b }))
    const found = marketFromFights(fights, odds, now)
    const bouts: Record<string, MarketBout> = {}
    for (const [id, c] of Object.entries(found)) {
      bouts[id] = { pA: r4(c.pA), pLo: r4(c.pLo), pHi: r4(c.pHi), books: c.books, median: r4(c.median), oldestQuote: c.oldestQuote, newestQuote: c.newestQuote }
    }
    if (Object.keys(bouts).length > 0) events[file.event.id] = bouts
  }
  return { generatedAt: now.toISOString(), source: 'The Odds API', attribution: MARKET_ATTRIBUTION, method: MARKET_METHOD, events }
}
