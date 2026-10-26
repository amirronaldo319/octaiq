import { describe, expect, it } from 'vitest'
import type { OddsEvent } from '../lib/oddsApi.ts'
import { isErrorResponse, isHealthResponse, isMarketResponse, isPricesResponse } from './contracts.ts'
import { handleRequest, ingest, RATE_LIMIT_PER_MINUTE, STALE_AFTER_HOURS, type Deps, type Kv } from './handler.ts'

const SECRET = 'TESTKEY_1234567890abcdef'
const SITE = 'https://example.test/octaiq/'
const START = '2026-11-01T22:00:00Z'

class MemoryKv implements Kv {
  data = new Map<string, string>()
  async get(k: string): Promise<string | null> { return this.data.get(k) ?? null }
  async put(k: string, v: string): Promise<void> { this.data.set(k, v) }
}

const siteFiles: Record<string, unknown> = {
  'data/events.json': { defaultId: 'e1', events: [{ id: 'e1' }] },
  'data/event-e1.json': {
    event: { id: 'e1', title: 'E1', prelimsStart: '2026-11-01T18:00:00Z', mainCardStart: START },
    fights: [{ id: 'e1-1', a: { name: 'Renato Moicano' }, b: { name: 'Tom Nolan' } }],
  },
}

const odds = (at: string): OddsEvent[] => [{
  id: 'x', commence_time: START, home_team: 'Renato Moicano', away_team: 'Tom Nolan',
  bookmakers: [
    { key: 'draftkings', title: 'Secret DraftKings', markets: [{ key: 'h2h', last_update: at, outcomes: [{ name: 'Renato Moicano', price: -120 }, { name: 'Tom Nolan', price: 100 }] }] },
    { key: 'fanduel', title: 'Secret FanDuel', markets: [{ key: 'h2h', last_update: at, outcomes: [{ name: 'Renato Moicano', price: -125 }, { name: 'Tom Nolan', price: 105 }] }] },
  ],
}]

interface Setup { deps: Deps; kv: MemoryKv; calls: string[]; provider: { responses: Response[] }; clock: { now: Date } }
function setup(opts: { key?: string | undefined; now?: string } = {}): Setup {
  const kv = new MemoryKv()
  const calls: string[] = []
  const provider = { responses: [] as Response[] }
  const clock = { now: new Date(opts.now ?? '2026-10-31T10:00:00Z') }
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url.replace(SECRET, '***'))
    if (url.startsWith(SITE)) {
      const body = siteFiles[url.slice(SITE.length)]
      return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('nf', { status: 404 })
    }
    return provider.responses.shift() ?? new Response('{}', { status: 500 })
  }) as typeof fetch
  const env = { ODDS_API_KEY: 'key' in opts ? opts.key : SECRET, ALLOWED_ORIGIN: 'https://site.test', SITE_BASE: SITE }
  return { deps: { kv, env, fetchImpl, now: () => clock.now, sleep: async () => undefined }, kv, calls, provider, clock }
}
const ok = (events: OddsEvent[], extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(events), { status: 200, headers: { 'x-requests-remaining': '480', 'x-requests-used': '20', 'x-requests-last': '3', ...extra } })
const get = (path: string, headers: Record<string, string> = {}): Request => new Request(`https://worker.test${path}`, { headers })

