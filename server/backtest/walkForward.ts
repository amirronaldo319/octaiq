import type { Bout, FighterProfile } from './dataset.ts'
import { buildFeatureRows, FEATURE_NAMES, STATS_FEATURES } from './features.ts'
import { bootstrapLogLoss, logLossOne, metrics, type EventAgg, type Interval, type Metrics } from './metrics.ts'
import { applyTemperature, eloProb, fitTemperature, predictLogistic, trainLogistic } from './models.ts'

export interface BacktestOptions {
  firstTestYear: number
  /** Years immediately before firstTestYear used to choose the Elo K-factor and the stats decay */
  validationYears: number
  eloKCandidates: number[]
  /** Per-fight multipliers for older fight statistics; 1 means no decay */
  statsDecayCandidates: number[]
  ridge: number
  minCalibrationRows: number
  bootstrap: number
  seed: number
  /**
   * Feature names to drop from every model. The missing-profile flags are dropped by default: whether
   * a fighter's page has a DOB or reach today depends on how long their career lasted, which is
   * future information.
   */
  excludeFeatures: string[]
}

export const DEFAULT_OPTIONS: BacktestOptions = {
  firstTestYear: 2014,
  validationYears: 6,
  eloKCandidates: [16, 24, 32, 48, 64, 96, 128],
  statsDecayCandidates: [1, 0.9, 0.8, 0.7],
  excludeFeatures: ['ageMissing', 'reachMissing'],
  ridge: 5,
  minCalibrationRows: 800,
  bootstrap: 1000,
  seed: 20261025,
}

export interface Prediction {
  id: string
  event: string
  year: number
  y: 0 | 1
  priorA: number
  priorB: number
  coin: number
  elo: number
  /** Logistic regression on results-only features */
  lr: number
  /** Logistic regression on results features plus rolling striking and grappling statistics */
  lrStats: number
  lrCal: number | null
}

export interface ModelResult {
  id: string
  label: string
  metrics: Metrics
  logLoss: Interval
  /** Paired log-loss difference to the Elo model; negative means better than Elo */
  logLossVsElo: Interval
}

export interface FoldInfo {
  year: number
  trainRows: number
  /** Latest training date, ISO; always before the test year starts */
  trainEnd: string
  testRows: number
  calibrationTemperature: number | null
}

export interface BacktestReport {
  options: BacktestOptions
  eloK: number
  eloKValidation: { k: number; logLoss: number }[]
  statsDecay: number
  statsDecayValidation: { decay: number; logLoss: number }[]
  rows: { total: number; scoredDecisive: number; excludedDrawOrNoContest: number; testScored: number; testPeriod: string }
  models: ModelResult[]
  /**
   * Paired log-loss difference, stats model minus results-only model, with a 95% event-level bootstrap
   * interval. The stats features are adopted only when the whole interval is below zero.
   */
  statsVsResults: Interval
  statsAdopted: boolean
  /** The model used for event predictions: 'lrStats' only if adopted, otherwise 'lr' */
  primary: 'lr' | 'lrStats'
  byYear: { year: number; n: number; coinLogLoss: number; eloLogLoss: number; lrLogLoss: number; lrStatsLogLoss: number }[]
  experienced: { label: string; models: { id: string; n: number; logLoss: number; accuracy: number }[] }[]
  calibration: { rows: number; lrLogLoss: number; calibratedLogLoss: number; diff: Interval; temperatures: number[] } | null
  folds: FoldInfo[]
  featureWeights: { name: string; weight: number }[]
}

const yearStart = (year: number): number => Date.UTC(year, 0, 1)
const yearOf = (ms: number): number => new Date(ms).getUTCFullYear()

/** Column indices to keep after dropping the named features. */
export const columnsWithout = (exclude: readonly string[]): number[] =>
  FEATURE_NAMES.map((n, i) => (exclude.includes(n) ? -1 : i)).filter((i) => i >= 0)

const STATS_NAMES: readonly string[] = STATS_FEATURES

export function selectEloK(
  bouts: readonly Bout[],
  profiles: ReadonlyMap<string, FighterProfile>,
  opts: BacktestOptions,
): { k: number; table: { k: number; logLoss: number }[] } {
  const from = yearStart(opts.firstTestYear - opts.validationYears)
  const to = yearStart(opts.firstTestYear)
  const table = opts.eloKCandidates.map((k) => {
    const rows = buildFeatureRows(bouts, profiles, { eloK: k }).filter((r) => r.y !== null && r.date >= from && r.date < to)
    const ll = rows.reduce((s, r) => s + logLossOne(eloProb(r.x[0]), r.y as number), 0) / Math.max(1, rows.length)
    return { k, logLoss: ll }
  })
  const best = table.reduce((a, b) => (b.logLoss < a.logLoss ? b : a))
  return { k: best.k, table }
}

