import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ResultsModel } from '../../src/engine/eventTypes.ts'
import { normalizeName } from '../lib/names.ts'
import { parseBouts, profilesFor, type Bout, type FighterProfile, type RawFiles } from './dataset.ts'
import type { BacktestOutput } from './types.ts'
import { predictUpcoming, upcomingDefaults, type UpcomingInput } from './upcoming.ts'

/** Reads data/aliases.json; keys starting with "_" are comments. Returns {} when absent or invalid. */
export function loadAliases(root: string): Record<string, string> {
  const path = resolve(root, 'data/aliases.json')
  if (!existsSync(path)) return {}
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(raw)
        .filter(([k, v]) => !k.startsWith('_') && typeof v === 'string')
        .map(([k, v]) => [normalizeName(k), normalizeName(v as string)]),
    )
  } catch {
    return {}
  }
}

export const RESULTS_MODEL_VERSION = 'octa-results-lr-0.1'
export const STATS_MODEL_VERSION = 'octa-results-stats-lr-0.1'

const unavailable = (reason: string): ResultsModel => ({ status: 'unavailable', reason, version: RESULTS_MODEL_VERSION, bouts: {} })

export interface ResultsModelService {
  predict: (inputs: readonly UpcomingInput[]) => ResultsModel
}

/**
 * Serves the backtested results-only model. It refuses to run without a saved backtest report, so a
 * prediction is never labelled validated unless a walk-forward evaluation of this exact model exists.
 */
export function createResultsModelService(root: string): ResultsModelService {
  const rawDir = resolve(root, 'data/raw/ufc')
  const reportPath = resolve(root, 'data/reports/backtest-latest.json')
  let cache: { key: string; bouts: Bout[]; profiles: Map<string, FighterProfile> } | null = null

  const load = (): { bouts: Bout[]; profiles: Map<string, FighterProfile>; key: string } | null => {
    const files = ['ufc_event_details.csv', 'ufc_fight_results.csv', 'ufc_fighter_tott.csv'].map((f) => resolve(rawDir, f))
    if (files.some((f) => !existsSync(f))) return null
    const statsFile = resolve(rawDir, 'ufc_fight_stats.csv')
    const key = [...files, statsFile].map((f) => (existsSync(f) ? statSync(f).mtimeMs : 0)).join('|')
    if (cache?.key === key) return cache
    const raw: RawFiles = {
      events: readFileSync(files[0], 'utf8'),
      results: readFileSync(files[1], 'utf8'),
      fighters: readFileSync(files[2], 'utf8'),
      stats: existsSync(statsFile) ? readFileSync(statsFile, 'utf8') : undefined,
    }
    cache = { key, bouts: parseBouts(raw).bouts, profiles: profilesFor(raw) }
    return cache
  }

  return {
    predict(inputs) {
      if (!existsSync(reportPath)) return unavailable('No backtest report. Run `npm run backtest`; predictions are not shown as validated without one.')
      const data = load()
      if (!data) return unavailable('Dataset not downloaded. Run `npm run fetch-data`.')
      let out: BacktestOutput
      try {
        out = JSON.parse(readFileSync(reportPath, 'utf8')) as BacktestOutput
      } catch {
        return unavailable('The backtest report could not be read. Re-run `npm run backtest`.')
      }
      const primary = out.report.primary ?? 'lr'
      const lr = out.report.models.find((m) => m.id === primary)
      const resultsOnly = out.report.models.find((m) => m.id === 'lr')
      const coin = out.report.models.find((m) => m.id === 'coin')
      const elo = out.report.models.find((m) => m.id === 'elo')
      if (!lr || !resultsOnly || !coin || !elo) return unavailable('The backtest report is incomplete. Re-run `npm run backtest`.')

      const useStats = primary === 'lrStats'
      const preds = predictUpcoming(data.bouts, data.profiles, inputs, {
        ...upcomingDefaults(out.report.eloK, out.report.statsDecay ?? 0.9, useStats),
        aliases: loadAliases(root),
      })
      return {
        status: 'available',
        version: useStats ? STATS_MODEL_VERSION : RESULTS_MODEL_VERSION,
        features: useStats ? 'results+stats' : 'results',
        trainedThrough: out.ingest.lastDate,
        trainedOn: out.report.rows.scoredDecisive,
        backtest: {
          period: out.report.rows.testPeriod,
          n: lr.metrics.n,
          logLoss: lr.logLoss.estimate,
          logLossLo: lr.logLoss.lo,
          logLossHi: lr.logLoss.hi,
          coinLogLoss: coin.metrics.logLoss,
          eloLogLoss: elo.metrics.logLoss,
          resultsOnlyLogLoss: resultsOnly.metrics.logLoss,
          accuracy: lr.metrics.accuracy,
          datasetRetrieved: out.dataset.retrievedAt,
          market: out.market
            ? (() => {
                const own = out.market.models.find((m) => m.id === out.market?.primaryModel)
                const mk = out.market.models[0]
                return own
                  ? { period: out.market.period, n: out.market.n, marketLogLoss: mk.logLoss.estimate, modelLogLoss: own.logLoss.estimate, gapLo: own.vsMarket.lo, gap: own.vsMarket.estimate, gapHi: own.vsMarket.hi, blendGain: out.market.stack ? out.market.stack.models[2].vsMarket : undefined }
                  : undefined
              })()
            : undefined,
          generatedAt: out.generatedAt,
        },
        bouts: Object.fromEntries(preds.map((p) => [p.id, { probA: p.probA, probB: p.probB, priorA: p.priorA, priorB: p.priorB, eloDiff: p.eloDiff }])),
      }
    },
  }
}
