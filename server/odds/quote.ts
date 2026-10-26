import { americanToDecimal } from '../../src/engine/odds.ts'
import type { OddsEvent } from '../lib/oddsApi.ts'

/** One bookmaker's price on one selection at one moment, in the shape we store. */
export interface Quote {
  provider: 'the-odds-api'
  externalEventId: string
  bookmaker: string
  bookmakerTitle: string
  market: 'h2h'
  selection: string
  decimal: number
  /** The price as the provider sent it */
  american: number
  /** When the provider last saw this market, not when we fetched it; null when the provider did not say */
  providerTimestamp: string | null
  ingestedAt: string
  scheduledStart: string
  status: 'open'
  phase: 'prematch' | 'inplay'
}

const validAmerican = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && Math.abs(n) >= 100

/**
 * Flattens a provider event into quotes. Only moneyline (h2h) quotes with a valid American price are kept: other
 * markets are not read until the provider's support for them in MMA is confirmed. An event whose scheduled start has
 * passed is marked in-play, and its quotes must never be treated as pre-fight prices.
 */
export function normalizeQuotes(event: OddsEvent, ingestedAt: Date): Quote[] {
  const phase: Quote['phase'] = Date.parse(event.commence_time) <= ingestedAt.getTime() ? 'inplay' : 'prematch'
  const out: Quote[] = []
  for (const bm of event.bookmakers ?? []) {
    const market = bm.markets?.find((m) => m.key === 'h2h')
    if (!market) continue
    for (const o of market.outcomes ?? []) {
      if (!validAmerican(o.price)) continue
      out.push({
        provider: 'the-odds-api', externalEventId: event.id, bookmaker: bm.key, bookmakerTitle: bm.title, market: 'h2h',
        selection: o.name, decimal: americanToDecimal(o.price), american: o.price,
        providerTimestamp: market.last_update ?? bm.last_update ?? null,
        ingestedAt: ingestedAt.toISOString(), scheduledStart: event.commence_time, status: 'open', phase,
      })
    }
  }
  return out
}
