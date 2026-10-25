import { formatReport, hasFailures, runChecks } from './lib/check.ts'

const oddsKey = process.env.ODDS_API_KEY?.trim() || undefined
const ufcKey = process.env.UFCALENDAR_API_KEY?.trim() || undefined

console.info('Checking API keys (keys are never printed)...\n')
const results = await runChecks({
  oddsKey,
  ufcKey,
  fetchImpl: fetch,
  fetchOdds: !process.argv.includes('--no-odds'),
})
console.info(formatReport(results, [oddsKey, ufcKey]))
process.exitCode = hasFailures(results) ? 1 : 0
