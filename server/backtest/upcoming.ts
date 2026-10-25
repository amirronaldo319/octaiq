import { buildNameIndex, normalizeName } from '../lib/names.ts'
import type { Bout, FighterProfile } from './dataset.ts'
import { buildFeatureRows, STATS_FEATURES } from './features.ts'
import { predictLogistic, trainLogistic } from './models.ts'
import { columnsWithout, DEFAULT_OPTIONS } from './walkForward.ts'

export interface UpcomingInput {
  id: string
  a: string
  b: string
  /** UTC ms of the event; features use only bouts dated before this */
  date: number
}

export interface UpcomingPrediction {
  id: string
  probA: number
  probB: number
  priorA: number
  priorB: number
  /** Elo rating gap, A minus B */
  eloDiff: number
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
}

export const upcomingDefaults = (eloK: number, statsDecay = 0.9, useStats = false): UpcomingOptions => ({
  eloK,
  statsDecay,
  useStats,
  ridge: DEFAULT_OPTIONS.ridge,
  excludeFeatures: DEFAULT_OPTIONS.excludeFeatures,
})

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
    nameA: i.a, nameB: i.b, result: 'nc', method: 'other', weightClass: '',
  }))
  const all = [...bouts, ...synthetic].sort((x, y) => x.date - y.date)
  const exclude = opts.useStats ? opts.excludeFeatures : [...opts.excludeFeatures, ...STATS_FEATURES]
  const keep = columnsWithout(exclude)
  const rows = buildFeatureRows(all, profiles, { eloK: opts.eloK, statsDecay: opts.statsDecay })

  const train = rows.filter((r) => r.y !== null && !r.id.startsWith('upcoming:'))
  const model = trainLogistic(train.map((r) => keep.map((i) => r.x[i])), train.map((r) => r.y as number), opts.ridge)

  const byId = new Map(rows.filter((r) => r.id.startsWith('upcoming:')).map((r) => [r.id.slice(9), r]))
  return inputs.map((i) => {
    const row = byId.get(i.id)
    if (!row) throw new Error(`No features for ${i.id}`)
    const probA = predictLogistic(model, keep.map((k) => row.x[k]))
    return {
      id: i.id, probA, probB: 1 - probA, priorA: row.priorA, priorB: row.priorB, eloDiff: row.x[0] * 400,
    }
  })
}
