import type { EventIndex, EventPayload } from '../../src/engine/eventTypes.ts'
import { isOddsEvents, oddsUrl, type OddsEvent } from '../lib/oddsApi.ts'
import { MARKET_ATTRIBUTION, MARKET_METHOD, type MarketBout, type MarketFile } from '../lib/marketSnapshot.ts'
import { marketFromFights } from '../odds/consensus.ts'
import { pollIntervalMinutes } from '../odds/plan.ts'
import { appendPoint, toPublished, type PriceHistory } from '../lib/priceHistory.ts'

/**
 * A small, protected service in front of the odds provider. The provider key lives only in this service's secrets.
 * Visitors read one validated, cached consensus from here; they never cause a provider call.
 * It is written against plain interfaces so it can be tested without any hosting platform.
 */
export interface Kv {
  get(key: string): Promise<string | null>
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>
}

export interface Env {
  ODDS_API_KEY?: string
  /** The one site origin allowed to read the API from a browser, for example https://amirronaldo319.github.io */
  ALLOWED_ORIGIN?: string
  /** Where the public event files live, for example https://amirronaldo319.github.io/octaiq/ */
  SITE_BASE?: string
  /** Comma-separated provider regions, e.g. "us" to spend fewer credits */
  ODDS_REGIONS?: string
}

export interface Deps {
  kv: Kv
  env: Env
  fetchImpl: typeof fetch
  now: () => Date
  sleep?: (ms: number) => Promise<void>
}

export const RATE_LIMIT_PER_MINUTE = 60
export const STALE_AFTER_HOURS = 8
const EVENT_ID = /^[a-z0-9][a-z0-9-]{0,79}$/
const MAX_ATTEMPTS = 3
const TIMEOUT_MS = 10_000

const json = (body: unknown, status: number, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', ...extra } })

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('origin')
  return origin && env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN ? { 'access-control-allow-origin': origin, vary: 'Origin' } : { vary: 'Origin' }
}

/** Fixed-window limit per client and minute. Approximate by design: a platform rate-limiting rule should sit in front as well. */
async function limited(req: Request, deps: Deps): Promise<number | null> {
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? 'unknown'
  const minute = Math.floor(deps.now().getTime() / 60_000)
  const key = `rl:${ip.slice(0, 64)}:${minute}`
  const count = Number((await deps.kv.get(key)) ?? 0) + 1
  await deps.kv.put(key, String(count), { expirationTtl: 120 })
  return count > RATE_LIMIT_PER_MINUTE ? 60 - (Math.floor(deps.now().getTime() / 1000) % 60) : null
}

interface Meta {
  lastSuccessAt?: string
  lastAttemptAt?: string
  lastError?: string
  quotaRemaining?: string
  quotaUsed?: string
  lastCost?: string
}

