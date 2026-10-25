import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildStaticEvent, readBacktestForPublishing, STATIC_ODDS_REASON } from './snapshot.ts'

const REAL_EVENT = resolve(import.meta.dirname, '../fixtures/events/ufc-vegas-123.json')
const root = mkdtempSync(join(tmpdir(), 'octaiq-snap-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
mkdirSync(join(root, 'data/events'), { recursive: true })
cpSync(REAL_EVENT, join(root, 'data/events/ufc-vegas-123.json'))

describe('static snapshot', () => {
  it('contains the whole card but no odds and no licensed stats', async () => {
    const e = await buildStaticEvent(root, 'ufc-vegas-123')
    expect(e.static).toBe(true)
    expect(e.fights).toHaveLength(12)
    expect(e.odds).toEqual({ status: 'unavailable', reason: STATIC_ODDS_REASON })
    expect(e.fights.every((f) => f.books.length === 0 && f.history.length === 0)).toBe(true)
    expect(e.stats.status).toBe('none')
    expect(e.stats.missing).toHaveLength(24)
  })

  it('keeps the source notes and discrepancies so the public page is not more confident than the data', async () => {
    const e = await buildStaticEvent(root, 'ufc-vegas-123')
    expect(e.snapshot.verification?.status).toBe('official')
    expect(e.snapshot.verification?.note).toContain('not by a person')
    expect(e.snapshot.unlisted.join(' ')).toContain('Bekoev')
    expect(e.fights.some((f) => (f.bout?.notes.length ?? 0) > 0)).toBe(true)
  })

  it('reports the results model as unavailable, with a reason, when no backtest exists', async () => {
    const e = await buildStaticEvent(root, 'ufc-vegas-123')
    expect(e.resultsModel.status).toBe('unavailable')
    expect(e.resultsModel.reason).toContain('npm run backtest')
  })

  it('serialises without any local file paths or key-like strings', async () => {
    const text = JSON.stringify(await buildStaticEvent(root, 'ufc-vegas-123'))
    expect(text).not.toMatch(/\/Users\/|\/home\/|C:\\\\Users/)
    expect(text).not.toMatch(/apiKey|api_key|Bearer /i)
  })
})

describe('publishing the backtest report', () => {
  it('returns null when there is no report', () => {
    expect(readBacktestForPublishing(root)).toBeNull()
  })

  it('refuses a report that contains a local path', () => {
    mkdirSync(join(root, 'data/reports'), { recursive: true })
    writeFileSync(join(root, 'data/reports/backtest-latest.json'), JSON.stringify({ out: '/Users/someone/project/x.json' }))
    expect(() => readBacktestForPublishing(root)).toThrow(/local file path/)
  })

  it('returns a clean report verbatim', () => {
    writeFileSync(join(root, 'data/reports/backtest-latest.json'), '{"report":{}}')
    expect(readBacktestForPublishing(root)).toBe('{"report":{}}')
  })
})