describe('ingest', () => {
  it('makes one provider call, stores a bookmaker-free consensus, history and quota, and never stores the key', async () => {
    const s = setup()
    s.provider.responses.push(ok(odds('2026-10-31T09:55:00Z')))
    const r = await ingest(s.deps)
    expect(r.status).toBe('polled')
    expect(s.calls.filter((c) => c.includes('api.the-odds-api.com'))).toHaveLength(1)
    const market = JSON.parse(s.kv.data.get('market:latest') as string)
    expect(market.events.e1['e1-1'].books).toBe(2)
    expect(market.events.e1['e1-1'].newestQuote).toBe('2026-10-31T09:55:00Z')
    expect(JSON.parse(s.kv.data.get('prices:e1') as string).points).toHaveLength(1)
    expect(JSON.parse(s.kv.data.get('meta') as string)).toMatchObject({ quotaRemaining: '480', lastCost: '3' })
    // Only the private raw snapshot may contain bookmaker names; nothing that is served may.
    const served = ['market:latest', 'prices:published', 'prices:e1', 'meta'].map((k) => s.kv.data.get(k) ?? '').join('')
    expect(served).not.toContain('Secret')
    expect([...s.kv.data.values()].join('')).not.toContain(SECRET)
  })

  it('does nothing without a key, after the event has started, or before the next poll is due', async () => {
    expect((await ingest(setup({ key: undefined }).deps)).status).toBe('skipped')
    expect((await ingest(setup({ now: '2026-11-02T00:00:00Z' }).deps)).reason).toMatch(/No upcoming event/)
    const s = setup()
    s.provider.responses.push(ok(odds('2026-10-31T09:55:00Z')))
    await ingest(s.deps)
    s.clock.now = new Date('2026-10-31T10:20:00Z')
    const again = await ingest(s.deps)
    expect(again.status).toBe('skipped')
    expect(s.calls.filter((c) => c.includes('api.the-odds-api.com'))).toHaveLength(1)
  })

  it('retries a failure with backoff, then keeps the previous prices and records the error without the key', async () => {
    const s = setup()
    s.provider.responses.push(ok(odds('2026-10-31T09:55:00Z')))
    await ingest(s.deps)
    s.clock.now = new Date('2026-10-31T14:00:00Z')
    s.provider.responses.push(new Response('boom', { status: 503 }), new Response('boom', { status: 429 }), new Response('boom', { status: 503 }))
    const r = await ingest(s.deps)
    expect(r.status).toBe('failed')
    expect(r.reason).toMatch(/3 attempts/)
    expect(JSON.parse(s.kv.data.get('market:latest') as string).generatedAt).toBe('2026-10-31T10:00:00.000Z')
    expect(s.kv.data.get('meta')).toContain('lastError')
    expect(s.kv.data.get('meta')).not.toContain(SECRET)
  })

  it('does not retry a refused key or an exhausted quota, and rejects a malformed response', async () => {
    const s = setup()
    s.provider.responses.push(new Response('{"error_code":"OUT_OF_USAGE_CREDITS"}', { status: 401 }))
    expect((await ingest(s.deps)).reason).toMatch(/refused/)
    expect(s.calls.filter((c) => c.includes('api.the-odds-api.com'))).toHaveLength(1)
    const bad = setup()
    bad.provider.responses.push(new Response(JSON.stringify([{ id: 1 }]), { status: 200 }))
    expect((await ingest(bad.deps)).reason).toMatch(/expected shape/)
    expect(bad.kv.data.get('market:latest')).toBeUndefined()
  })
})

describe('public endpoint', () => {
  async function withData(): Promise<Setup> {
    const s = setup()
    s.provider.responses.push(ok(odds('2026-10-31T09:55:00Z')))
    await ingest(s.deps)
    return s
  }

  it('serves the cached consensus with freshness, and answers 503 before any data', async () => {
    expect((await handleRequest(get('/api/market'), setup().deps)).status).toBe(503)
    const s = await withData()
    s.clock.now = new Date('2026-10-31T10:30:00Z')
    const res = await handleRequest(get('/api/market'), s.deps)
    const body = await res.json() as { freshness: { ageHours: number; stale: boolean }; events: Record<string, unknown> }
    expect(res.status).toBe(200)
    expect(body.freshness).toMatchObject({ ageHours: 0.5, stale: false })
    expect(res.headers.get('cache-control')).toContain('max-age=60')
    expect(JSON.stringify(body)).not.toContain('Secret')
  })

  it('labels prices stale after the threshold or after a failed refresh, but keeps serving them', async () => {
    const s = await withData()
    s.clock.now = new Date(Date.parse('2026-10-31T10:00:00Z') + (STALE_AFTER_HOURS + 1) * 3_600_000)
    expect(((await (await handleRequest(get('/api/market'), s.deps)).json()) as { freshness: { stale: boolean } }).freshness.stale).toBe(true)
    const f = await withData()
    f.clock.now = new Date('2026-10-31T14:00:00Z')
    f.provider.responses.push(new Response('x', { status: 503 }), new Response('x', { status: 503 }), new Response('x', { status: 503 }))
    await ingest(f.deps)
    const body = await (await handleRequest(get('/api/market'), f.deps)).json() as { freshness: { stale: boolean; lastError: string | null }; events: object }
    expect(body.freshness.stale).toBe(true)
    expect(body.freshness.lastError).toMatch(/did not answer/)
    expect(Object.keys(body.events)).toEqual(['e1'])
  })

  it('accepts only GET on known paths with a valid event parameter', async () => {
    const s = await withData()
    expect((await handleRequest(new Request('https://worker.test/api/market', { method: 'POST' }), s.deps)).status).toBe(405)
    expect((await handleRequest(get('/api/other'), s.deps)).status).toBe(404)
    expect((await handleRequest(get('/api/market?key=abc'), s.deps)).status).toBe(400)
    expect((await handleRequest(get('/api/market?event=../etc'), s.deps)).status).toBe(400)
    expect((await handleRequest(get('/api/market?event=e1'), s.deps)).status).toBe(200)
    const none = await (await handleRequest(get('/api/market?event=unknown-event'), s.deps)).json() as { events: object }
    expect(none.events).toEqual({})
  })

  it('allows only the configured origin and limits each client per minute', async () => {
    const s = await withData()
    const allowed = await handleRequest(get('/api/market', { origin: 'https://site.test' }), s.deps)
    const other = await handleRequest(get('/api/market', { origin: 'https://evil.test' }), s.deps)
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://site.test')
    expect(other.headers.get('access-control-allow-origin')).toBeNull()
    let last = 200
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE + 2; i++) last = (await handleRequest(get('/api/market', { 'cf-connecting-ip': '1.2.3.4' }), s.deps)).status
    expect(last).toBe(429)
    expect((await handleRequest(get('/api/market', { 'cf-connecting-ip': '5.6.7.8' }), s.deps)).status).toBe(200)
  })

  it('serves price history', async () => {
    const s = await withData()
    const body = await (await handleRequest(get('/api/prices?event=e1'), s.deps)).json() as { events: Record<string, { bouts: object }[]> }
    expect(body.events.e1[0].bouts).toHaveProperty('e1-1')
  })
})