const readJson = async <T>(kv: Kv, key: string): Promise<T | null> => {
  const raw = await kv.get(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** The one public endpoint: GET /api/market, optionally ?event=<id>. */
export async function handleRequest(req: Request, deps: Deps): Promise<Response> {
  const headers = cors(req, deps.env)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-max-age': '600' } })
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405, { ...headers, allow: 'GET, OPTIONS' })
  const url = new URL(req.url)
  if (url.pathname !== '/api/market' && url.pathname !== '/api/prices') return json({ error: 'Not found' }, 404, headers)
  for (const key of url.searchParams.keys()) if (key !== 'event') return json({ error: `Unknown parameter: ${key.slice(0, 40)}` }, 400, headers)
  const eventId = url.searchParams.get('event')
  if (eventId !== null && !EVENT_ID.test(eventId)) return json({ error: 'Invalid event id' }, 400, headers)

  const wait = await limited(req, deps)
  if (wait !== null) return json({ error: 'Too many requests' }, 429, { ...headers, 'retry-after': String(wait) })

  const meta = (await readJson<Meta>(deps.kv, 'meta')) ?? {}
  if (url.pathname === '/api/prices') {
    const prices = await readJson<ReturnType<typeof toPublished>>(deps.kv, 'prices:published')
    if (!prices) return json({ error: 'No price history yet' }, 503, headers)
    const events = eventId ? Object.fromEntries(Object.entries(prices.events).filter(([id]) => id === eventId)) : prices.events
    return json({ ...prices, events }, 200, { ...headers, 'cache-control': 'public, max-age=60' })
  }
  const market = await readJson<MarketFile>(deps.kv, 'market:latest')
  if (!market) return json({ error: 'No prices yet', lastError: meta.lastError ?? null }, 503, headers)
  const ageHours = (deps.now().getTime() - Date.parse(market.generatedAt)) / 3_600_000
  const failedSince = meta.lastError && meta.lastAttemptAt && (!meta.lastSuccessAt || Date.parse(meta.lastAttemptAt) > Date.parse(meta.lastSuccessAt))
  const events = eventId ? Object.fromEntries(Object.entries(market.events).filter(([id]) => id === eventId)) : market.events
  return json(
    { ...market, events, freshness: { fetchedAt: market.generatedAt, ageHours: Math.round(ageHours * 10) / 10, stale: ageHours > STALE_AFTER_HOURS || Boolean(failedSince), lastError: failedSince ? meta.lastError : null } },
    200,
    { ...headers, 'cache-control': 'public, max-age=60' },
  )
}

const sleepDefault = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** One provider request with a timeout, a short retry on rate limiting or server errors, and exponential backoff. Never logs the URL. */
async function fetchOdds(deps: Deps, key: string): Promise<{ events: OddsEvent[]; headers: Headers }> {
  const sleep = deps.sleep ?? sleepDefault
  let lastStatus = 0
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await deps.fetchImpl(oddsUrl(key, deps.env.ODDS_REGIONS), { signal: AbortSignal.timeout(TIMEOUT_MS) })
      lastStatus = res.status
      if (res.ok) {
        const body: unknown = await res.json()
        if (!isOddsEvents(body)) throw new Error('The provider response was not in the expected shape')
        return { events: body, headers: res.headers }
      }
      // A bad key, an exhausted quota or a bad request will not improve by retrying.
      if (res.status === 401 || res.status === 403 || res.status === 422) throw new Error(`The provider refused the request (HTTP ${res.status})`)
    } catch (err) {
      if (err instanceof Error && /refused|expected shape/.test(err.message)) throw err
      lastStatus = lastStatus || 0
    }
    if (attempt < MAX_ATTEMPTS) await sleep(500 * 2 ** (attempt - 1))
  }
  throw new Error(`The provider did not answer after ${MAX_ATTEMPTS} attempts (last status ${lastStatus || 'network error'})`)
}

interface SiteEvent {
  id: string
  title: string
  prelimsStart: string
  mainCardStart: string
  fights: { id: string; a: { name: string }; b: { name: string } }[]
}

