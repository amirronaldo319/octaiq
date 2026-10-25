import type { MarketBout, MarketFile } from './marketSnapshot.ts'

/** One saved look at the consensus: only probabilities and bookmaker counts, never single-bookmaker quotes. */
export interface PricePoint {
  t: string
  bouts: Record<string, { pA: number; books: number }>
}

export interface PriceHistory {
  eventId: string
  points: PricePoint[]
}

/** The consensus must move at least this much (probability) on some bout before a new point is saved. */
export const MOVE_THRESHOLD = 0.003

const slim = (bouts: Record<string, MarketBout>): PricePoint['bouts'] =>
  Object.fromEntries(Object.entries(bouts).map(([id, b]) => [id, { pA: b.pA, books: b.books }]))

/**
 * Adds the latest consensus to an event's history. Returns null when nothing moved enough (or there is
 * nothing to add), so scheduled runs do not create commits for noise. The first point is the opening
 * line seen by this site; the last point before the event is the closing line.
 */
export function appendPoint(
  history: PriceHistory | undefined,
  eventId: string,
  bouts: Record<string, MarketBout>,
  now: Date,
): PriceHistory | null {
  if (Object.keys(bouts).length === 0) return null
  const next = slim(bouts)
  const last = history?.points[history.points.length - 1]
  if (last) {
    const moved = Object.entries(next).some(([id, b]) => {
      const prev = last.bouts[id]
      return !prev || Math.abs(prev.pA - b.pA) >= MOVE_THRESHOLD
    })
    if (!moved) return null
  }
  return { eventId, points: [...(history?.points ?? []), { t: now.toISOString(), bouts: next }] }
}

/** A bout's opening and latest consensus for fighter A and how far it moved, or null with fewer than two looks. */
export function lineMovement(history: PriceHistory | undefined, fightId: string): { open: number; latest: number; move: number; looks: number } | null {
  const series = (history?.points ?? []).map((p) => p.bouts[fightId]?.pA).filter((v): v is number => typeof v === 'number')
  if (series.length < 2) return null
  const open = series[0]
  const latest = series[series.length - 1]
  return { open, latest, move: latest - open, looks: series.length }
}

export interface PublishedPrices {
  generatedAt: string
  events: Record<string, PricePoint[]>
}

export const toPublished = (all: readonly PriceHistory[], now: Date): PublishedPrices => ({
  generatedAt: now.toISOString(),
  events: Object.fromEntries(all.map((h) => [h.eventId, h.points])),
})

export type { MarketFile }
