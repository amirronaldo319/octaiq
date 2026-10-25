import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { EventFile, Snapshot, SnapshotBout } from '../../src/engine/eventTypes.ts'
import { parseFighterCsv } from './csv.ts'
import { allChanges, buildEventFights, diffSnapshots, latestSnapshot, parseEventFile } from './event.ts'
import { createEventService } from './eventService.ts'
import { createMemoryHistory } from './history.ts'
import type { OddsEvent } from './oddsApi.ts'

const NOW = new Date('2026-10-25T12:00:00Z')
const EVENT_PATH = resolve(import.meta.dirname, '../../data/events/ufc-vegas-123.json')
const realFile = (): unknown => JSON.parse(readFileSync(EVENT_PATH, 'utf8'))

const bout = (order: number, a: string, b: string, card: 'main' | 'prelim' = 'main'): SnapshotBout => ({
  order, card, weightClass: 'Lightweight', rounds: 3, a: { name: a, record: '1-0-0' }, b: { name: b, record: '2-0-0' }, notes: [],
})
const snap = (version: number, bouts: SnapshotBout[]): Snapshot => ({
  version, capturedAt: `2026-10-0${version}T00:00:00Z`, source: 'test', bouts, unlisted: [],
})
const file = (snapshots: Snapshot[]): EventFile => ({
  event: { id: 'ev', title: 'T', venue: 'V', city: 'C', prelimsStart: '2026-10-31T21:00:00Z', mainCardStart: '2026-11-01T00:00:00Z' },
  snapshots,
})

const CSV = [
  'name,slpm,str_acc,str_def,td_avg,td_def',
  'Renato Moicano,3.4,0.46,0.55,2.0,0.6',
  'Tom Nolan,4.1,0.5,0.58,0.8,0.7',
].join('\n')

const oddsEvent = (home: string, away: string): OddsEvent => ({
  id: 'odds1', commence_time: '2026-11-01T00:00:00Z', home_team: home, away_team: away,
  bookmakers: [{ key: 'a', title: 'Alpha', markets: [{ key: 'h2h', outcomes: [{ name: home, price: -200 }, { name: away, price: 170 }] }] }],
})

describe('event file parsing', () => {
  it('accepts the shipped event file', () => {
    const parsed = parseEventFile(realFile())
    expect(parsed.event.id).toBe('ufc-vegas-123')
    expect(latestSnapshot(parsed).bouts).toHaveLength(12)
  })

  it('keeps all 12 bouts unique and ordered', () => {
    const bouts = latestSnapshot(parseEventFile(realFile())).bouts
    expect(new Set(bouts.map((b) => b.order)).size).toBe(12)
    expect(bouts.filter((b) => b.rounds === 5)).toHaveLength(1)
    expect(bouts[0].a.name).toBe('Renato Moicano')
  })

  it('rejects malformed files with a clear message', () => {
    expect(() => parseEventFile({})).toThrow(/expected/)
    const bad = file([snap(1, [bout(1, 'A', 'B'), bout(1, 'C', 'D')])])
    expect(() => parseEventFile(bad)).toThrow(/duplicate bout order/)
    const badRounds = JSON.parse(JSON.stringify(file([snap(1, [bout(1, 'A', 'B')])])))
    badRounds.snapshots[0].bouts[0].rounds = 4
    expect(() => parseEventFile(badRounds)).toThrow(/rounds/)
  })
})

describe('card diffs', () => {
  it('reports added, removed and opponent changes', () => {
    const v1 = snap(1, [bout(1, 'A', 'B'), bout(2, 'C', 'D'), bout(3, 'E', 'F')])
    const v2 = snap(2, [bout(1, 'A', 'X'), bout(2, 'D', 'C'), bout(4, 'G', 'H')])
    const changes = diffSnapshots(v1, v2)
    expect(changes.map((c) => c.kind).sort()).toEqual(['added', 'opponent-changed', 'removed'])
    expect(changes.find((c) => c.kind === 'opponent-changed')?.description).toContain('A vs. B became A vs. X')
  })

  it('treats a swapped corner as the same bout', () => {
    expect(diffSnapshots(snap(1, [bout(1, 'A', 'B')]), snap(2, [bout(1, 'B', 'A')]))).toEqual([])
  })

  it('chains changes across versions', () => {
    const f = file([snap(1, [bout(1, 'A', 'B')]), snap(2, [bout(1, 'A', 'C')]), snap(3, [bout(1, 'A', 'C'), bout(2, 'D', 'E')])])
    expect(allChanges(f).map((c) => [c.fromVersion, c.toVersion])).toEqual([[1, 2], [2, 3]])
  })
})