/**
 * Chooses how quickly old fight statistics fade, using only the validation years before the test
 * period: fit on everything before them, score on them.
 */
export function selectStatsDecay(
  bouts: readonly Bout[],
  profiles: ReadonlyMap<string, FighterProfile>,
  eloK: number,
  opts: BacktestOptions,
): { decay: number; table: { decay: number; logLoss: number }[] } {
  const valFrom = yearStart(opts.firstTestYear - opts.validationYears)
  const valTo = yearStart(opts.firstTestYear)
  const keep = columnsWithout(opts.excludeFeatures)
  const table = opts.statsDecayCandidates.map((decay) => {
    const rows = buildFeatureRows(bouts, profiles, { eloK, statsDecay: decay }).filter((r) => r.y !== null)
    const train = rows.filter((r) => r.date < valFrom)
    const val = rows.filter((r) => r.date >= valFrom && r.date < valTo)
    if (train.length < 200 || val.length === 0) return { decay, logLoss: Infinity }
    const model = trainLogistic(train.map((r) => keep.map((i) => r.x[i])), train.map((r) => r.y as number), opts.ridge)
    const ll = val.reduce((s, r) => s + logLossOne(predictLogistic(model, keep.map((i) => r.x[i])), r.y as number), 0) / val.length
    return { decay, logLoss: ll }
  })
  const best = table.reduce((a, b) => (b.logLoss < a.logLoss ? b : a))
  return { decay: best.decay, table }
}

