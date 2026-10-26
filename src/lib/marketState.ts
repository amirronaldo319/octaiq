export type MarketStateName = 'fresh' | 'aging' | 'stale' | 'closed' | 'unavailable'

export interface MarketState {
  state: MarketStateName
  label: string
  detail: string
}

/** "45 seconds ago", "3 hours ago". */
export function agoText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} second${s === 1 ? '' : 's'} ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.floor(h / 24)
  return `${d} days ago`
}

export const FRESH_MINUTES = 30
export const STALE_HOURS = 8

/**
 * How current the market view is. "Updated" is when the site last asked the provider; the bookmakers' own timestamps can be older,
 * and when they are, that is said too. Once the event has started only the pre-fight consensus exists: there are no in-play
 * prices here, and a frozen number must not look live.
 */
export function marketState(
  market: { newestQuote?: string | null } | undefined,
  fetchedAt: string | undefined,
  eventStart: string,
  now: number,
): MarketState {
  if (!market || !fetchedAt) return { state: 'unavailable', label: 'No prices', detail: 'No betting prices are available for this bout.' }
  const age = now - Date.parse(fetchedAt)
  if (now >= Date.parse(eventStart)) {
    return { state: 'closed', label: 'Pre-fight prices only', detail: `The event has started. These are the last pre-fight prices, collected ${agoText(age)}. In-play prices are not shown.` }
  }
  const quoteAge = market.newestQuote ? now - Date.parse(market.newestQuote) : null
  const quoteNote = quoteAge !== null && quoteAge - age > 3_600_000 ? ` The newest bookmaker quote behind it is ${agoText(quoteAge)}.` : ''
  if (age <= FRESH_MINUTES * 60_000) return { state: 'fresh', label: `Updated ${agoText(age)}`, detail: `Prices were collected ${agoText(age)}.${quoteNote}` }
  if (age <= STALE_HOURS * 3_600_000) return { state: 'aging', label: `Updated ${agoText(age)}`, detail: `Prices are collected every few hours, not live. Last collected ${agoText(age)}.${quoteNote}` }
  return { state: 'stale', label: `Stale: updated ${agoText(age)}`, detail: `The last refresh was ${agoText(age)}, longer than expected. Treat these prices as out of date.${quoteNote}` }
}
