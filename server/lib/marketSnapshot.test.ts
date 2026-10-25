import { cpSync, mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildMarketSnapshot, isMarketFile } from './marketSnapshot.ts'
import type { OddsEvent } from './oddsApi.ts'

const REAL = resolve(import.meta.dirname, '../fixtures/events')
const dirs: string[] = []
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))
const copy = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'octaiq-mkt-'))
  dirs.push(d)
  for (const f of readdirSync(REAL)) cpSync(join(REAL, f), join(d, f))
  return d
}
const NOW = new Date('2026-10-26T00:00:00Z')

const ev = (home: string, away: string, prices: [number, number][]): OddsEvent => ({
  id: `o-${home}`, commence_time: '2026-11-01T00:00:00Z', home_team: home, away_team: away,
  bookmakers: prices.map(([h, a], i) => ({ key: `b${i}`, title: `Secret Book ${i}`, markets: [{ key: 'h2h', outcomes: [{ name: home, price: h }, { name: away, price: a }] }] })),
})

describe('buildMarketSnapshot', () => {
  it('averages the margin-removed probability across books and records the spread', () => {
    const m = buildMarketSnapshot(copy(), [ev('Renato Moicano', 'Tom Nolan', [[-110, -110], [120, -140]])], NOW)
    const b = m.events['ufc-vegas-123']['ufc-vegas-123-1']
    expect(b.books).toBe(2)
    expect(b.pA).toBeGreaterThan(0.4)
    expect(b.pA).toBeLessThan(0.6)
    expect(b.pLo).toBeLessThanOrEqual(b.pA)
    expect(b.pHi).toBeGreaterThanOrEqual(b.pA)
    expect(b.pLo).toBeLessThan(b.pHi)
  })

  it('orients to the card even when the feed lists the fighters the other way round', () => {
    const direct = buildMarketSnapshot(copy(), [ev('Renato Moicano', 'Tom Nolan', [[150, -170]])], NOW).events['ufc-vegas-123']['ufc-vegas-123-1'].pA
    const flipped = buildMarketSnapshot(copy(), [ev('Tom Nolan', 'Renato Moicano', [[-170, 150]])], NOW).events['ufc-vegas-123']['ufc-vegas-123-1'].pA
    expect(flipped).toBeCloseTo(direct, 6)
    expect(direct).toBeLessThan(0.5)
  })

  it('never publishes bookmaker names or raw prices', () => {
    const m = buildMarketSnapshot(copy(), [ev('Renato Moicano', 'Tom Nolan', [[-147, 121], [-139, 118]])], NOW)
    expect(JSON.stringify(m)).not.toContain('Secret Book')
    // Every number in the file is a probability or a small count: no American price (|n| >= 100) can be in there.
    const numbers: number[] = []
    const walk = (v: unknown): void => {
      if (typeof v === 'number') numbers.push(v)
      else if (v && typeof v === 'object') Object.values(v).forEach(walk)
    }
    walk(m)
    expect(numbers.length).toBeGreaterThan(0)
    expect(numbers.every((n) => Math.abs(n) < 100)).toBe(true)
    expect(JSON.stringify(m)).not.toContain('"price"')
  })

  it('leaves out bouts and events with no prices', () => {
    expect(buildMarketSnapshot(copy(), [], NOW).events).toEqual({})
    const m = buildMarketSnapshot(copy(), [ev('Renato Moicano', 'Tom Nolan', [[-110, -110]])], NOW)
    expect(Object.keys(m.events)).toEqual(['ufc-vegas-123'])
    expect(Object.keys(m.events['ufc-vegas-123'])).toEqual(['ufc-vegas-123-1'])
  })

  it('prices the right event when fighters appear on more than one card', () => {
    const m = buildMarketSnapshot(copy(), [ev('Ciryl Gane', 'Josh Hokit', [[-300, 250]])], NOW)
    expect(Object.keys(m.events)).toEqual(['ufc-334-gane-hokit'])
    expect(m.events['ufc-334-gane-hokit']['ufc-334-gane-hokit-1'].pA).toBeGreaterThan(0.65)
  })

  it('carries attribution and a timestamp', () => {
    const m = buildMarketSnapshot(copy(), [], NOW)
    expect(m.generatedAt).toBe(NOW.toISOString())
    expect(m.attribution).toContain('The Odds API')
    expect(isMarketFile(m)).toBe(true)
    expect(isMarketFile(null)).toBe(false)
    expect(isMarketFile({})).toBe(false)
  })
})