describe('buildEventFights', () => {
  const f = file([snap(1, [bout(1, 'Renato Moicano', 'Tom Nolan'), bout(2, 'Unknown One', 'Unknown Two', 'prelim')])])
  const { fighters } = parseFighterCsv(CSV, NOW)

  it('joins stats and orients odds even when the feed lists the fighters in reverse', () => {
    const fights = buildEventFights({ file: f, snapshot: f.snapshots[0], fighters, odds: [oddsEvent('Tom Nolan', 'Renato Moicano')], history: createMemoryHistory() })
    expect(fights[0].statsMissing).toBe(false)
    expect(fights[0].books).toEqual([{ book: 'Alpha', a: 170, b: -200 }])
    expect(fights[0].bout).toMatchObject({ order: 1, card: 'main', statsA: true, statsB: true, hasOdds: true })
    expect(fights[0].mainEvent).toBe(true)
  })

  it('never invents odds or stats for unmatched bouts', () => {
    const fights = buildEventFights({ file: f, snapshot: f.snapshots[0], fighters, odds: [oddsEvent('Tom Nolan', 'Renato Moicano')], history: createMemoryHistory() })
    expect(fights[1].books).toEqual([])
    expect(fights[1].history).toEqual([])
    expect(fights[1].statsMissing).toBe(true)
    expect(fights[1].a.record).toBe('1-0-0')
    expect(fights[1].bout).toMatchObject({ statsA: false, hasOdds: false })
  })

  it('handles an unavailable odds provider', () => {
    const fights = buildEventFights({ file: f, snapshot: f.snapshots[0], fighters, odds: null, history: createMemoryHistory() })
    expect(fights.every((x) => x.books.length === 0)).toBe(true)
  })

  it('uses the card start time for placement', () => {
    const fights = buildEventFights({ file: f, snapshot: f.snapshots[0], fighters, odds: null, history: createMemoryHistory() })
    expect(fights[0].commenceTime).toBe(f.event.mainCardStart)
    expect(fights[1].commenceTime).toBe(f.event.prelimsStart)
  })
})

describe('event service', () => {
  const base = { eventPath: EVENT_PATH, history: createMemoryHistory(), now: () => NOW.getTime() }

  it('serves all 12 bouts with odds unavailable and no stats', async () => {
    const svc = createEventService({
      ...base,
      cards: { getOdds: async () => { throw new Error('ODDS_API_KEY is not set.') } },
      loadFighters: async () => ({ fighters: [], warnings: [] }),
    })
    const payload = await svc.getEvent()
    expect(payload.fights).toHaveLength(12)
    expect(payload.odds).toEqual({ status: 'unavailable', reason: 'ODDS_API_KEY is not set.' })
    expect(payload.stats.status).toBe('none')
    expect(payload.stats.missing).toHaveLength(24)
    expect(payload.snapshot.unlisted[0]).toContain('Bekoev')
  })

  it('reports partial stats coverage and live odds', async () => {
    const svc = createEventService({
      ...base,
      cards: { getOdds: async () => ({ events: [oddsEvent('Renato Moicano', 'Tom Nolan')], fetchedAt: NOW.toISOString(), stale: false, quotaRemaining: '400' }) },
      loadFighters: async () => parseFighterCsv(CSV, NOW),
    })
    const payload = await svc.getEvent()
    expect(payload.stats.status).toBe('partial')
    expect(payload.stats.missing).toHaveLength(22)
    expect(payload.odds).toMatchObject({ status: 'live', quotaRemaining: '400' })
    expect(payload.fights[0].books).toHaveLength(1)
  })

  it('passes results-model output through and survives its failure', async () => {
    const cards = { getOdds: async () => { throw new Error('no odds') } }
    const loadFighters = async () => ({ fighters: [], warnings: [] })
    const ok = await createEventService({
      ...base, cards, loadFighters,
      resultsModel: (inputs) => ({ status: 'available', version: 'v', bouts: Object.fromEntries(inputs.map((i) => [i.id, { probA: 0.6, probB: 0.4, priorA: 3, priorB: 2, eloDiff: 10 }])) }),
    }).getEvent()
    expect(Object.keys(ok.resultsModel.bouts)).toHaveLength(12)
    const broken = await createEventService({ ...base, cards, loadFighters, resultsModel: () => { throw new Error('boom') } }).getEvent()
    expect(broken.resultsModel.status).toBe('unavailable')
    expect(broken.fights).toHaveLength(12)
  })
})
