import { readFileSync } from 'node:fs'
import { devig } from '../../src/engine/odds.ts'
import { buildEventFights, latestSnapshot, parseEventFile } from './event.ts'
import { listEventFiles } from './eventService.ts'
import { createMemoryHistory } from './history.ts'
import type { OddsEvent } from './oddsApi.ts'

/** What the public site shows about prices. Per-bookmaker quotes are never included. */
export interface MarketBout {
  /** Average margin-removed probability that fighter A wins, across bookmakers */
  pA: number
  /** Lowest and highest single-bookmaker margin-removed probability for A */
  pLo: number
  pHi: number
  /** Number of bookmakers that quoted this bout */
  books: number
}

export interface MarketFile {
  generatedAt: string
  source: string
  attribution: string
  /** Event id -> fight id -> consensus */
  events: Record<string, Record<string, MarketBout>>
}

export const MARKET_ATTRIBUTION = 'Prices: The Odds API. Shown as a consensus probability with the bookmaker margin removed; individual quotes are not published.'

export const isMarketFile = (v: unknown): v is MarketFile =>
  typeof v === 'object' && v !== null && typeof (v as MarketFile).events === 'object' && (v as MarketFile).events !== null

/**
 * Turns live odds into per-bout consensus probabilities for every event file in `dir`.
 * Bouts nobody has priced are left out, so the site shows nothing rather than a guess.
 */
export function buildMarketSnapshot(dir: string, odds: readonly OddsEvent[], now: Date): MarketFile {
  const events: MarketFile['events'] = {}
  for (const f of listEventFiles(dir).files) {
    const file = parseEventFile(JSON.parse(readFileSync(f.path, 'utf8')))
    const fights = buildEventFights({ file, snapshot: latestSnapshot(file), fighters: [], odds, history: createMemoryHistory() })
    const bouts: Record<string, MarketBout> = {}
    for (const fight of fights) {
      if (fight.books.length === 0) continue
      const probs = fight.books.map((l) => devig(l.a, l.b).a)
      bouts[fight.id] = {
        pA: round4(probs.reduce((s, p) => s + p, 0) / probs.length),
        pLo: round4(Math.min(...probs)),
        pHi: round4(Math.max(...probs)),
        books: probs.length,
      }
    }
    if (Object.keys(bouts).length > 0) events[file.event.id] = bouts
  }
  return { generatedAt: now.toISOString(), source: 'The Odds API', attribution: MARKET_ATTRIBUTION, events }
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000