export function runBacktest(
  bouts: readonly Bout[],
  profiles: ReadonlyMap<string, FighterProfile>,
  options: Partial<BacktestOptions> = {},
): { report: BacktestReport; predictions: Prediction[] } {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  if (opts.excludeFeatures.includes('elo')) throw new Error('The elo feature cannot be excluded')
  const { k: eloK, table } = selectEloK(bouts, profiles, opts)
  const { decay: statsDecay, table: decayTable } = selectStatsDecay(bouts, profiles, eloK, opts)

  const keepStats = columnsWithout(opts.excludeFeatures)
  const keepResults = columnsWithout([...opts.excludeFeatures, ...STATS_NAMES])
  const rows = buildFeatureRows(bouts, profiles, { eloK, statsDecay })
  const decisive = rows.filter((r): r is typeof r & { y: 0 | 1 } => r.y !== null)
  const lastYear = yearOf(rows[rows.length - 1].date)

  const predictions: Prediction[] = []
  const folds: FoldInfo[] = []
  const priorOos: { p: number; y: number }[] = []
  let lastResultsWeights: number[] = []
  let lastStatsWeights: number[] = []

  for (let year = opts.firstTestYear; year <= lastYear; year++) {
    const train = decisive.filter((r) => r.date < yearStart(year))
    const test = decisive.filter((r) => yearOf(r.date) === year)
    if (test.length === 0 || train.length < 200) continue

    const ys = train.map((r) => r.y)
    const resultsModel = trainLogistic(train.map((r) => keepResults.map((i) => r.x[i])), ys, opts.ridge)
    const statsModel = trainLogistic(train.map((r) => keepStats.map((i) => r.x[i])), ys, opts.ridge)
    lastResultsWeights = resultsModel.weights.map((w, j) => w / resultsModel.scales[j])
    lastStatsWeights = statsModel.weights.map((w, j) => w / statsModel.scales[j])
    // Calibrator sees only predictions from earlier test years.
    const temperature = priorOos.length >= opts.minCalibrationRows ? fitTemperature(priorOos.map((o) => o.p), priorOos.map((o) => o.y)) : null

    const yearPreds: Prediction[] = test.map((r) => {
      const lr = predictLogistic(resultsModel, keepResults.map((i) => r.x[i]))
      return {
        id: r.id, event: r.event, year, y: r.y, priorA: r.priorA, priorB: r.priorB,
        coin: 0.5, elo: eloProb(r.x[0]), lr,
        lrStats: predictLogistic(statsModel, keepStats.map((i) => r.x[i])),
        lrCal: temperature === null ? null : applyTemperature(lr, temperature),
      }
    })
    predictions.push(...yearPreds)
    for (const p of yearPreds) priorOos.push({ p: p.lr, y: p.y })
    folds.push({
      year,
      trainRows: train.length,
      trainEnd: new Date(Math.max(...train.map((r) => r.date))).toISOString().slice(0, 10),
      testRows: test.length,
      calibrationTemperature: temperature,
    })
  }
  if (predictions.length === 0) throw new Error('No test predictions; check firstTestYear and the data')

  const ys = predictions.map((p) => p.y)
  const defs: { id: string; label: string; get: (p: Prediction) => number }[] = [
    { id: 'coin', label: 'Coin flip (0.5)', get: (p) => p.coin },
    { id: 'elo', label: 'Elo only', get: (p) => p.elo },
    { id: 'lr', label: 'Logistic regression (results features)', get: (p) => p.lr },
    { id: 'lrStats', label: 'Logistic regression (results + rolling fight stats)', get: (p) => p.lrStats },
  ]
  const byEvent = new Map<string, EventAgg>()
  for (const p of predictions) {
    const agg = byEvent.get(`${p.year}|${p.event}`) ?? { n: 0, ll: defs.map(() => 0) }
    agg.n++
    defs.forEach((d, i) => { agg.ll[i] += logLossOne(d.get(p), p.y) })
    byEvent.set(`${p.year}|${p.event}`, agg)
  }
  const aggs = [...byEvent.values()]
  const vsElo = bootstrapLogLoss(aggs, 1, opts.bootstrap, opts.seed)
  const vsResults = bootstrapLogLoss(aggs, 2, opts.bootstrap, opts.seed + 2)
  const models: ModelResult[] = defs.map((d, i) => ({
    id: d.id, label: d.label, metrics: metrics(predictions.map(d.get), ys),
    logLoss: vsElo.logLoss[i], logLossVsElo: vsElo.diffVsRef[i],
  }))
  const statsVsResults = vsResults.diffVsRef[3]
  // Pre-committed rule: more features are adopted only if they beat the simpler model beyond noise.
  const statsAdopted = opts.bootstrap > 0 && statsVsResults.hi < 0

  const years = [...new Set(predictions.map((p) => p.year))]
  const byYear = years.map((year) => {
    const sub = predictions.filter((p) => p.year === year)
    const subY = sub.map((p) => p.y)
    const ll = (get: (p: Prediction) => number): number => metrics(sub.map(get), subY).logLoss
    return {
      year, n: sub.length, coinLogLoss: ll((p) => p.coin), eloLogLoss: ll((p) => p.elo),
      lrLogLoss: ll((p) => p.lr), lrStatsLogLoss: ll((p) => p.lrStats),
    }
  })

  const subsets: { label: string; keep: (p: Prediction) => boolean }[] = [
    { label: 'Both fighters have 3+ prior UFC bouts', keep: (p) => p.priorA >= 3 && p.priorB >= 3 },
    { label: 'At least one fighter has fewer than 3 prior UFC bouts', keep: (p) => p.priorA < 3 || p.priorB < 3 },
  ]
  const experienced = subsets.map((s) => {
    const sub = predictions.filter(s.keep)
    return {
      label: s.label,
      models: defs.map((d) => {
        const m = metrics(sub.map(d.get), sub.map((p) => p.y))
        return { id: d.id, n: m.n, logLoss: m.logLoss, accuracy: m.accuracy }
      }),
    }
  })

  const calSub = predictions.filter((p) => p.lrCal !== null)
  let calibration: BacktestReport['calibration'] = null
  if (calSub.length > 0) {
    const ev = new Map<string, EventAgg>()
    for (const p of calSub) {
      const agg = ev.get(`${p.year}|${p.event}`) ?? { n: 0, ll: [0, 0] }
      agg.n++
      agg.ll[0] += logLossOne(p.lr, p.y)
      agg.ll[1] += logLossOne(p.lrCal as number, p.y)
      ev.set(`${p.year}|${p.event}`, agg)
    }
    const b = bootstrapLogLoss([...ev.values()], 0, opts.bootstrap, opts.seed + 1)
    calibration = {
      rows: calSub.length,
      lrLogLoss: b.logLoss[0].estimate,
      calibratedLogLoss: b.logLoss[1].estimate,
      diff: b.diffVsRef[1],
      temperatures: folds.map((f) => f.calibrationTemperature).filter((t): t is number => t !== null),
    }
  }

  const primary: 'lr' | 'lrStats' = statsAdopted ? 'lrStats' : 'lr'
  const names = (keep: number[], w: number[]): { name: string; weight: number }[] =>
    keep.map((i, j) => ({ name: FEATURE_NAMES[i], weight: w[j] ?? NaN }))
  return {
    predictions,
    report: {
      options: opts,
      eloK,
      eloKValidation: table,
      statsDecay,
      statsDecayValidation: decayTable,
      rows: {
        total: rows.length,
        scoredDecisive: decisive.length,
        excludedDrawOrNoContest: rows.length - decisive.length,
        testScored: predictions.length,
        testPeriod: `${years[0]}-${years[years.length - 1]}`,
      },
      models, statsVsResults, statsAdopted, primary, byYear, experienced, calibration, folds,
      featureWeights: primary === 'lrStats' ? names(keepStats, lastStatsWeights) : names(keepResults, lastResultsWeights),
    },
  }
}
