import { createRng } from '../../src/engine/rng.ts'
import { buildNameIndex, normalizeName } from '../lib/names.ts'
import type { Bout, FighterProfile } from './dataset.ts'
import { buildFeatureRows, STATS_FEATURES, type FeatureRow } from './features.ts'
import { explain, type Why } from './reasons.ts'
import { jointProbs, predictOutcomeProbs, trainOutcomeModels, type JointProbs } from './outcomes.ts'
import { predictLogistic, trainLogistic } from './models.ts'
import { columnsWithout, DEFAULT_OPTIONS } from './walkForward.ts'

export interface UpcomingInput {
  id: string
  a: string
  b: string
  /** UTC ms of the event; features use only bouts dated before this */
  date: number
  /** Scheduled rounds (3 or 5) and weight class, used by the goes-the-distance and method models */
  rounds?: number
  weightClass?: string
}

export interface UpcomingPrediction {
  id: string
  probA: number
  probB: number
  /** 90% range for probA from re-fitting on resampled history; present only when a bootstrap was requested */
  probLo?: number
  probHi?: number
  priorA: number
  priorB: number
  /** Elo rating gap, A minus B */
  eloDiff: number
  /** Probability the fight goes the distance */
  distance: number
  /** Probability of each (winner, method) outcome; sums to one */
  joint: JointProbs
  /** The main reasons behind the forecast, in plain language */
  why: Why
}

export interface UpcomingOptions {
  eloK: number
  /** Per-fight decay for older fight statistics */
  statsDecay: number
  /** Include the rolling striking and grappling features (only when the backtest adopted them) */
  useStats: boolean
  ridge: number
  excludeFeatures: string[]
  /** Normalised event name -> normalised dataset name, for verified spelling differences */
  aliases?: Record<string, string>
  /** Resamples for the probability range; 0 or absent skips it (it costs a few seconds) */
  bootstrap?: number
  seed?: number
}

export const upcomingDefaults = (eloK: number, statsDecay = 0.9, useStats = false): UpcomingOptions => ({
  eloK,
  statsDecay,
  useStats,
  ridge: DEFAULT_OPTIONS.ridge,
  excludeFeatures: DEFAULT_OPTIONS.excludeFeatures,
})

const quantile = (sorted: readonly number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))]

/**
 * Trains on every decisive bout in the dataset, then scores upcoming pairings. Upcoming bouts are
 * appended as no-contests, so they get features from the past but never update ratings or training.
 * Fighters not found in the dataset (debut or a name mismatch) get default debut features.
 */
export function predictUpcoming(
  bouts: readonly Bout[],
  profiles: ReadonlyMap<string, FighterProfile>,
  inputs: readonly UpcomingInput[],
  opts: UpcomingOptions,
): UpcomingPrediction[] {
  const known = buildNameIndex(
    [...new Set(bouts.flatMap((b) => [b.a, b.b]))].map((key) => ({ key })),
    (f) => f.key,
  )
  const resolve = (name: string): string => {
    const aliased = opts.aliases?.[normalizeName(name)] ?? name
    return known.find(aliased)?.key ?? normalizeName(aliased)
  }

  const synthetic: Bout[] = inputs.map((i) => ({
    id: `upcoming:${i.id}`, event: 'upcoming', date: i.date, a: resolve(i.a), b: resolve(i.b),
    nameA: i.a, nameB: i.b, result: 'nc', method: 'other', weightClass: i.weightClass ?? '', scheduledRounds: i.rounds ?? null,
  }))
  const all = [...bouts, ...synthetic].sort((x, y) => x.date - y.date)
  const exclude = opts.useStats ? opts.excludeFeatures : [...opts.excludeFeatures, ...STATS_FEATURES]
  const keep = columnsWithout(exclude)
  const rows = buildFeatureRows(all, profiles, { eloK: opts.eloK, statsDecay: opts.statsDecay })

  const train = rows.filter((r) => r.y !== null && !r.id.startsWith('upcoming:'))
  const xs = train.map((r) => keep.map((i) => r.x[i]))
  const ys = train.map((r) => r.y as number)
  const model = trainLogistic(xs, ys, opts.ridge)
  const outcome = trainOutcomeModels(rows.filter((r) => !r.id.startsWith('upcoming:')), opts.ridge)

  const upcoming = inputs.map((i) => {
    const row = rows.find((r) => r.id === `upcoming:${i.id}`) as FeatureRow | undefined
    if (!row) throw new Error(`No features for ${i.id}`)
    return { input: i, row }
  })

  // Range: re-fit on resampled events, warm-started from the full fit with the same scales.
  const ranges = new Map<string, number[]>()
  const B = opts.bootstrap ?? 0
  if (B > 0) {
    const groups = new Map<string, number[]>()
    train.forEach((r, idx) => groups.set(`${r.date}|${r.event}`, [...(groups.get(`${r.date}|${r.event}`) ?? []), idx]))
    const keys = [...groups.keys()]
    const rng = createRng(opts.seed ?? 1)
    for (let b = 0; b < B; b++) {
      const pick: number[] = []
      for (let k = 0; k < keys.length; k++) pick.push(...(groups.get(keys[Math.floor(rng() * keys.length)]) as number[]))
      const m = trainLogistic(pick.map((i) => xs[i]), pick.map((i) => ys[i]), opts.ridge, { init: model.weights, scales: model.scales, maxIter: 5 })
      for (const u of upcoming) {
        const p = predictLogistic(m, keep.map((k) => u.row.x[k]))
        ranges.set(u.input.id, [...(ranges.get(u.input.id) ?? []), p])
      }
    }
  }

  return upcoming.map(({ input, row }) => {
    const probA = predictLogistic(model, keep.map((k) => row.x[k]))
    const draws = ranges.get(input.id)?.sort((a, b) => a - b)
    const o = predictOutcomeProbs(outcome, row)
    return {
      id: input.id, probA, probB: 1 - probA,
      ...(draws && draws.length > 0 ? { probLo: quantile(draws, 0.05), probHi: quantile(draws, 0.95) } : {}),
      priorA: row.priorA, priorB: row.priorB, eloDiff: row.x[0] * 400,
      distance: o.distance,
      joint: jointProbs(probA, o),
      why: explain(keep, keep.map((k) => row.x[k]), keep.map((k, j) => (model.weights[j] / model.scales[j]) * row.x[k]), probA),
    }
  })
}
