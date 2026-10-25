import { describe, expect, it, vi } from 'vitest'
import { createMemoryCache } from './fighterCache.ts'
import { combineProviders, type FighterProvider } from './providers.ts'
import { createUfcalendarProvider, deriveFromHistory, mapProfile, type ApiFighter, type ApiHistoryRow } from './ufcalendar.ts'

const NOW = new Date('2026-10-25T12:00:00Z')

const profile = (over: Partial<ApiFighter> = {}): ApiFighter => ({
  id: 1,
  slug: 'alex-pereira',
  name: 'Alex Pereira',
  reach_inches: 79,
  dob: '1987-07-07',
  records: { pro_mma: { value: '12-3-0' }, ufc: { value: '9-3-0' } },
  stats: {
    slpm: '4.50', str_acc: '55%', sapm: '3.10', str_def: '60%', td_avg: '0.20', td_acc: '30%', td_def: '80%', sub_avg: '0.1',
    values: { slpm: 4.5, str_acc: 0.55, str_def: 0.6, td_avg: 0.2, td_def: 0.8, sub_avg: 0.1 },
  },
  last_fight: { date: '2026-07-27' },
  ...over,
})

const hist = (status: string, method: string | null): ApiHistoryRow => ({ status, method_normalized: method })

describe('mapProfile', () => {
  it('maps the documented fields', () => {
    const f = mapProfile(profile(), null, NOW)
    expect(f).toMatchObject({ id: 'alex-pereira', name: 'Alex Pereira', record: '12-3-0', slpm: 4.5, tdPer15: 0.2, subPer15: 0.1 })
    expect(f?.reachCm).toBe(201)
    expect(f?.age).toBe(39)
    expect(f?.layoffDays).toBe(90)
    expect(f?.strikeAcc).toBeCloseTo(0.55)
    expect(f?.tdDef).toBeCloseTo(0.8)
  })

  it('falls back to display strings and normalises percents', () => {
    const p = profile({ stats: { slpm: '3.2', str_acc: '48%', str_def: '55%', td_avg: '2.1', td_def: '70%', sub_avg: null } })
    const f = mapProfile(p, null, NOW)
    expect(f?.strikeAcc).toBeCloseTo(0.48)
    expect(f?.strikeDef).toBeCloseTo(0.55)
    expect(f?.tdDef).toBeCloseTo(0.7)
    expect(f?.subPer15).toBe(0.3)
  })

  it('returns null when a required stat is missing', () => {
    expect(mapProfile(profile({ stats: null }), null, NOW)).toBeNull()
    const noDef = profile({ stats: { slpm: '3', str_acc: '50%', str_def: null, td_avg: '1', td_def: '60%' } })
    expect(mapProfile(noDef, null, NOW)).toBeNull()
  })

  it('uses neutral defaults for missing bio fields', () => {
    const f = mapProfile(profile({ reach_inches: null, dob: null, last_fight: null, records: {} }), null, NOW)
    expect(f).toMatchObject({ reachCm: 180, age: 30, layoffDays: 300, record: '—' })
  })
})

describe('deriveFromHistory', () => {
  it('shrinks small samples toward neutral', () => {
    const d = deriveFromHistory([hist('win', 'ko_tko')])
    expect(d.finishRate).toBeCloseTo(2.5 / 4)
  })
  it('rewards finishers and penalises knockout losses', () => {
    const finisher = deriveFromHistory(Array.from({ length: 10 }, () => hist('win', 'submission')))
    const glass = deriveFromHistory([...Array.from({ length: 4 }, () => hist('loss', 'ko_tko')), hist('win', 'decision_unanimous')])
    expect(finisher.finishRate).toBeGreaterThan(0.8)
    expect(glass.chin).toBeLessThan(0.5)
    expect(deriveFromHistory([]).chin).toBeLessThanOrEqual(0.9)
  })
  it('ignores non-decided rows', () => {
    const d = deriveFromHistory([hist('upcoming', null), hist('cancelled', null)])
    expect(d.finishRate).toBeCloseTo(0.5)
  })
})

function mockFetch(routes: Record<string, () => Response>): ReturnType<typeof vi.fn> & typeof fetch {
  return vi.fn(async (url: string | URL | Request) => {
    const path = String(url).replace('https://api.ufcalendar.com/v1', '')
    const handler = routes[path]
    return handler ? handler() : new Response('{}', { status: 404 })
  }) as unknown as ReturnType<typeof vi.fn> & typeof fetch
}

const json = (data: unknown, status = 200): Response => new Response(JSON.stringify({ data, meta: {} }), { status })

