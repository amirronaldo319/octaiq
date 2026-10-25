import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createMemoryHistory } from './lib/history.ts'
import { buildMarketSnapshot } from './lib/marketSnapshot.ts'
import { createCardService } from './lib/service.ts'

/**
 * Writes dist/data/market.json from live odds. Run after `npm run build`. It exits cleanly, writing
 * nothing, when there is no key or no prices, so a build without secrets still deploys.
 */
const ROOT = resolve(import.meta.dirname, '..')
const key = process.env.ODDS_API_KEY?.trim()
if (!key) {
  console.info('No ODDS_API_KEY: skipping market prices. The site will show model probabilities only.')
  process.exit(0)
}

try {
  const service = createCardService({
    apiKey: key, fetchImpl: fetch, ttlMs: 0, history: createMemoryHistory(),
    loadFighters: async () => ({ fighters: [], warnings: [] }),
  })
  const odds = await service.getOdds()
  const market = buildMarketSnapshot(resolve(ROOT, 'data/events'), odds.events, new Date())
  const priced = Object.values(market.events).reduce((n, e) => n + Object.keys(e).length, 0)
  if (priced === 0) {
    console.info('The Odds API has no prices for the events on this site yet; skipping.')
    process.exit(0)
  }
  const out = resolve(ROOT, 'dist/data')
  mkdirSync(out, { recursive: true })
  writeFileSync(resolve(out, 'market.json'), JSON.stringify(market))
  console.info(`Wrote dist/data/market.json: ${priced} priced bouts across ${Object.keys(market.events).length} events. ${odds.quotaRemaining ?? '?'} API credits left.`)
} catch (err) {
  // Never fail the deploy over prices; report without echoing anything that could carry the key.
  console.warn(`Skipping market prices: ${err instanceof Error ? err.message.replace(key, '***') : 'unknown error'}`)
}