async function loadSiteEvents(deps: Deps): Promise<SiteEvent[]> {
  const base = (deps.env.SITE_BASE ?? '').replace(/\/?$/, '/')
  const get = async (path: string): Promise<unknown> => {
    const res = await deps.fetchImpl(`${base}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    return res.ok ? res.json() : null
  }
  const index = (await get('data/events.json')) as EventIndex | null
  if (!index || !Array.isArray(index.events)) return []
  const out: SiteEvent[] = []
  for (const e of index.events) {
    const payload = (await get(`data/event-${e.id}.json`)) as EventPayload | null
    if (payload && Array.isArray(payload.fights)) {
      out.push({ id: e.id, title: payload.event.title, prelimsStart: payload.event.prelimsStart, mainCardStart: payload.event.mainCardStart, fights: payload.fights.map((f) => ({ id: f.id, a: { name: f.a.name }, b: { name: f.b.name } })) })
    }
  }
  return out
}

export type IngestResult = { status: 'polled' | 'skipped' | 'failed'; reason: string }

/** Called on a schedule. Decides whether a provider call is due, makes at most one, and stores a validated consensus. */
export async function ingest(deps: Deps): Promise<IngestResult> {
  const key = deps.env.ODDS_API_KEY?.trim()
  if (!key) return { status: 'skipped', reason: 'No ODDS_API_KEY secret is set.' }
  const now = deps.now()
  const meta = (await readJson<Meta>(deps.kv, 'meta')) ?? {}
  const events = await loadSiteEvents(deps)
  const upcoming = events.map((e) => Date.parse(e.prelimsStart)).filter((t) => t > now.getTime()).sort((a, b) => a - b)[0]
  if (upcoming === undefined) return { status: 'skipped', reason: 'No upcoming event; pre-fight prices are not polled after the start.' }
  const interval = pollIntervalMinutes((upcoming - now.getTime()) / 3_600_000)
  if (interval === null) return { status: 'skipped', reason: 'The event has started.' }
  if (meta.lastAttemptAt && now.getTime() - Date.parse(meta.lastAttemptAt) < interval * 60_000) {
    return { status: 'skipped', reason: `Next poll is not due for ${interval} minutes after the last attempt.` }
  }

  await deps.kv.put('meta', JSON.stringify({ ...meta, lastAttemptAt: now.toISOString() } satisfies Meta))
  try {
    const { events: odds, headers } = await fetchOdds(deps, key)
    const market: MarketFile = { generatedAt: now.toISOString(), source: 'The Odds API', attribution: MARKET_ATTRIBUTION, method: MARKET_METHOD, events: {} }
    const r4 = (n: number): number => Math.round(n * 10_000) / 10_000
    for (const ev of events) {
      const found = marketFromFights(ev.fights, odds, now)
      const bouts: Record<string, MarketBout> = {}
      for (const [id, c] of Object.entries(found)) bouts[id] = { pA: r4(c.pA), pLo: r4(c.pLo), pHi: r4(c.pHi), books: c.books, median: r4(c.median), oldestQuote: c.oldestQuote, newestQuote: c.newestQuote }
      if (Object.keys(bouts).length === 0) continue
      market.events[ev.id] = bouts
      if (Date.parse(ev.mainCardStart) > now.getTime()) {
        const existing = await readJson<PriceHistory>(deps.kv, `prices:${ev.id}`)
        const updated = appendPoint(existing ?? undefined, ev.id, bouts, now)
        if (updated) await deps.kv.put(`prices:${ev.id}`, JSON.stringify(updated))
      }
    }
    const histories: PriceHistory[] = []
    for (const ev of events) {
      const h = await readJson<PriceHistory>(deps.kv, `prices:${ev.id}`)
      if (h) histories.push(h)
    }
    // The raw provider snapshot is kept privately for later analysis; it is never served.
    await deps.kv.put(`raw:${now.toISOString()}`, JSON.stringify(odds), { expirationTtl: 30 * 86_400 })
    await deps.kv.put('prices:published', JSON.stringify(toPublished(histories, now)))
    await deps.kv.put('market:latest', JSON.stringify(market))
    await deps.kv.put('meta', JSON.stringify({
      lastSuccessAt: now.toISOString(), lastAttemptAt: now.toISOString(),
      quotaRemaining: headers.get('x-requests-remaining') ?? undefined, quotaUsed: headers.get('x-requests-used') ?? undefined, lastCost: headers.get('x-requests-last') ?? undefined,
    } satisfies Meta))
    return { status: 'polled', reason: `Stored a consensus for ${Object.values(market.events).reduce((n, e) => n + Object.keys(e).length, 0)} bouts.` }
  } catch (err) {
    const message = (err instanceof Error ? err.message : 'Unknown error').replaceAll(key, '***')
    await deps.kv.put('meta', JSON.stringify({ ...meta, lastAttemptAt: now.toISOString(), lastError: message } satisfies Meta))
    return { status: 'failed', reason: message }
  }
}
