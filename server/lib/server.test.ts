import { describe, expect, it, vi } from 'vitest'
import { parseCsv, parseFighterCsv } from './csv.ts'
import { createMemoryHistory } from './history.ts'
import { buildNameIndex, normalizeName } from './names.ts'
import { mapEvents, type OddsEvent } from './oddsApi.ts'
import { createCardService, ServiceError } from './service.ts'

const NOW = new Date('2026-10-25T12:00:00Z')

const CSV = [
  'name,record,dob,reach_cm,slpm,str_acc,str_def,td_avg,td_def,sub_avg,finish_rate,last_fight_date',
  'Alex Pereira,10-2-0,1987-07-07,201,"4.5",55%,60,0.2,80,0.1,0.8,2026-07-27',
  '"Doe, Jr.",1-0-0,1990-01-01,180,3,45,50,1,60,0.3,0.5,2026-01-01',
  'Broken Row,1-0-0,,,,,,,,,,',
].join('\r\n')

const event = (over: Partial<OddsEvent> = {}): OddsEvent => ({
  id: 'ev1',
  commence_time: '2026-11-01T02:00:00Z',
  home_team: 'Alex Pereira',
  away_team: 'Jon Unknown',
  bookmakers: [
    { key: 'a', title: 'Zeta', markets: [{ key: 'h2h', outcomes: [
      { name: 'Alex Pereira', price: -150 }, { name: 'Jon Unknown', price: 130 }] }] },
    { key: 'b', title: 'Alpha', markets: [{ key: 'h2h', outcomes: [
      { name: 'Alex Pereira', price: -140 }, { name: 'Jon Unknown', price: 120 }] }] },
    { key: 'c', title: 'Broken', markets: [{ key: 'h2h', outcomes: [
      { name: 'Alex Pereira', price: 0 }, { name: 'Jon Unknown', price: 120 }] }] },
  ],
  ...over,
})

describe('names', () => {
  it('normalises accents, case and punctuation', () => {
    expect(normalizeName("Jiří  O'Malley-Smith")).toBe('jiri omalley smith')
  })
  it('matches regardless of word order', () => {
    const idx = buildNameIndex([{ n: 'Jun-ho Park' }], (x) => x.n)
    expect(idx.find('Park Jun-ho')?.n).toBe('Jun-ho Park')
    expect(idx.find('Nobody')).toBeUndefined()
  })
})

describe('csv', () => {
  it('parses quotes, CRLF and commas inside fields', () => {
    const rows = parseCsv(CSV)
    expect(rows).toHaveLength(3)
    expect(rows[1].name).toBe('Doe, Jr.')
    expect(rows[0].slpm).toBe('4.5')
  })
  it('returns [] for header-only input', () => {
    expect(parseCsv('a,b')).toEqual([])
  })
  it('builds fighters, normalises percents and skips bad rows', () => {
    const { fighters, warnings } = parseFighterCsv(CSV, NOW)
    expect(fighters.map((f) => f.name)).toEqual(['Alex Pereira', 'Doe, Jr.'])
    expect(fighters[0].strikeAcc).toBeCloseTo(0.55)
    expect(fighters[0].strikeDef).toBeCloseTo(0.6)
    expect(fighters[0].age).toBe(39)
    expect(fighters[0].layoffDays).toBe(90)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Broken Row')
  })
  it('infers style from stats when blank', () => {
    const { fighters } = parseFighterCsv('name,slpm,str_acc,str_def,td_avg,td_def\nW,3,0.4,0.5,3.5,0.6', NOW)
    expect(fighters[0].style).toBe('Wrestler')
  })
})

describe('mapEvents', () => {
  const { fighters } = parseFighterCsv(CSV, NOW)

  it('maps books, drops invalid prices, sorts by title', () => {
    const [fight] = mapEvents([event()], fighters, createMemoryHistory(), NOW)
    expect(fight.books.map((b) => b.book)).toEqual(['Alpha', 'Zeta'])
    expect(fight.a.name).toBe('Alex Pereira')
    expect(fight.history).toHaveLength(1)
  })
  it('flags fights with missing stats', () => {
    const [fight] = mapEvents([event()], fighters, createMemoryHistory(), NOW)
    expect(fight.statsMissing).toBe(true)
  })
  it('has no missing flag when both fighters are known', () => {
    const e = event({ away_team: 'Doe, Jr.' })
    e.bookmakers.forEach((b) => b.markets[0].outcomes.forEach((o) => { if (o.name === 'Jon Unknown') o.name = 'Doe, Jr.' }))
    const [fight] = mapEvents([e], fighters, createMemoryHistory(), NOW)
    expect(fight.statsMissing).toBe(false)
  })
  it('skips started fights and events without usable books', () => {
    const started = event({ id: 'old', commence_time: '2026-10-24T00:00:00Z' })
    const none = event({ id: 'none', bookmakers: [] })
    expect(mapEvents([started, none], fighters, createMemoryHistory(), NOW)).toEqual([])
  })
  it('accumulates line history across refreshes', () => {
    const history = createMemoryHistory()
    mapEvents([event()], fighters, history, NOW)
    const e2 = event()
    e2.bookmakers[1].markets[0].outcomes[0].price = -200
    const [fight] = mapEvents([e2], fighters, history, NOW)
    expect(fight.history.length).toBe(2)
  })
})

describe('card service', () => {
  const loadFighters = async () => parseFighterCsv(CSV, NOW)
  const okFetch = (): typeof fetch =>
    vi.fn(async () => new Response(JSON.stringify([event()]), { status: 200, headers: { 'x-requests-remaining': '480' } }))

  it('refuses to run without an API key', async () => {
    const svc = createCardService({ apiKey: undefined, fetchImpl: okFetch(), loadFighters, history: createMemoryHistory(), ttlMs: 1000 })
    await expect(svc.getCard()).rejects.toMatchObject({ status: 503 })
  })

  it('returns fights, quota and missing-stats names, then caches', async () => {
    const fetchImpl = okFetch()
    const svc = createCardService({ apiKey: 'k', fetchImpl, loadFighters, history: createMemoryHistory(), ttlMs: 60_000, now: () => NOW.getTime() })
    const first = await svc.getCard()
    await svc.getCard()
    expect(first.fights).toHaveLength(1)
    expect(first.quotaRemaining).toBe('480')
    expect(first.missingStats).toEqual(['Jon Unknown'])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('maps upstream failures without leaking the key', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 401 })) as unknown as typeof fetch
    const svc = createCardService({ apiKey: 'SECRET-KEY', fetchImpl, loadFighters, history: createMemoryHistory(), ttlMs: 1000 })
    const err = await svc.getCard().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ServiceError)
    expect((err as ServiceError).status).toBe(502)
    expect((err as ServiceError).message).not.toContain('SECRET-KEY')
  })

  it('serves stale cache when a refresh fails', async () => {
    let t = NOW.getTime()
    let fail = false
    const fetchImpl = vi.fn(async () => (fail ? new Response('x', { status: 500 }) : new Response(JSON.stringify([event()]), { status: 200 }))) as unknown as typeof fetch
    const svc = createCardService({ apiKey: 'k', fetchImpl, loadFighters, history: createMemoryHistory(), ttlMs: 1000, now: () => t })
    await svc.getCard()
    fail = true
    t += 5000
    const payload = await svc.getCard()
    expect(payload.stale).toBe(true)
    expect(payload.fights).toHaveLength(1)
  })
})
