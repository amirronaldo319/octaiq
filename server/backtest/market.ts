import { bootstrapLogLoss, logLossOne, metrics, type EventAgg, type Interval, type Metrics } from './metrics.ts'
import { logit, predictLogistic, trainLogistic } from './models.ts'
import type { MarketLine, MatchStats } from './oddsData.ts'
import type { Prediction } from './walkForward.ts'

export interface MarketModelResult {
  id: string
  label: string
  metrics: Metrics
  logLoss: Interval
  /** Paired log-loss difference to the market; positive means worse than the market */
  vsMarket: Interval
}

export interface MarketReport {
  match: MatchStats
  period: string
  n: number
  /** Mean raw overround of the matched prices (1.03 = a 3% margin) */
  averageOverround: number
  models: MarketModelResult[]
  byYear: { year: number; n: number; market: number; elo: number; lr: number; lrStats: number }[]
  /** Does the model add information beyond the price? Walk-forward stack of market and model logits. */
  stack: {
    period: string; n: number; models: MarketModelResult[]; modelWeight: number | null; marketWeight: number | null
    /** Paired log-loss difference of the market+model blend against the market recalibrated on the same earlier years; negative means the model adds information */
    addsInformation?: Interval | null
    /** Slope on the market's log-odds when it is recalibrated alone, fitted on all matched years before the last */
    marketSlope?: number | null
  } | null
  /** Model used for the headline comparison */
  primaryModel: 'lr' | 'lrStats'
  verdict: string
  caveats: string[]
}

interface Row {
  id: string
  event: string
  year: number
  y: 0 | 1
  market: number
  coin: number
  elo: number
  lr: number
  lrStats: number
}

const fmt = (n: number, d = 4): string => n.toFixed(d)

function toResult(id: string, label: string, preds: number[], ys: number[], ll: Interval, vs: Interval): MarketModelResult {
  return { id, label, metrics: metrics(preds, ys), logLoss: ll, vsMarket: vs }
}

/**
 * Compares walk-forward model predictions with de-vigged market prices on the bouts where both exist.
 * The predictions were made without ever seeing a price; prices are joined here, after the fact.
 */
