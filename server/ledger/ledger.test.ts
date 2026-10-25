import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { EventPayload, ResultsModel } from '../../src/engine/eventTypes.ts'
import type { Fight } from '../../src/engine/types.ts'
import type { Bout } from '../backtest/dataset.ts'
import { sameIgnoringTimestamps, writeIfChanged } from '../lib/stableWrite.ts'
import { gradeLedger, scoredEntry, summarizeLedgers } from './grade.ts'
import { CHANGE_THRESHOLD, entryFromPayload, readAllLedgers, readLedger, recordLedgers, shouldRecord, type Ledger, type LedgerEntry } from './ledger.ts'

const DAY = 86_400_000
const LOCK = '2026-10-31T21:00:00Z'
const MAIN = '2026-11-01T00:00:00Z'
const roots: string[] = []
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))
const tmpRoot = (): string => {
  const r = mkdtempSync(join(tmpdir(), 'octaiq-ledger-'))
  roots.push(r)
  return r
}

const fight = (id: string, a: string, b: string): Fight => ({
  id, weightClass: 'Lightweight', rounds: 3, mainEvent: false, a: { name: a } as Fight['a'], b: { name: b } as Fight['b'], books: [], history: [],
})
const model = (probs: Record<string, number>, version = 'v1'): ResultsModel => ({
  status: 'available', version, trainedThrough: '2026-10-17',
  bouts: Object.fromEntries(Object.entries(probs).map(([id, p]) => [id, { probA: p, probB: 1 - p, priorA: 5, priorB: 5, eloDiff: 0, distance: 0.5 }])),
})
const payload = (probs: Record<string, number>, over: Partial<EventPayload> = {}, version = 'v1'): EventPayload => ({
  event: { id: 'e1', title: 'Event One', venue: 'v', city: 'c', prelimsStart: LOCK, mainCardStart: MAIN },
  snapshot: { version: 2, capturedAt: 'x', source: 's', unlisted: [] },
  fights: Object.keys(probs).map((id, i) => fight(id, `A${i}`, `B${i}`)),
  changes: [], odds: { status: 'unavailable' }, stats: { status: 'none', missing: [], warnings: [] },
  resultsModel: model(probs, version), generatedAt: 'now', ...over,
})

describe('entryFromPayload', () => {
  it('records each bout with rounded probabilities and the model version', () => {
    const e = entryFromPayload(payload({ x1: 0.123456 }), new Date('2026-10-25T00:00:00Z'))!
    expect(e.model).toBe('v1')
    expect(e.cardVersion).toBe(2)
    expect(e.dataThrough).toBe('2026-10-17')
    expect(e.bouts[0]).toMatchObject({ id: 'x1', a: 'A0', b: 'B0', probA: 0.1235, distance: 0.5 })
  })

  it('records nothing when the model has no output', () => {
    const p = payload({ x1: 0.5 }, { resultsModel: { status: 'unavailable', reason: 'no', version: 'v', bouts: {} } })
    expect(entryFromPayload(p, new Date())).toBeNull()
  })
})

