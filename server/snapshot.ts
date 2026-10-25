import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildStaticEvent, readBacktestForPublishing } from './lib/snapshot.ts'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = resolve(ROOT, 'public/data')

const event = await buildStaticEvent(ROOT)
if (event.resultsModel.status !== 'available') {
  console.error(`Results model unavailable: ${event.resultsModel.reason}. Run \`npm run backtest\` first.`)
  process.exit(1)
}
const backtest = readBacktestForPublishing(ROOT)
if (!backtest) {
  console.error('No backtest report. Run `npm run backtest` first.')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })
writeFileSync(resolve(OUT, 'event.json'), JSON.stringify(event))
writeFileSync(resolve(OUT, 'backtest.json'), backtest)
console.info(`Wrote public/data/event.json (${event.fights.length} bouts) and backtest.json. Commit them to publish.`)
