import { describe, expect, it, vi } from 'vitest'
import { checkOdds, formatReport, hasFailures, runChecks, type CheckDeps } from './check.ts'

const NOW = new Date('2026-10-25T12:00:00Z')
const ODDS_KEY = 'ODDS-SECRET-111'
const UFC_KEY = 'UFC-SECRET-222'

const event = {
  id: 'e1',
  commence_time: '2026-11-01T02:00:00Z',
  home_team: 'Alex Pereira',
  away_team: 'Jon Unknown',
  bookmakers: [
    { key: 'a', title: 'Alpha', markets: [{ key: 'h2h', outcomes: [{ name: 'Alex Pereira', price: -150 }, { name: 'Jon Unknown', price: 130 }] }] },
    { key: 'b', title: 'Beta', markets: [{ key: 'h2h', outcomes: [{ name: 'Alex Pereira', price: -140 }, { name: 'Jon Unknown', price: 120 }] }] },
  ],
}

const pereira = {
  id: 1, slug: 'alex-pereira', name: 'Alex Pereira', reach_inches: 79, dob: '1987-07-07',
  records: { pro_mma: { value: '12-3-0' } },
  stats: { slpm: '4.50', str_acc: '55%', str_def: '60%', td_avg: '0.20', td_def: '80%', sub_avg: '0.1' },
  last_fight: { date: '2026-07-27' },
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers })

type Route = (url: string) => Response | undefined

function makeFetch(...routes: Route[]): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    for (const route of routes) {
      const res = route(url)
      if (res) return res
    }
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
}

const oddsOk: Route = (url) => {
  if (url.includes('/v4/sports/?')) return json([{ key: 'mma_mixed_martial_arts', active: true }])
  if (url.includes('/odds?')) return json([event], 200, { 'x-requests-remaining': '490' })
}

const ufcOk: Route = (url) => {
  const path = url.replace('https://api.ufcalendar.com/v1', '')
  if (path.startsWith('/fighters?q=pereira')) return json({ data: [] }, 200, { 'x-ratelimit-remaining': '29990', 'x-ratelimit-limit': '30000' })
  if (path === '/fighters/alex-pereira') return json({ data: pereira })
  if (path === '/fighters/alex-pereira/history') return json({ data: [] })
  if (path.startsWith('/fighters?q=Jon')) return json({ data: [] })
}

const deps = (over: Partial<CheckDeps>): CheckDeps => ({
  oddsKey: ODDS_KEY, ufcKey: UFC_KEY, fetchImpl: makeFetch(oddsOk, ufcOk), fetchOdds: true, now: () => NOW.getTime(), ...over,
})

describe('runChecks', () => {
  it('reports success end to end and never prints the keys', async () => {
    const results = await runChecks(deps({}))
    const report = formatReport(results, [ODDS_KEY, UFC_KEY])
    expect(hasFailures(results)).toBe(false)
    expect(report).toContain('✓ Odds API key: accepted')
    expect(report).toContain('1 upcoming fights, ~2 books each, 490 credits left')
    expect(report).toContain('29990/30000 requests left')
    expect(report).toContain('Stats for Alex Pereira')
    expect(report).toContain('TD/15 0.20')
    expect(report).toContain('no usable career stats for Jon Unknown')
    expect(report).not.toContain(ODDS_KEY)
    expect(report).not.toContain(UFC_KEY)
  })

  it('fails clearly when keys are missing', async () => {
    const results = await runChecks(deps({ oddsKey: undefined, ufcKey: undefined }))
    expect(results.map((r) => r.status)).toEqual(['fail', 'fail'])
    expect(formatReport(results, [])).toContain('2 failed')
  })

  it('flags a rejected odds key but still checks the stats key', async () => {
    const fetchImpl = makeFetch((u) => (u.includes('the-odds-api.com') ? new Response('no', { status: 401 }) : undefined), ufcOk)
    const results = await runChecks(deps({ fetchImpl }))
    expect(results[0]).toMatchObject({ name: 'Odds API key', status: 'fail' })
    expect(results.some((r) => r.name === 'Stats API key' && r.status === 'ok')).toBe(true)
    expect(hasFailures(results)).toBe(true)
  })

  it('flags a rejected stats key without an odds-derived sample', async () => {
    const fetchImpl = makeFetch(oddsOk, (u) => (u.includes('ufcalendar.com') ? new Response('no', { status: 403 }) : undefined))
    const results = await runChecks(deps({ fetchImpl }))
    const stats = results.find((r) => r.name === 'Stats API key')
    expect(stats?.status).toBe('fail')
    expect(stats?.detail).toContain('UFCALENDAR_API_KEY')
  })

  it('treats a quota hit as a warning, not a failure', async () => {
    const fetchImpl = makeFetch(oddsOk, (u) => (u.includes('ufcalendar.com') ? new Response('slow down', { status: 429 }) : undefined))
    const results = await runChecks(deps({ fetchImpl }))
    expect(results.find((r) => r.name === 'Stats API key')?.status).toBe('warn')
  })

  it('reports an unreachable network without leaking the URL', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      throw new Error(`connect ECONNREFUSED ${String(input)}`)
    }) as unknown as typeof fetch
    const results = await runChecks(deps({ fetchImpl }))
    const report = formatReport(results, [ODDS_KEY, UFC_KEY])
    expect(report).toContain('could not reach')
    expect(report).not.toContain(ODDS_KEY)
  })
})

describe('checkOdds', () => {
  it('skips the credit-costing odds call with fetchOdds=false', async () => {
    const fetchImpl = makeFetch(oddsOk)
    const { results } = await checkOdds(deps({ fetchImpl, fetchOdds: false }))
    expect(results.find((r) => r.name === 'Odds payload')?.status).toBe('skip')
    const calledOdds = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).includes('/odds?'))
    expect(calledOdds).toBe(false)
  })

  it('warns when MMA is inactive or the payload has no fights', async () => {
    const fetchImpl = makeFetch((u) => {
      if (u.includes('/v4/sports/?')) return json([{ key: 'mma_mixed_martial_arts', active: false }])
      if (u.includes('/odds?')) return json([])
    })
    const { results } = await checkOdds(deps({ fetchImpl }))
    expect(results.find((r) => r.name === 'MMA market')?.status).toBe('warn')
    expect(results.find((r) => r.name === 'Odds payload')?.status).toBe('warn')
  })
})

describe('formatReport', () => {
  it('scrubs secrets that slip into details', () => {
    const text = formatReport([{ name: 'x', status: 'fail', detail: `bad ${ODDS_KEY}` }], [ODDS_KEY, undefined])
    expect(text).not.toContain(ODDS_KEY)
    expect(text).toContain('***')
  })
})