describe('shouldRecord', () => {
  const entry = (probs: Record<string, number>, at = '2026-10-25T00:00:00Z', version = 'v1'): LedgerEntry =>
    entryFromPayload(payload(probs, {}, version), new Date(at))!
  const ledgerOf = (...entries: LedgerEntry[]): Ledger => ({ eventId: 'e1', title: 't', lockedAt: LOCK, mainCardStart: MAIN, entries })

  it('records the first entry and ignores a repeat that changes nothing', () => {
    const a = entry({ x: 0.6 })
    expect(shouldRecord(null, a, LOCK).record).toBe(true)
    expect(shouldRecord(ledgerOf(a), entry({ x: 0.6 }, '2026-10-26T00:00:00Z'), LOCK)).toEqual({ record: false, reason: 'Nothing changed.' })
  })

  it('records when a probability moves by at least the threshold, but not by less', () => {
    const a = entry({ x: 0.6 })
    expect(shouldRecord(ledgerOf(a), entry({ x: 0.6 + CHANGE_THRESHOLD / 2 }), LOCK).record).toBe(false)
    expect(shouldRecord(ledgerOf(a), entry({ x: 0.6 + CHANGE_THRESHOLD * 2 }), LOCK).record).toBe(true)
  })

  it('records when the card or the model version changes', () => {
    const a = entry({ x: 0.6 })
    expect(shouldRecord(ledgerOf(a), entry({ x: 0.6, y: 0.5 }), LOCK).reason).toBe('The card changed.')
    expect(shouldRecord(ledgerOf(a), entry({ x: 0.6 }, '2026-10-26T00:00:00Z', 'v2'), LOCK).reason).toBe('The model version changed.')
  })

  it('is locked from the moment the event starts, even for a changed card', () => {
    const late = entry({ x: 0.9 }, '2026-10-31T21:00:00Z')
    expect(shouldRecord(ledgerOf(entry({ x: 0.6 })), late, LOCK)).toEqual({ record: false, reason: 'The event has started, so the ledger is locked.' })
    expect(shouldRecord(null, entry({ x: 0.6 }, '2026-11-02T00:00:00Z'), LOCK).record).toBe(false)
  })
})

describe('recordLedgers (append-only)', () => {
  it('appends without touching earlier entries and respects the lock', () => {
    const root = tmpRoot()
    const t0 = new Date('2026-10-25T00:00:00Z')
    expect(recordLedgers(root, [payload({ x: 0.6 })], t0)[0].recorded).toBe(true)
    const first = readFileSync(join(root, 'data/ledger/e1.json'), 'utf8')

    expect(recordLedgers(root, [payload({ x: 0.6 })], new Date(t0.getTime() + DAY))[0].recorded).toBe(false)
    expect(readFileSync(join(root, 'data/ledger/e1.json'), 'utf8')).toBe(first)

    expect(recordLedgers(root, [payload({ x: 0.7 })], new Date(t0.getTime() + 2 * DAY))[0].recorded).toBe(true)
    const ledger = readLedger(root, 'e1')!
    expect(ledger.entries).toHaveLength(2)
    expect(JSON.stringify(ledger.entries[0])).toBe(JSON.stringify(JSON.parse(first).entries[0]))
    expect(ledger.entries[1].bouts[0].probA).toBe(0.7)

    const afterStart = recordLedgers(root, [payload({ x: 0.2 })], new Date('2026-11-01T01:00:00Z'))
    expect(afterStart[0]).toMatchObject({ recorded: false })
    expect(readLedger(root, 'e1')!.entries).toHaveLength(2)
  })

  it('reads every ledger in the folder and tolerates none', () => {
    const root = tmpRoot()
    expect(readAllLedgers(root)).toEqual([])
    recordLedgers(root, [payload({ x: 0.6 })], new Date('2026-10-25T00:00:00Z'))
    expect(readAllLedgers(root)).toHaveLength(1)
  })

  it('reports why nothing was recorded when the model has no output', () => {
    const p = payload({ x: 0.5 }, { resultsModel: { status: 'unavailable', reason: 'No backtest report.', version: 'v', bouts: {} } })
    expect(recordLedgers(tmpRoot(), [p], new Date())[0]).toEqual({ eventId: 'e1', recorded: false, reason: 'No backtest report.' })
  })
})