describe('API contracts', () => {
  it('every successful response matches its published shape, and every error carries a message', async () => {
    const s = setup()
    s.provider.responses.push(ok(odds('2026-10-31T09:55:00Z')))
    await ingest(s.deps)
    expect(isMarketResponse(await (await handleRequest(get('/api/market'), s.deps)).json())).toBe(true)
    expect(isPricesResponse(await (await handleRequest(get('/api/prices'), s.deps)).json())).toBe(true)
    for (const path of ['/api/nope', '/api/market?x=1', '/api/market?event=../x']) {
      const res = await handleRequest(get(path), s.deps)
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(isErrorResponse(await res.json())).toBe(true)
    }
    expect(isErrorResponse(await (await handleRequest(get('/api/market'), setup().deps)).json())).toBe(true)
  })

  it('reports health as no-data, ok, then degraded after a failed refresh, never exposing the key', async () => {
    const s = setup()
    const first = await (await handleRequest(get('/api/system/health'), s.deps)).json()
    expect(isHealthResponse(first)).toBe(true)
    expect(first.status).toBe('no-data')
    s.provider.responses.push(ok(odds('2026-10-31T09:55:00Z')))
    await ingest(s.deps)
    const good = await (await handleRequest(get('/api/system/health'), s.deps)).json()
    expect(good).toMatchObject({ status: 'ok', apiVersion: 1, quota: { remaining: '480', lastCost: '3' } })
    s.clock.now = new Date('2026-10-31T14:00:00Z')
    s.provider.responses.push(new Response('x', { status: 503 }), new Response('x', { status: 503 }), new Response('x', { status: 503 }))
    await ingest(s.deps)
    const bad = await (await handleRequest(get('/api/system/health'), s.deps)).json()
    expect(bad.status).toBe('degraded')
    expect(isHealthResponse(bad)).toBe(true)
    expect(JSON.stringify(bad)).not.toContain(SECRET)
  })

  it('rejects malformed data when checked against the contract', () => {
    expect(isMarketResponse({ generatedAt: 'x' })).toBe(false)
    expect(isMarketResponse({ generatedAt: '2026-10-31T10:00:00Z', source: 's', attribution: 'a', freshness: { fetchedAt: '2026-10-31T10:00:00Z', ageHours: 0, stale: false }, events: { e: { b: { pA: 1.4, pLo: 0.3, pHi: 0.9, books: 3 } } } })).toBe(false)
    expect(isHealthResponse({ status: 'ok' })).toBe(false)
  })
})
