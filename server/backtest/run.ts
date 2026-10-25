import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseBouts, profilesFor, type RawFiles } from './dataset.ts'
import { download, fetchDataset, type Manifest } from './fetchDataset.ts'
import { compareWithMarket, type MarketReport } from './market.ts'
import { fetchOddsDataset, matchOdds, ODDS_SOURCE, parseOddsArff, type OddsManifest } from './oddsData.ts'
import { formatReport } from './format.ts'
import type { Ablation, BacktestOutput } from './types.ts'
import { recentEventResults } from './recent.ts'
import { runBacktest } from './walkForward.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const RAW = resolve(ROOT, 'data/raw/ufc')
const OUT = resolve(ROOT, 'data/reports/backtest-latest.json')
const args = new Set(process.argv.slice(2))

const manifestPath = resolve(RAW, 'manifest.json')
const hasStatsFile = (): boolean => {
  try {
    return (JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest).files.some((f) => f.name === 'ufc_fight_stats.csv')
  } catch {
    return false
  }
}
if (args.has('--fetch') || !existsSync(manifestPath) || !hasStatsFile()) {
  console.info('Downloading dataset (GPL-3.0 repository Greco1899/scrape_ufc_stats)...')
  const m = await fetchDataset(RAW)
  console.info(`Saved ${m.files.length} files to data/raw/ufc (not committed).`)
}
if (args.has('--fetch-only')) process.exit(0)

const manifest = JSON.parse(readFileSync(resolve(RAW, 'manifest.json'), 'utf8')) as Manifest
const files: RawFiles = {
  events: readFileSync(resolve(RAW, 'ufc_event_details.csv'), 'utf8'),
  results: readFileSync(resolve(RAW, 'ufc_fight_results.csv'), 'utf8'),
  fighters: readFileSync(resolve(RAW, 'ufc_fighter_tott.csv'), 'utf8'),
  stats: readFileSync(resolve(RAW, 'ufc_fight_stats.csv'), 'utf8'),
}
const { bouts, stats } = parseBouts(files)
const { report, predictions } = runBacktest(bouts, profilesFor(files))

const profiles = profilesFor(files)
const RESULT_ONLY_DROP = ['winRate', 'finishRate', 'koLossRate', 'subLossRate', 'form', 'layoff', 'age', 'reach', 'debut', 'ageMissing', 'reachMissing']
const variants: { label: string; excluded: string[]; model: 'lr' | 'lrStats'; note: string }[] = [
  { label: 'Results + rolling fight stats', excluded: report.options.excludeFeatures, model: 'lrStats', note: 'The stats model. Adopted only if it beats results-only beyond noise.' },
  { label: 'Results only', excluded: report.options.excludeFeatures, model: 'lr', note: 'The previous primary model.' },
  { label: 'Stats + Elo, no other results features', excluded: [...RESULT_ONLY_DROP], model: 'lrStats', note: 'Shows how much the fight statistics carry on their own.' },
  { label: 'Results + stats, plus missing-profile flags', excluded: [], model: 'lrStats', note: 'Known leak: profile completeness today reflects future career length. Shown only for comparison.' },
  { label: 'Results only, no age or reach', excluded: ['age', 'reach', 'ageMissing', 'reachMissing'], model: 'lr', note: 'Needs no fighter-profile snapshot at all.' },
  { label: 'Elo + experience only', excluded: [...RESULT_ONLY_DROP], model: 'lr', note: 'Smallest feature set.' },
]
const ablations: Ablation[] = variants.map((v) => {
  const r = runBacktest(bouts, profiles, { excludeFeatures: v.excluded, bootstrap: 0 }).report
  const m = r.models.find((x) => x.id === v.model)
  if (!m) throw new Error(`${v.model} model missing`)
  return { label: v.label, excluded: v.excluded, n: m.metrics.n, logLoss: m.metrics.logLoss, accuracy: m.metrics.accuracy, brier: m.metrics.brier, note: v.note }
})

// Market baseline: prices are joined only after the walk-forward predictions exist.
const ODDS_DIR = resolve(ROOT, 'data/raw/odds')
let oddsDataset: OddsManifest | null = null
let market: MarketReport | null = null
let marketNote: string | undefined
try {
  const oddsManifestPath = resolve(ODDS_DIR, 'manifest.json')
  if (!existsSync(oddsManifestPath) || args.has('--fetch')) {
    console.info('Downloading historical odds (OpenML 43464, CC BY 4.0)...')
    oddsDataset = await fetchOddsDataset(ODDS_DIR, download)
  } else {
    oddsDataset = JSON.parse(readFileSync(oddsManifestPath, 'utf8')) as OddsManifest
  }
  const { records } = parseOddsArff(readFileSync(resolve(ODDS_DIR, ODDS_SOURCE.file), 'utf8'))
  const { byBout, stats: matchStats } = matchOdds(bouts, records)
  market = compareWithMarket(predictions, byBout, matchStats, report.primary, { bootstrap: report.options.bootstrap, seed: report.options.seed })
  if (!market) marketNote = `Only ${byBout.size} test bouts matched prices; too few for a comparison.`
} catch (err) {
  marketNote = `Market comparison skipped: ${err instanceof Error ? err.message : 'unknown error'}`
}

const recentEvents = recentEventResults(bouts, predictions, report.primary, 6)
const output: BacktestOutput = { generatedAt: new Date().toISOString(), dataset: manifest, ingest: stats, report, predictionCount: predictions.length, ablations, market, oddsDataset, marketNote, recentEvents }
mkdirSync(resolve(ROOT, 'data/reports'), { recursive: true })
writeFileSync(OUT, JSON.stringify(output, null, 2))
console.info(formatReport(output))
console.info(`\nFull report: ${OUT}`)