export function compareWithMarket(
  predictions: readonly Prediction[],
  lines: ReadonlyMap<string, MarketLine>,
  match: MatchStats,
  primary: 'lr' | 'lrStats',
  opts: { bootstrap: number; seed: number },
): MarketReport | null {
  const rows: Row[] = predictions
    .filter((p) => lines.has(p.id))
    .map((p) => ({ id: p.id, event: p.event, year: p.year, y: p.y, market: (lines.get(p.id) as MarketLine).pA, coin: p.coin, elo: p.elo, lr: p.lr, lrStats: p.lrStats }))
  if (rows.length < 100) return null

  const defs: { id: string; label: string; get: (r: Row) => number }[] = [
    { id: 'market', label: 'Betting market (de-vigged price)', get: (r) => r.market },
    { id: 'coin', label: 'Coin flip (0.5)', get: (r) => r.coin },
    { id: 'elo', label: 'Elo only', get: (r) => r.elo },
    { id: 'lr', label: 'Model: results features', get: (r) => r.lr },
    { id: 'lrStats', label: 'Model: results + rolling fight stats', get: (r) => r.lrStats },
  ]
  const ys = rows.map((r) => r.y)
  const agg = (sel: readonly Row[], getters: ((r: Row) => number)[]): EventAgg[] => {
    const by = new Map<string, EventAgg>()
    for (const r of sel) {
      const a = by.get(`${r.year}|${r.event}`) ?? { n: 0, ll: getters.map(() => 0) }
      a.n++
      getters.forEach((g, i) => { a.ll[i] += logLossOne(g(r), r.y) })
      by.set(`${r.year}|${r.event}`, a)
    }
    return [...by.values()]
  }
  const boot = bootstrapLogLoss(agg(rows, defs.map((d) => d.get)), 0, opts.bootstrap, opts.seed)
  const models = defs.map((d, i) => toResult(d.id, d.label, rows.map(d.get), ys, boot.logLoss[i], boot.diffVsRef[i]))

  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b)
  const byYear = years.map((year) => {
    const sub = rows.filter((r) => r.year === year)
    const ll = (get: (r: Row) => number): number => metrics(sub.map(get), sub.map((r) => r.y)).logLoss
    return { year, n: sub.length, market: ll((r) => r.market), elo: ll((r) => r.elo), lr: ll((r) => r.lr), lrStats: ll((r) => r.lrStats) }
  })

  // Walk-forward stack: for each year, fit on earlier matched years only.
  const modelOf = (r: Row): number => (primary === 'lrStats' ? r.lrStats : r.lr)
  const stackRows: { row: Row; p: number; calMarket: number }[] = []
  let lastWeights: number[] | null = null
  let lastMarketSlope: number | null = null
  for (const year of years) {
    const train = rows.filter((r) => r.year < year)
    const test = rows.filter((r) => r.year === year)
    if (train.length < 400) continue
    const m = trainLogistic(train.map((r) => [logit(r.market), logit(modelOf(r))]), train.map((r) => r.y), 1)
    lastWeights = m.weights.map((w, j) => w / m.scales[j])
    // The fair benchmark for "does the model add information" is the market after the same recalibration, not the raw price.
    const mk = trainLogistic(train.map((r) => [logit(r.market)]), train.map((r) => r.y), 1)
    lastMarketSlope = mk.weights[0] / mk.scales[0]
    for (const r of test) stackRows.push({ row: r, p: predictLogistic(m, [logit(r.market), logit(modelOf(r))]), calMarket: predictLogistic(mk, [logit(r.market)]) })
  }
  let stack: MarketReport['stack'] = null
  if (stackRows.length >= 200) {
    const sub = stackRows.map((s) => s.row)
    const sdefs: { id: string; label: string; get: (i: number) => number }[] = [
      { id: 'market', label: 'Betting market', get: (i) => sub[i].market },
      { id: 'model', label: 'Model alone', get: (i) => modelOf(sub[i]) },
      { id: 'stack', label: 'Market + model (walk-forward blend)', get: (i) => stackRows[i].p },
      { id: 'marketCal', label: 'Market, recalibrated (walk-forward)', get: (i) => stackRows[i].calMarket },
    ]
    const by = new Map<string, EventAgg>()
    sub.forEach((r, i) => {
      const a = by.get(`${r.year}|${r.event}`) ?? { n: 0, ll: sdefs.map(() => 0) }
      a.n++
      sdefs.forEach((d, k) => { a.ll[k] += logLossOne(d.get(i), r.y) })
      by.set(`${r.year}|${r.event}`, a)
    })
    const sb = bootstrapLogLoss([...by.values()], 0, opts.bootstrap, opts.seed + 7)
    const vsCal = bootstrapLogLoss([...by.values()], 3, opts.bootstrap, opts.seed + 7)
    const sy = sub.map((r) => r.y)
    stack = {
      period: `${Math.min(...sub.map((r) => r.year))}-${Math.max(...sub.map((r) => r.year))}`,
      n: sub.length,
      models: sdefs.map((d, k) => toResult(d.id, d.label, sub.map((_, i) => d.get(i)), sy, sb.logLoss[k], sb.diffVsRef[k])),
      marketWeight: lastWeights ? lastWeights[0] : null,
      modelWeight: lastWeights ? lastWeights[1] : null,
      addsInformation: opts.bootstrap > 0 ? vsCal.diffVsRef[2] : null,
      marketSlope: lastMarketSlope,
    }
  }

  const market = models[0]
  const own = models.find((m) => m.id === primary) as MarketModelResult
  const gap = own.vsMarket
  const sig = gap.lo > 0 ? 'worse than' : gap.hi < 0 ? 'better than' : 'not distinguishable from'
  let verdict = `On ${rows.length} bouts with prices (${years[0]}-${years[years.length - 1]}), the model's log loss ${fmt(own.logLoss.estimate)} is ${sig} the market's ${fmt(market.logLoss.estimate)} (gap ${gap.estimate >= 0 ? '+' : ''}${fmt(gap.estimate)}, 95% CI ${fmt(gap.lo)} to ${fmt(gap.hi)}; positive means worse).`
  if (stack) {
    const s = stack.models[2]
    const c = stack.addsInformation
    verdict += ` Blending the model into the price changed log loss by ${s.vsMarket.estimate >= 0 ? '+' : ''}${fmt(s.vsMarket.estimate)} [${fmt(s.vsMarket.lo)}, ${fmt(s.vsMarket.hi)}] versus the raw price`
    verdict += c
      ? `, and by ${c.estimate >= 0 ? '+' : ''}${fmt(c.estimate)} [${fmt(c.lo)}, ${fmt(c.hi)}] versus the price recalibrated on the same earlier years, ${c.hi < 0 ? 'so the model adds information the price lacks' : 'so the model does not demonstrably add information beyond the price'}.`
      : `, ${s.vsMarket.hi < 0 ? 'so the model adds information the price lacks' : 'so the model does not demonstrably add information beyond the price'}.`
  }
  return {
    match, period: `${years[0]}-${years[years.length - 1]}`, n: rows.length,
    averageOverround: rows.reduce((s, r) => s + (lines.get(r.id) as MarketLine).overround, 0) / rows.length,
    models, byYear, stack, primaryModel: primary, verdict,
    caveats: [
      'The dataset does not say which bookmaker, or whether the price is opening, closing or best-available. Treat it as an as-recorded market price, not a verified closing line.',
      'Coverage ends March 2020 and only 2014 onward overlaps the model test years, so the comparison does not cover the last six years.',
      'A model that matches the market on log loss still cannot profit after the margin; beating the market needs a consistent, significant gap in the model’s favour.',
      'Matching is by date and fighter name; bouts that could not be matched are excluded, which may bias the sample toward well-known fighters.',
    ],
  }
}
