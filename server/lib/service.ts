import type { Fight } from '../../src/engine/types.ts'
import { mapEvents, oddsUrl, type HistoryStore, type OddsEvent } from './oddsApi.ts'
import type { FighterProvider } from './providers.ts'

export interface CardPayload {
  source: 'live'
  fights: Fight[]
  fetchedAt: string
  /** Remaining Odds API credits for the month, when the API reports it */
  quotaRemaining?: string
  /** True when the upstream call failed and cached data is being served */
  stale: boolean
  warnings: string[]
  /** Fighters in the odds feed with no row in the stats file */
  missingStats: string[]
}

export interface OddsSnapshot {
  events: OddsEvent[]
  fetchedAt: string
  quotaRemaining?: string
  stale: boolean
}

export class ServiceError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface ServiceDeps {
  apiKey: string | undefined
  fetchImpl: typeof fetch
  loadFighters: FighterProvider
  history: HistoryStore
  ttlMs: number
  now?: () => number
}

export interface CardService {
  getCard: () => Promise<CardPayload>
  /** Raw, cached odds events (one Odds API credit per refresh) */
  getOdds: () => Promise<OddsSnapshot>
}

export function createCardService(deps: ServiceDeps): CardService {
  const now = deps.now ?? Date.now
  let cache: { at: number; snapshot: OddsSnapshot } | null = null

  async function refresh(apiKey: string): Promise<OddsSnapshot> {
    const res = await deps.fetchImpl(oddsUrl(apiKey), { signal: AbortSignal.timeout(15_000) })
    if (res.status === 401) throw new ServiceError(502, 'The Odds API rejected the API key (401). Check ODDS_API_KEY.')
    if (res.status === 429) throw new ServiceError(502, 'The Odds API rate limit or monthly quota was hit (429).')
    if (!res.ok) throw new ServiceError(502, `The Odds API returned HTTP ${res.status}.`)
    const events = (await res.json()) as OddsEvent[]
    if (!Array.isArray(events)) throw new ServiceError(502, 'Unexpected response shape from The Odds API.')
    return {
      events,
      fetchedAt: new Date(now()).toISOString(),
      quotaRemaining: res.headers.get('x-requests-remaining') ?? undefined,
      stale: false,
    }
  }

  async function getOdds(): Promise<OddsSnapshot> {
    if (cache && now() - cache.at < deps.ttlMs) return cache.snapshot
    if (!deps.apiKey) throw new ServiceError(503, 'ODDS_API_KEY is not set. Add it to .env and restart the server.')
    try {
      const snapshot = await refresh(deps.apiKey)
      cache = { at: now(), snapshot }
      return snapshot
    } catch (err) {
      if (cache) return { ...cache.snapshot, stale: true }
      if (err instanceof ServiceError) throw err
      throw new ServiceError(502, 'Could not reach The Odds API.')
    }
  }

  async function getCard(): Promise<CardPayload> {
    const odds = await getOdds()
    const upcoming = odds.events.filter((e) => Date.parse(e.commence_time) > now())
    const names = [...new Set(upcoming.flatMap((e) => [e.home_team, e.away_team]))]
    const { fighters, warnings } = await deps.loadFighters(names)
    const fights = mapEvents(odds.events, fighters, deps.history, new Date(now()))
    const known = new Set(fighters.map((x) => x.id))
    const missing = new Set<string>()
    for (const f of fights) {
      if (!f.statsMissing) continue
      for (const side of [f.a, f.b]) if (!known.has(side.id)) missing.add(side.name)
    }
    return {
      source: 'live',
      fights,
      fetchedAt: odds.fetchedAt,
      quotaRemaining: odds.quotaRemaining,
      stale: odds.stale,
      warnings,
      missingStats: [...missing].sort(),
    }
  }

  return { getCard, getOdds }
}
