import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createMemoryHistory } from './lib/history.ts'
import { buildMarketSnapshot } from './lib/marketSnapshot.ts'
import { appendPoint, toPublished, type PriceHistory } from './lib/priceHistory.ts'
import { createCardService } from './lib/service.ts'
import { writeIfChanged } from './lib/stableWrite.ts'
import { listEventFiles } from './lib/eventService.ts'
import { parseEventFile } from './lib/event.ts'

/**
 * Looks at live prices once, then (1) appends to data/prices/<event>.json when the consensus moved, so the
 * repository slowly builds an opening-to-closing record, and (2) writes public/data/market.json and
 * public/data/prices.json for the site. It exits cleanly, changing nothing, without a key or prices.
 */
const ROOT = resolve(import.meta.dirname, '..')
const PRICES = resolve(ROOT, 'data/prices')
const OUT = resolve(ROOT, 'public/data')
const key = process.env.ODDS_API_KEY?.trim()
if (!key) {
  console.info('No ODDS_API_KEY: skipping prices. The site will show model probabilities only.')
  process.exit(0)
}

try {
  const service = createCardService({
    apiKey: key, fetchImpl: fetch, ttlMs: 0, history: createMemoryHistory(),
    loadFighters: async () => ({ fighters: [], warnings: [] }),
  })
  const odds = await service.getOdds()
  const now = new Date()
  const market = buildMarketSnapshot(resolve(ROOT, 'data/events'), odds.events, now)
  const priced = Object.values(market.events).reduce((n, e) => n + Object.keys(e).length, 0)
  if (priced === 0) {
    console.info('The Odds API has no prices for the events on this site yet; skipping.')
    process.exit(0)
  }
  mkdirSync(PRICES, { recursive: true })
  mkdirSync(OUT, { recursive: true })

  const starts = new Map(listEventFiles(resolve(ROOT, 'data/events')).files.map((f) => {
    const ev = parseEventFile(JSON.parse(readFileSync(f.path, 'utf8'))).event
    return [ev.id, Date.parse(ev.mainCardStart)] as const
  }))
  for (const [eventId, bouts] of Object.entries(market.events)) {
    // Once an event has started the last saved look is its closing line; later prices are in-play.
    if ((starts.get(eventId) ?? Infinity) <= now.getTime()) continue
    const path = resolve(PRICES, `${eventId}.json`)
    const existing = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as PriceHistory) : undefined
    const updated = appendPoint(existing, eventId, bouts, now)
    if (updated) writeFileSync(path, JSON.stringify(updated))
  }

  const all = readdirSync(PRICES).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(resolve(PRICES, n), 'utf8')) as PriceHistory)
  writeIfChanged(resolve(OUT, 'market.json'), JSON.stringify(market))
  writeIfChanged(resolve(OUT, 'prices.json'), JSON.stringify(toPublished(all, now)))
  console.info(`Prices: ${priced} priced bouts across ${Object.keys(market.events).length} events, ${all.length} price histories. ${odds.quotaRemaining ?? '?'} API credits left.`)
} catch (err) {
  console.warn(`Skipping prices: ${err instanceof Error ? err.message.replace(key, '***') : 'unknown error'}`)
}
