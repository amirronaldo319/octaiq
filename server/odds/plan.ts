import { regionsFor } from '../lib/oddsApi.ts'

/** The Odds API charges one credit per market per region on each odds request (current v4 guide, read 2026-10-26). */
export const regionCount = (regions: string = regionsFor()): number => regions.split(',').filter(Boolean).length
export const creditsPerCall = (markets = 1, regions: string = regionsFor()): number => markets * regionCount(regions)

/** Plans as listed on the provider's pricing page on 2026-10-26. Prices change; check the page before relying on them. */
export const PLANS = [
  { name: 'Starter', usdPerMonth: 0, creditsPerMonth: 500 },
  { name: '20K', usdPerMonth: 30, creditsPerMonth: 20_000 },
  { name: '100K', usdPerMonth: 59, creditsPerMonth: 100_000 },
] as const

/**
 * How often to ask for pre-fight prices, from how long is left before the event. Prices move little a week out and most
 * in the last hours, and the provider itself only refreshes pre-match odds about once a minute (more often near the start),
 * so asking faster than a few minutes adds cost without adding information. Returns null once the event has started:
 * pre-fight polling stops, and in-play prices are a separate, unsupported phase.
 */
export function pollIntervalMinutes(hoursToStart: number): number | null {
  if (hoursToStart <= 0) return null
  if (hoursToStart > 168) return 720
  if (hoursToStart > 72) return 360
  if (hoursToStart > 24) return 180
  if (hoursToStart > 6) return 60
  if (hoursToStart > 1) return 15
  return 10
}

/** Calls and credits for a stretch of time, given when events start. Only the next event matters at each moment. */
export function estimateUsage(eventStartsMs: readonly number[], fromMs: number, toMs: number, credits: number): { calls: number; credits: number } {
  const starts = [...eventStartsMs].sort((a, b) => a - b)
  let t = fromMs
  let calls = 0
  const horizon = 14 * 86_400_000
  while (t < toMs) {
    const next = starts.find((s) => s > t)
    const hours = next === undefined ? Infinity : (next - t) / 3_600_000
    const interval = next === undefined || next - t > horizon ? null : pollIntervalMinutes(hours)
    if (interval === null) {
      // Nothing worth polling: jump to two weeks before the next event, or to the end.
      t = next === undefined ? toMs : Math.max(t + 60_000, next - horizon)
      continue
    }
    calls++
    t += interval * 60_000
  }
  return { calls, credits: calls * credits }
}

/** Slack for scheduled jobs that start a few minutes late, so a poll is not skipped by a hair. */
const JITTER_MINUTES = 15

/**
 * Whether a price request is worth making now: there is an upcoming event, it is within the polling horizon, and enough time has passed
 * since the last successful request for how close the event is.
 */
export function isPollDue(nextStartMs: number | undefined, lastFetchedMs: number | null, nowMs: number): { due: boolean; reason: string } {
  if (nextStartMs === undefined) return { due: false, reason: 'No upcoming event.' }
  const hours = (nextStartMs - nowMs) / 3_600_000
  if (hours > 14 * 24) return { due: false, reason: 'The next event is more than two weeks away.' }
  const interval = pollIntervalMinutes(hours)
  if (interval === null) return { due: false, reason: 'The event has started; pre-fight prices are no longer collected.' }
  if (lastFetchedMs !== null && nowMs - lastFetchedMs < (interval - JITTER_MINUTES) * 60_000) {
    return { due: false, reason: `Prices were collected recently; the next collection is due about every ${interval} minutes at this distance from the event.` }
  }
  return { due: true, reason: `Due: collecting every ${interval} minutes this close to the event.` }
}
