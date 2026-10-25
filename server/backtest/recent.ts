import type { Bout } from './dataset.ts'
import { logLossOne } from './metrics.ts'
import type { Prediction } from './walkForward.ts'

export interface RecentBout {
  a: string
  b: string
  /** Win probability for `a`, made before the event */
  probA: number
  winner: 'a' | 'b'
  correct: boolean
}

export interface RecentEvent {
  event: string
  date: string
  bouts: RecentBout[]
  accuracy: number
  logLoss: number
}

/**
 * The last few events of the walk-forward test, bout by bout. Each prediction was made by a model that
 * had not seen the event (or anything later), so this is a retrospective grade, not a live record.
 */
export function recentEventResults(
  bouts: readonly Bout[],
  predictions: readonly Prediction[],
  primary: 'lr' | 'lrStats',
  count = 6,
): RecentEvent[] {
  const byId = new Map(bouts.map((b) => [b.id, b]))
  const groups = new Map<string, { date: number; rows: RecentBout[]; ll: number[] }>()
  for (const p of predictions) {
    const b = byId.get(p.id)
    if (!b) continue
    const probA = primary === 'lrStats' ? p.lrStats : p.lr
    const winner: 'a' | 'b' = p.y === 1 ? 'a' : 'b'
    const g = groups.get(b.event) ?? { date: b.date, rows: [], ll: [] }
    g.rows.push({ a: b.nameA, b: b.nameB, probA, winner, correct: (probA >= 0.5) === (winner === 'a') })
    g.ll.push(logLossOne(probA, p.y))
    groups.set(b.event, g)
  }
  return [...groups.entries()]
    .sort((x, y) => y[1].date - x[1].date)
    .slice(0, count)
    .map(([event, g]) => ({
      event,
      date: new Date(g.date).toISOString().slice(0, 10),
      bouts: g.rows,
      accuracy: g.rows.filter((r) => r.correct).length / g.rows.length,
      logLoss: g.ll.reduce((s, v) => s + v, 0) / g.ll.length,
    }))
}
