import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { OutcomeCheck, ResultsModel } from '../../src/engine/eventTypes.ts'
import { normalizeName } from '../lib/names.ts'
import { parseBouts, profilesFor, type Bout, type FighterProfile, type RawFiles } from './dataset.ts'
import type { OutcomeMetric } from './outcomes.ts'
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

export const RESULTS_MODEL_VERSION = 'octa-results-lr-0.3'
export const STATS_MODEL_VERSION = 'octa-results-stats-lr-0.3'

/**
 * The recency-weighted challenger that research found better than production in testing but that did not clear the promotion gate
 * after adjusting for the number of challengers tried. It forecasts alongside production, is saved with each forecast, and is never
 * shown as the forecast, so prospective evidence can accumulate before any decision.
 */
export const SHADOW_MODEL_VERSION = 'octa-results-stats-lr-recency4y-0.1'
export const SHADOW_HALF_LIFE_YEARS = 4

const unavailable = (reason: string): ResultsModel => ({ status: 'unavailable', reason, version: RESULTS_MODEL_VERSION, bouts: {} })

const check = (m: OutcomeMetric): OutcomeCheck => ({
  n: m.n, logLoss: m.logLoss.estimate, baselineLogLoss: m.baselineLogLoss,
  gain: m.gain.estimate, gainLo: m.gain.lo, gainHi: m.gain.hi, accuracy: m.accuracy, baselineAccuracy: m.baselineAccuracy,
})

export interface ResultsModelService {
  predict: (inputs: readonly UpcomingInput[]) => ResultsModel
}

export interface LoadedData {
  bouts: Bout[]
  profiles: Map<string, FighterProfile>
  key: string
}

/** Reads the downloaded dataset; null when a required file is missing. */
export function loadDataset(root: string, previous?: LoadedData | null): LoadedData | null {
  const rawDir = resolve(root, 'data/raw/ufc')
  const files = ['ufc_event_details.csv', 'ufc_fight_results.csv', 'ufc_fighter_tott.csv'].map((f) => resolve(rawDir, f))
  if (files.some((f) => !existsSync(f))) return null
  const statsFile = resolve(rawDir, 'ufc_fight_stats.csv')
  const key = [...files, statsFile].map((f) => (existsSync(f) ? statSync(f).mtimeMs : 0)).join('|')
  if (previous?.key === key) return previous
  const raw: RawFiles = {
    events: readFileSync(files[0], 'utf8'),
    results: readFileSync(files[1], 'utf8'),
    fighters: readFileSync(files[2], 'utf8'),
    stats: existsSync(statsFile) ? readFileSync(statsFile, 'utf8') : undefined,
  }
  return { key, bouts: parseBouts(raw).bouts, profiles: profilesFor(raw) }
}

/**
 * Serves the backtested model. It refuses to run without a saved backtest report, so a prediction is
 * never labelled validated unless a walk-forward evaluation of this exact model exists.
 * `bootstrap` adds a probability range per bout and costs a few seconds, so results are remembered.
 */
export function createResultsModelService(root: string, options: { bootstrap?: number } = {}): ResultsModelService {
  const reportPath = resolve(root, 'data/reports/backtest-latest.json')
  let data: LoadedData | null = null
  const memo = new Map<string, ResultsModel>()

  function compute(inputs: readonly UpcomingInput[]): ResultsModel {
    if (!existsSync(reportPath)) return unavailable('No backtest report. Run `npm run backtest`; predictions are not shown as validated without one.')
    data = loadDataset(root, data)
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
      bootstrap: options.bootstrap ?? 0,
      seed: out.report.options.seed,
      shadowHalfLifeYears: SHADOW_HALF_LIFE_YEARS,
    })
    const mk = out.market
    const own = mk?.models.find((m) => m.id === mk.primaryModel)
    const oc = out.report.outcomes
    return {
      status: 'available',
      version: useStats ? STATS_MODEL_VERSION : RESULTS_MODEL_VERSION,
      features: useStats ? 'results+stats' : 'results',
      trainedThrough: out.ingest.lastDate,
      featureCutoff: out.ingest.lastDate,
      shadowModel: SHADOW_MODEL_VERSION,
      ...(out.reproducibility ? { dataVersion: out.reproducibility.dataVersion, featurePipeline: out.reproducibility.featurePipeline, ...(out.reproducibility.codeCommit ? { codeCommit: out.reproducibility.codeCommit } : {}) } : {}),
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
        generatedAt: out.generatedAt,
        market: mk && own
          ? {
              period: mk.period, n: mk.n,
              marketAccuracy: mk.models[0].metrics.accuracy, modelAccuracy: own.metrics.accuracy,
              marketLogLoss: mk.models[0].logLoss.estimate, modelLogLoss: own.logLoss.estimate,
              gap: own.vsMarket.estimate, gapLo: own.vsMarket.lo, gapHi: own.vsMarket.hi,
              blendGain: mk.stack ? mk.stack.models[2].vsMarket : undefined,
            }
          : undefined,
      },
      outcomes: oc ? { period: oc.period, distance: check(oc.distance), koShare: check(oc.koShare), joint: check(oc.joint), note: oc.note } : undefined,
      bouts: Object.fromEntries(preds.map((p) => [p.id, {
        probA: p.probA, probB: p.probB, probLo: p.probLo, probHi: p.probHi, priorA: p.priorA, priorB: p.priorB,
        eloDiff: p.eloDiff, distance: p.distance, joint: p.joint, why: p.why,
        ...(p.shadowProbA !== undefined ? { shadowProbA: p.shadowProbA } : {}),
      }])),
    }
  }

  return {
    predict(inputs) {
      const memoKey = `${existsSync(reportPath) ? statSync(reportPath).mtimeMs : 0}|${JSON.stringify(inputs)}`
      const hit = memo.get(memoKey)
      if (hit) return hit
      const out = compute(inputs)
      // Only successes are remembered, so fixing a missing file takes effect at once.
      if (out.status === 'available') memo.set(memoKey, out)
      return out
    },
  }
}
