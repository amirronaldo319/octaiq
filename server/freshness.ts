import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkFreshness } from './lib/freshness.ts'

/** Fails the workflow (GitHub emails the repository owner) when the data went stale. */
const report = JSON.parse(readFileSync(resolve(import.meta.dirname, '../data/reports/backtest-latest.json'), 'utf8')) as {
  generatedAt: string
  ingest: { lastDate: string }
}
const problems = checkFreshness({ now: new Date(), lastBoutDate: report.ingest.lastDate, reportGeneratedAt: report.generatedAt })
if (problems.length > 0) {
  for (const p of problems) console.error(`STALE: ${p.message}`)
  process.exit(1)
}
console.info(`Data is fresh (newest result ${report.ingest.lastDate}).`)
