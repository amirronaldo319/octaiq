import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { buildMonitor } from './lib/monitor.ts'
import { isMarketFile } from './lib/marketSnapshot.ts'
import { writeIfChanged } from './lib/stableWrite.ts'
import { buildFighterCareers, buildFighterIndex, buildPublishedLedger, buildStaticEvents, readBacktestForPublishing } from './lib/snapshot.ts'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = resolve(ROOT, 'public/data')

console.info('Building events (the probability ranges take a few seconds)...')
const { index, payloads } = await buildStaticEvents(ROOT, { bootstrap: 100 })
const unavailable = payloads.filter((p) => p.resultsModel.status !== 'available')
if (unavailable.length > 0) {
  console.error(`Results model unavailable: ${unavailable[0].resultsModel.reason}. Run \`npm run backtest\` first.`)
  process.exit(1)
}
const backtest = readBacktestForPublishing(ROOT)
if (!backtest) {
  console.error('No backtest report. Run `npm run backtest` first.')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })
// Remove event files for events that no longer exist, so deleted events do not linger on the site.
const expected = new Set(payloads.map((p) => `event-${p.event.id}.json`))
for (const name of readdirSync(OUT)) if (/^event(-.+)?\.json$/.test(name) && !expected.has(name)) rmSync(resolve(OUT, name))
// Files are rewritten only when they say something new, so a scheduled refresh does not create empty commits.
const written: string[] = []
const put = (name: string, text: string): void => {
  if (writeIfChanged(resolve(OUT, name), text)) written.push(name)
}
put('events.json', JSON.stringify(index))
for (const p of payloads) put(`event-${p.event.id}.json`, JSON.stringify(p))
put('backtest.json', backtest)
const careers = buildFighterCareers(ROOT, index)
if (careers) put('fighters.json', JSON.stringify(careers))
else console.warn('Skipped fighters.json: dataset or report missing.')
const fighterIndex = buildFighterIndex(ROOT, new Date())
if (fighterIndex) put('fighter-index.json', JSON.stringify(fighterIndex))
const publishedLedger = buildPublishedLedger(ROOT, new Date(), 'https://github.com/amirronaldo319/octaiq/commits/main/data/ledger')
put('ledger.json', JSON.stringify(publishedLedger))

// A small health summary: published-forecast results, input checks, drift and price freshness.
const readJson = <T>(path: string): T | null => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null)
const identity = readJson<{ checked: number; quarantined: unknown[] }>(resolve(ROOT, 'data/identity/report.json'))
const marketFile = readJson<unknown>(resolve(OUT, 'market.json'))
const primary = (JSON.parse(backtest) as { report: { primary: string; models: { id: string; metrics: { logLoss: number; reliability: { n: number; meanPredicted: number }[] } }[] } }).report
const pm = primary.models.find((m) => m.id === primary.primary)
const binned = (pm?.metrics.reliability ?? []).filter((b) => b.n > 0)
const total = binned.reduce((n, b) => n + b.n, 0)
put('monitor.json', JSON.stringify(buildMonitor({
  now: new Date(),
  events: payloads,
  graded: publishedLedger.events.flatMap((e) => e.bouts.flatMap((b) => (b.result === 'a' || b.result === 'b' ? [{ probA: b.probA, winner: b.result }] : []))),
  identity: identity ? { checked: identity.checked, quarantined: identity.quarantined.length } : null,
  market: marketFile && isMarketFile(marketFile) ? marketFile : null,
  trainingMeanConfidence: total ? binned.reduce((s, b) => s + b.n * b.meanPredicted, 0) / total : null,
  trainingLogLoss: pm?.metrics.logLoss ?? null,
})))
console.info(written.length ? `Updated ${written.length} files in public/data: ${written.join(', ')}. Commit them to publish.` : 'public/data is already up to date.')
