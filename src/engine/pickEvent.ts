import type { EventSummary } from './eventTypes'

/** The event to open first: the soonest one that has not finished (8 hours after the main card), else the most recent. */
export function pickDefaultEvent(events: readonly EventSummary[], now: number): string {
  if (events.length === 0) throw new Error('No events to choose from')
  const sorted = [...events].sort((a, b) => Date.parse(a.mainCardStart) - Date.parse(b.mainCardStart))
  const live = sorted.find((e) => Date.parse(e.mainCardStart) + 8 * 3_600_000 > now)
  return (live ?? sorted[sorted.length - 1]).id
}
