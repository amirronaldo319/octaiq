import type { ResultsModel, ResultsModelBout } from '../engine/eventTypes'
import type { FightAnalysis } from './analysis'

/** Which model's probability a bout card shows. The backtested model wins when it exists. */
export interface PrimaryView {
  source: 'validated' | 'baseline' | 'none'
  probA: number
  probB: number
}

export function primaryView(an: FightAnalysis, results?: ResultsModelBout): PrimaryView {
  if (results) return { source: 'validated', probA: results.probA, probB: results.probB }
  if (an.modelValid) return { source: 'baseline', probA: an.prediction.probA, probB: an.prediction.probB }
  return { source: 'none', probA: 0.5, probB: 0.5 }
}

export type LeanLabel = 'Toss-up' | 'Slight lean' | 'Clear lean' | 'Big lean'

export interface Lean {
  side: 'a' | 'b'
  /** Percentage points above an even split */
  points: number
  label: LeanLabel
}

/** Plain-language size of a lean. The wording describes the probability gap, not confidence in it. */
export function leanOf(probA: number): Lean {
  const points = Math.abs(probA - 0.5) * 100
  const label: LeanLabel = points < 3 ? 'Toss-up' : points < 10 ? 'Slight lean' : points < 20 ? 'Clear lean' : 'Big lean'
  return { side: probA >= 0.5 ? 'a' : 'b', points, label }
}

export type Trust = 'Low' | 'Moderate'

/**
 * How far to lean on a pick. Never higher than Moderate because betting prices beat this model in past
 * tests, and Low when either fighter has little UFC history, where the backtest shows almost no edge.
 */
export function trustFor(results?: ResultsModelBout): { level: Trust; reason: string } {
  if (!results) return { level: 'Low', reason: 'There is no backtested model output for this bout.' }
  const thin = Math.min(results.priorA, results.priorB)
  if (thin < 3) {
    return {
      level: 'Low',
      reason: thin === 0
        ? 'One fighter has no UFC fights in the data, so they are rated as a newcomer.'
        : `One fighter has only ${thin} UFC fight${thin === 1 ? '' : 's'} in the data, where the model had little edge in testing.`,
    }
  }
  return { level: 'Moderate', reason: 'Both fighters have a UFC record to learn from, but betting prices were still more accurate in past tests.' }
}

export interface Highlight {
  key: string
  title: string
  detail: string
  fightId: string
  value: string
}

export interface HighlightInput {
  id: string
  nameA: string
  nameB: string
  probA: number
  priorA: number
  priorB: number
}

const pct = (p: number): string => `${Math.round(p * 100)}%`

/** One standout bout for each of three questions a viewer would ask of the card. */
export function buildHighlights(items: readonly HighlightInput[]): Highlight[] {
  if (items.length === 0) return []
  const byLean = [...items].sort((x, y) => Math.abs(y.probA - 0.5) - Math.abs(x.probA - 0.5))
  const strongest = byLean[0]
  const closest = byLean[byLean.length - 1]
  const thinnest = [...items].sort((x, y) => Math.min(x.priorA, x.priorB) - Math.min(y.priorA, y.priorB))[0]
  const fav = (i: HighlightInput): { name: string; p: number } =>
    i.probA >= 0.5 ? { name: i.nameA, p: i.probA } : { name: i.nameB, p: 1 - i.probA }

  const out: Highlight[] = [
    { key: 'strongest', title: 'Biggest lean', detail: `${fav(strongest).name} over ${fav(strongest).name === strongest.nameA ? strongest.nameB : strongest.nameA}`, fightId: strongest.id, value: pct(fav(strongest).p) },
  ]
  if (closest.id !== strongest.id) {
    out.push({ key: 'closest', title: 'Closest call', detail: `${closest.nameA} vs. ${closest.nameB}`, fightId: closest.id, value: `${pct(closest.probA)} / ${pct(1 - closest.probA)}` })
  }
  const n = Math.min(thinnest.priorA, thinnest.priorB)
  if (n < 3) {
    out.push({ key: 'thin', title: 'Least to go on', detail: `${thinnest.nameA} vs. ${thinnest.nameB}`, fightId: thinnest.id, value: n === 0 ? 'A newcomer' : `${n} UFC fight${n === 1 ? '' : 's'}` })
  }
  return out
}

export interface AccuracyStrip {
  coin: number
  model: number
  market: number | null
  period: string
  n: number
}

/** Accuracy figures for the "how reliable is this" strip, on the bouts that have betting prices. */
export function accuracyStrip(meta?: ResultsModel): AccuracyStrip | null {
  const bt = meta?.backtest
  if (!bt) return null
  if (bt.market?.marketAccuracy !== undefined && bt.market.modelAccuracy !== undefined) {
    return { coin: 0.5, model: bt.market.modelAccuracy, market: bt.market.marketAccuracy, period: bt.market.period, n: bt.market.n }
  }
  return { coin: 0.5, model: bt.accuracy, market: null, period: bt.period, n: bt.n }
}

export type SortKey = 'order' | 'lean' | 'close' | 'thin'

export const SORT_LABELS: Record<SortKey, string> = {
  order: 'Card order',
  lean: 'Biggest lean',
  close: 'Closest call',
  thin: 'Least data',
}

export interface SortRow {
  /** Position on the card; lower is earlier */
  order: number
  hasModel: boolean
  probA: number
  /** Fewest UFC fights between the two fighters, or null when unknown */
  thinnest: number | null
}

/** Sorts a copy. Bouts without a prediction always go last for the model-based orders. */
export function sortRows<T extends SortRow>(rows: readonly T[], key: SortKey): T[] {
  const lean = (r: T): number => Math.abs(r.probA - 0.5)
  const score: Record<Exclude<SortKey, 'order'>, (r: T) => number> = {
    lean: (r) => lean(r),
    close: (r) => -lean(r),
    thin: (r) => -(r.thinnest ?? 99),
  }
  const copy = [...rows]
  if (key === 'order') return copy.sort((x, y) => x.order - y.order)
  return copy.sort((x, y) => {
    if (x.hasModel !== y.hasModel) return x.hasModel ? -1 : 1
    return score[key](y) - score[key](x) || x.order - y.order
  })
}
