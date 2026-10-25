import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { EventSummary, Snapshot, SnapshotBout } from '../../src/engine/eventTypes.ts'
import { pickDefaultEvent } from '../../src/engine/pickEvent.ts'
import { diffSnapshots, latestSnapshot, parseEventFile, summarizeEvent } from './event.ts'
import { buildEventIndex, createEventCatalog, listEventFiles } from './eventService.ts'
import { createMemoryHistory } from './history.ts'
import { buildStaticEvents } from './snapshot.ts'

const REAL_DIR = resolve(import.meta.dirname, '../fixtures/events')
const tmp: string[] = []
afterAll(() => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })))
const copyEvents = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'octaiq-cat-'))
  tmp.push(d)
  for (const f of readdirSync(REAL_DIR)) cpSync(join(REAL_DIR, f), join(d, f))
  return d
}
const NOW = Date.parse('2026-10-25T12:00:00Z')
const deps = (dir: string) => ({
  dir, cards: { getOdds: async () => { throw new Error('no odds') } }, loadFighters: async () => ({ fighters: [], warnings: [] }),
  history: createMemoryHistory(), now: () => NOW,
})

describe('shipped event files', () => {
  it('all parse, have unique ids, and are verified against the official page', () => {
    const { files, errors } = listEventFiles(REAL_DIR)
    expect(errors).toEqual([])
    expect(files.length).toBeGreaterThanOrEqual(4)
    expect(new Set(files.map((f) => f.id)).size).toBe(files.length)
    const index = buildEventIndex(REAL_DIR, NOW)
    expect(index.events.every((e) => e.verification === 'official')).toBe(true)
    expect(index.events.every((e) => e.bouts >= 9)).toBe(true)
  })

  it('opens the next event first', () => {
    expect(buildEventIndex(REAL_DIR, NOW).defaultId).toBe('ufc-vegas-123')
  })

  it('records ranks and the card-placement change between versions', () => {
    const file = parseEventFile(JSON.parse(readFileSync(join(REAL_DIR, 'ufc-vegas-123.json'), 'utf8')))
    const [v1, v2] = [...file.snapshots].sort((a, b) => a.version - b.version)
    expect(latestSnapshot(file).version).toBe(2)
    expect(latestSnapshot(file).bouts[0].a.rank).toBe(12)
    expect(diffSnapshots(v1, v2).map((c) => c.kind)).toEqual(['placement-changed'])
    expect(diffSnapshots(v1, v2)[0].description).toContain('Marshall')
  })
})

describe('pickDefaultEvent', () => {
  const ev = (id: string, main: string): EventSummary => ({ id, title: id, venue: 'v', city: 'c', mainCardStart: main, bouts: 10, verification: 'official' })
  const list = [ev('late', '2026-12-01T00:00:00Z'), ev('soon', '2026-11-01T00:00:00Z'), ev('past', '2026-09-01T00:00:00Z')]

  it('picks the soonest unfinished event regardless of file order', () => {
    expect(pickDefaultEvent(list, Date.parse('2026-10-25T00:00:00Z'))).toBe('soon')
  })
  it('keeps an event open for 8 hours after its main card, then moves on', () => {
    expect(pickDefaultEvent(list, Date.parse('2026-11-01T06:00:00Z'))).toBe('soon')
    expect(pickDefaultEvent(list, Date.parse('2026-11-01T09:00:00Z'))).toBe('late')
  })
  it('falls back to the latest event when everything is over, and rejects an empty list', () => {
    expect(pickDefaultEvent(list, Date.parse('2027-06-01T00:00:00Z'))).toBe('late')
    expect(() => pickDefaultEvent([], NOW)).toThrow()
  })
})

describe('event catalog', () => {
  it('serves any event by id and the default when none is given', async () => {
    const cat = createEventCatalog(deps(copyEvents()))
    const def = await cat.getEvent()
    expect(def.event.id).toBe('ufc-vegas-123')
    expect(def.fights).toHaveLength(12)
    const other = await cat.getEvent('ufc-334-gane-hokit')
    expect(other.fights).toHaveLength(12)
    expect(other.fights[0].rounds).toBe(5)
    await expect(cat.getEvent('nope')).rejects.toThrow(/Unknown event/)
  })

  it('skips a broken file instead of taking the whole catalog down, and reports it', () => {
    const dir = copyEvents()
    writeFileSync(join(dir, 'broken.json'), '{"event":{}}')
    const { files, errors } = listEventFiles(dir)
    expect(files.length).toBe(4)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('broken.json')
    expect(buildEventIndex(dir, NOW).events).toHaveLength(4)
  })

  it('fails clearly when the folder has no valid events', () => {
    const dir = mkdtempSync(join(tmpdir(), 'octaiq-empty-'))
    tmp.push(dir)
    mkdirSync(dir, { recursive: true })
    expect(() => buildEventIndex(dir, NOW)).toThrow(/No valid event files/)
  })

  it('builds the public snapshot for every event and refuses invalid files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'octaiq-root-'))
    tmp.push(root)
    mkdirSync(join(root, 'data/events'), { recursive: true })
    for (const f of readdirSync(REAL_DIR)) cpSync(join(REAL_DIR, f), join(root, 'data/events', f))
    const { index, payloads } = await buildStaticEvents(root)
    expect(payloads).toHaveLength(index.events.length)
    expect(payloads.every((p) => p.static === true && p.odds.status === 'unavailable')).toBe(true)
    writeFileSync(join(root, 'data/events/bad.json'), '{}')
    await expect(buildStaticEvents(root)).rejects.toThrow(/Invalid event files/)
  })
})

describe('summaries', () => {
  it('reports unverified events as unverified', () => {
    const bout: SnapshotBout = { order: 1, card: 'main', weightClass: 'x', rounds: 3, a: { name: 'A', record: '—' }, b: { name: 'B', record: '—' }, notes: [] }
    const snap: Snapshot = { version: 1, capturedAt: 'x', source: 's', bouts: [bout], unlisted: [] }
    const file = { event: { id: 'e', title: 't', venue: 'v', city: 'c', prelimsStart: 'p', mainCardStart: 'm' }, snapshots: [snap] }
    expect(summarizeEvent(file).verification).toBe('unverified')
  })
})