describe('grading', () => {
  const dataBout = (nameA: string, nameB: string, result: Bout['result'], dateMs: number, method: Bout['method'] = 'dec'): Bout => ({
    id: `${nameA}-${nameB}`, event: 'E', date: dateMs, a: nameA.toLowerCase(), b: nameB.toLowerCase(), nameA, nameB, result, method, weightClass: 'x',
  })
  const evDay = Date.parse('2026-10-31T00:00:00Z')
  const ledger = (extra: LedgerEntry[] = []): Ledger => ({
    eventId: 'e1', title: 'Event One', lockedAt: LOCK, mainCardStart: MAIN,
    entries: [
      { recordedAt: '2026-10-20T00:00:00Z', model: 'v1', cardVersion: 1, bouts: [{ id: 'x', a: 'Amy Ames', b: 'Bo Burns', probA: 0.3 }, { id: 'y', a: 'Cal Cole', b: 'Dee Dunn', probA: 0.8 }] },
      { recordedAt: '2026-10-28T00:00:00Z', model: 'v1', cardVersion: 1, bouts: [{ id: 'x', a: 'Amy Ames', b: 'Bo Burns', probA: 0.4 }, { id: 'y', a: 'Cal Cole', b: 'Dee Dunn', probA: 0.8 }] },
      ...extra,
    ],
  })

  it('scores the last entry made before the lock and ignores anything later', () => {
    const late: LedgerEntry = { recordedAt: '2026-11-01T02:00:00Z', model: 'v1', cardVersion: 1, bouts: [{ id: 'x', a: 'Amy Ames', b: 'Bo Burns', probA: 0.99 }] }
    expect(scoredEntry(ledger([late]))?.recordedAt).toBe('2026-10-28T00:00:00Z')
    expect(scoredEntry({ ...ledger(), entries: [late] })).toBeNull()
  })

  it('matches results by names and date, in either corner order, and grades each pick', () => {
    const data = [dataBout('Bo Burns', 'Amy Ames', 'a', evDay), dataBout('Cal Cole', 'Dee Dunn', 'b', evDay)]
    const g = gradeLedger(ledger(), data, new Date('2026-11-02T00:00:00Z'))
    expect(g.status).toBe('graded')
    expect(g.graded).toBe(2)
    // Amy was given 40%, so the model leaned to Bo, who won: correct, and the loss is for the 60% it gave Bo.
    expect(g.bouts[0]).toMatchObject({ result: 'b', correct: true })
    expect(g.bouts[0].logLoss).toBeCloseTo(-Math.log(0.6), 6)
    // Cal was given 80% but Dee won.
    expect(g.bouts[1]).toMatchObject({ result: 'b', correct: false })
    expect(g.bouts[1].logLoss).toBeCloseTo(-Math.log(0.2), 6)
    expect(g.correct).toBe(1)
    expect(g.scoredEntryAt).toBe('2026-10-28T00:00:00Z')
  })

  it('credits a correct favourite and handles a win by the A corner after orientation flips', () => {
    const data = [dataBout('Cal Cole', 'Dee Dunn', 'a', evDay), dataBout('Bo Burns', 'Amy Ames', 'a', evDay)]
    const g = gradeLedger(ledger(), data, new Date('2026-11-02T00:00:00Z'))
    expect(g.bouts.find((b) => b.id === 'y')).toMatchObject({ result: 'a', correct: true })
    expect(g.bouts.find((b) => b.id === 'x')).toMatchObject({ result: 'b', correct: true })
  })

  it('does not grade draws or no-contests, and reports waiting states honestly', () => {
    const data = [dataBout('Amy Ames', 'Bo Burns', 'draw', evDay), dataBout('Cal Cole', 'Dee Dunn', 'nc', evDay)]
    const g = gradeLedger(ledger(), data, new Date('2026-11-02T00:00:00Z'))
    expect(g.graded).toBe(0)
    expect(g.status).toBe('awaiting-results')
    expect(g.bouts[0].result).toBe('draw')
    expect(gradeLedger(ledger(), [], new Date('2026-10-26T00:00:00Z')).status).toBe('upcoming')
  })

  it('ignores similar fights from other dates and refuses ambiguous matches', () => {
    const other = dataBout('Amy Ames', 'Bo Burns', 'a', evDay - 60 * DAY)
    expect(gradeLedger(ledger(), [other], new Date('2026-11-02T00:00:00Z')).graded).toBe(0)
    const twice = [dataBout('Amy Ames', 'Bo Burns', 'a', evDay), dataBout('Bo Burns', 'Amy Ames', 'b', evDay)]
    expect(gradeLedger(ledger(), twice, new Date('2026-11-02T00:00:00Z')).bouts[0].result).toBeUndefined()
  })

  it('summarises across events', () => {
    const data = [dataBout('Cal Cole', 'Dee Dunn', 'a', evDay), dataBout('Amy Ames', 'Bo Burns', 'a', evDay)]
    const g = gradeLedger(ledger(), data, new Date('2026-11-02T00:00:00Z'))
    const s = summarizeLedgers([g, { ...g, eventId: 'e2' }])
    expect(s.graded).toBe(4)
    expect(s.correct).toBe(2)
    expect(s.logLoss).toBeCloseTo(g.logLoss as number, 8)
    expect(summarizeLedgers([])).toMatchObject({ graded: 0, logLoss: null })
  })
})