describe('ufcalendar provider', () => {
  const base = { apiKey: 'SECRET-KEY', now: () => NOW.getTime() }

  it('resolves by slug and sends the bearer key', async () => {
    const fetchImpl = mockFetch({
      '/fighters/alex-pereira': () => json(profile()),
      '/fighters/alex-pereira/history': () => json([hist('win', 'ko_tko'), hist('win', 'ko_tko'), hist('loss', 'decision_split')]),
    })
    const provider = createUfcalendarProvider({ ...base, fetchImpl, cache: createMemoryCache() })
    const { fighters, warnings } = await provider(['Alex Pereira'])
    expect(fighters).toHaveLength(1)
    expect(warnings).toEqual([])
    const init = fetchImpl.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer SECRET-KEY')
  })

  it('falls back to search when the slug is unknown', async () => {
    const fetchImpl = mockFetch({
      '/fighters/jun-ho-park': () => new Response('{}', { status: 404 }),
      '/fighters?q=Jun-ho%20Park&limit=5': () => json([{ slug: 'junho-park', name: 'Junho Park' }, { slug: 'jun-ho-park-2', name: 'Jun-ho Park' }]),
      '/fighters/jun-ho-park-2': () => json(profile({ slug: 'jun-ho-park-2', name: 'Jun-ho Park' })),
      '/fighters/jun-ho-park-2/history': () => json([]),
    })
    const provider = createUfcalendarProvider({ ...base, fetchImpl, cache: createMemoryCache() })
    const { fighters } = await provider(['Jun-ho Park'])
    expect(fighters.map((f) => f.name)).toEqual(['Jun-ho Park'])
  })

  it('rejects a slug that resolves to a different fighter', async () => {
    const fetchImpl = mockFetch({
      '/fighters/john-smith': () => json(profile({ name: 'Someone Else' })),
      '/fighters?q=John%20Smith&limit=5': () => json([]),
    })
    const provider = createUfcalendarProvider({ ...base, fetchImpl, cache: createMemoryCache() })
    const { fighters, warnings } = await provider(['John Smith'])
    expect(fighters).toEqual([])
    expect(warnings[0]).toContain('John Smith')
  })

  it('caches hits and misses so quota is not re-spent', async () => {
    const fetchImpl = mockFetch({
      '/fighters/alex-pereira': () => json(profile()),
      '/fighters/alex-pereira/history': () => json([]),
      '/fighters/ghost': () => new Response('{}', { status: 404 }),
      '/fighters?q=Ghost&limit=5': () => json([]),
    })
    const provider = createUfcalendarProvider({ ...base, fetchImpl, cache: createMemoryCache() })
    await provider(['Alex Pereira', 'Ghost'])
    const calls = fetchImpl.mock.calls.length
    const second = await provider(['Alex Pereira', 'Ghost'])
    expect(fetchImpl.mock.calls.length).toBe(calls)
    expect(second.fighters).toHaveLength(1)
  })

  it('stops on auth failure with a warning that omits the key', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 })) as unknown as ReturnType<typeof vi.fn> & typeof fetch
    const provider = createUfcalendarProvider({ ...base, fetchImpl, cache: createMemoryCache() })
    const { fighters, warnings } = await provider(['A B', 'C D', 'E F', 'G H', 'I J', 'K L', 'M N', 'O P'])
    expect(fighters).toEqual([])
    expect(warnings.join(' ')).not.toContain('SECRET-KEY')
    expect(warnings.join(' ')).toContain('UFCALENDAR_API_KEY')
    // First chunk of 4 may already be in flight, but later chunks must not start.
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(4)
  })

  it('stops on quota exhaustion and does not cache the failure', async () => {
    const cache = createMemoryCache()
    const fetchImpl = mockFetch({ '/fighters/a-b': () => new Response('{}', { status: 429 }) })
    const provider = createUfcalendarProvider({ ...base, fetchImpl, cache })
    const { warnings } = await provider(['A B'])
    expect(warnings[0]).toContain('quota')
    expect(cache.get('a b')).toBeUndefined()
  })
})

describe('combineProviders', () => {
  const fighter = (name: string) => mapProfile(profile({ name, slug: name }), null, NOW)!

  it('only asks the fallback for names the primary missed', async () => {
    const primary: FighterProvider = async () => ({ fighters: [fighter('Alex Pereira')], warnings: ['csv warning'] })
    const fallback = vi.fn<FighterProvider>(async (names) => ({ fighters: names.map(fighter), warnings: ['api warning'] }))
    const result = await combineProviders(primary, fallback)(['Pereira Alex', 'New Guy'])
    expect(fallback).toHaveBeenCalledWith(['New Guy'])
    expect(result.fighters.map((f) => f.name)).toEqual(['Alex Pereira', 'New Guy'])
    expect(result.warnings).toEqual(['csv warning', 'api warning'])
  })

  it('skips the fallback when everything is covered or none is configured', async () => {
    const primary: FighterProvider = async () => ({ fighters: [fighter('Alex Pereira')], warnings: [] })
    const fallback = vi.fn<FighterProvider>(async () => ({ fighters: [], warnings: [] }))
    await combineProviders(primary, fallback)(['Alex Pereira'])
    expect(fallback).not.toHaveBeenCalled()
    expect((await combineProviders(primary, null)(['Someone'])).fighters).toHaveLength(1)
  })
})