describe('stable writes', () => {
  it('treats files that differ only in timestamps as the same', () => {
    const a = JSON.stringify({ generatedAt: '1', x: [{ retrievedAt: 'a', v: 1 }] })
    const b = JSON.stringify({ generatedAt: '2', x: [{ retrievedAt: 'b', v: 1 }] })
    expect(sameIgnoringTimestamps(a, b)).toBe(true)
    expect(sameIgnoringTimestamps(a, JSON.stringify({ generatedAt: '1', x: [{ v: 2 }] }))).toBe(false)
    expect(sameIgnoringTimestamps('not json', 'not json')).toBe(true)
  })

  it('writes new or changed content and skips timestamp-only changes', () => {
    const dir = tmpRoot()
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'f.json')
    expect(writeIfChanged(path, JSON.stringify({ generatedAt: '1', v: 1 }))).toBe(true)
    expect(writeIfChanged(path, JSON.stringify({ generatedAt: '2', v: 1 }))).toBe(false)
    expect(JSON.parse(readFileSync(path, 'utf8')).generatedAt).toBe('1')
    expect(writeIfChanged(path, JSON.stringify({ generatedAt: '3', v: 2 }))).toBe(true)
    writeFileSync(path, 'x')
  })
})

describe('forecast history', () => {
  const entry = (over: Partial<import('./ledger.ts').LedgerEntry> = {}): import('./ledger.ts').LedgerEntry => ({
    recordedAt: '2026-10-25T10:00:00Z', model: 'm1', dataThrough: '2026-10-17', cardVersion: 1,
    bouts: [{ id: 'e-1', a: 'A', b: 'B', probA: 0.6 }], ...over,
  })

  it('explains each saved version in words', async () => {
    const { describeChange } = await import('./ledger.ts')
    expect(describeChange(undefined, entry())).toBe('First forecast for this card')
    expect(describeChange(entry(), entry({ bouts: [{ id: 'e-1', a: 'A', b: 'C', probA: 0.6 }] }))).toBe('The card changed')
    expect(describeChange(entry(), entry({ model: 'm2' }))).toContain('model was updated')
    expect(describeChange(entry(), entry({ dataThrough: '2026-10-24' }))).toContain('through 2026-10-24')
    expect(describeChange(entry(), entry({ bouts: [{ id: 'e-1', a: 'A', b: 'B', probA: 0.61 }] }))).toBe('A small shift in the probabilities')
  })

  it('keeps only the win probabilities per version', async () => {
    const { historyOf } = await import('./ledger.ts')
    const h = historyOf({ eventId: 'e', title: 'T', lockedAt: 'x', mainCardStart: 'y', entries: [entry(), entry({ model: 'm2' })] })
    expect(h).toHaveLength(2)
    expect(h[1].probs).toEqual({ 'e-1': 0.6 })
    expect(h[1].reason).toContain('model was updated')
  })
})
