import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRng } from '../../src/engine/rng.ts'
import type { Bout } from './dataset.ts'
import { compareWithMarket } from './market.ts'
import { fetchOddsDataset, matchOdds, ODDS_SOURCE, parseOddsArff, splitArffLine, type MarketLine, type MatchStats, type OddsRecord } from './oddsData.ts'
import type { Prediction } from './walkForward.ts'

const ARFF = `% comment
@RELATION x
@ATTRIBUTE R_fighter STRING
@ATTRIBUTE B_fighter STRING
@ATTRIBUTE R_odds REAL
@ATTRIBUTE B_odds REAL
@ATTRIBUTE date STRING
@ATTRIBUTE location STRING
@ATTRIBUTE country STRING
@ATTRIBUTE Winner STRING
@ATTRIBUTE title_bout {True, False}
@ATTRIBUTE weight_class STRING
@ATTRIBUTE gender STRING

@DATA
'Kevin Lee','Charles Oliveira',-145.0,135.0,3/14/2020,'Brasilia, Brazil',Brazil,Blue,False,Lightweight,MALE
'Amanda Ribas','Randa Markos',-345.0,315.0,3/14/2020,'Brasilia, Brazil',Brazil,Red,False,'Women\\'s Strawweight',FEMALE
'No Odds','Fighter',?,?,?,?,?,?,False,Lightweight,MALE
'Bad','Price',-50.0,40.0,3/14/2020,'x',x,Red,False,Lightweight,MALE
'Even','Draw',-110.0,-110.0,1/2/2019,'x',x,Draw,False,Lightweight,MALE
`

const DAY = 86_400_000
const d = (y: number, m: number, day: number): number => Date.UTC(y, m - 1, day)
const bout = (id: string, date: number, nameA: string, nameB: string, result: 'a' | 'b'): Bout => ({
  id, event: `E${date}`, date, a: nameA.toLowerCase(), b: nameB.toLowerCase(), nameA, nameB, result, method: 'dec', weightClass: 'x',
})

describe('ARFF parsing', () => {
  it('splits quoted fields with escaped apostrophes and commas', () => {
    expect(splitArffLine("'Women\\'s Strawweight',FEMALE,'Rio, Brazil'")).toEqual(["Women's Strawweight", 'FEMALE', 'Rio, Brazil'])
  })

  it('keeps only rows with a date, valid American odds on both sides, and a known winner', () => {
    const { records, stats } = parseOddsArff(ARFF)
    expect(stats).toMatchObject({ rows: 5, usable: 3 })
    expect(records.map((r) => r.red)).toEqual(['Kevin Lee', 'Amanda Ribas', 'Even'])
    expect(records[0]).toMatchObject({ redOdds: -145, blueOdds: 135, winner: 'Blue', date: d(2020, 3, 14) })
  })

  it('rejects files that are not ARFF or lack a needed column', () => {
    expect(() => parseOddsArff('a,b\n1,2')).toThrow(/@DATA/)
    expect(() => parseOddsArff('@ATTRIBUTE x STRING\n@DATA\n1')).toThrow(/missing/)
  })
})

describe('matching prices to results', () => {
  const rec = (red: string, blue: string, date: number, winner: 'Red' | 'Blue' | 'Draw', ro = -150, bo = 130): OddsRecord => ({ date, red, blue, redOdds: ro, blueOdds: bo, winner })

  it('orients and de-vigs prices to the A corner even when the corners are swapped', () => {
    const bouts = [bout('1', d(2019, 5, 1), 'Blue Guy', 'Red Guy', 'b')]
    const { byBout, stats } = matchOdds(bouts, [rec('Red Guy', 'Blue Guy', d(2019, 5, 1), 'Red')])
    const line = byBout.get('1') as MarketLine
    expect(stats.matched).toBe(1)
    expect(stats.winnerDisagreements).toBe(0)
    expect(line.oddsA).toBe(130)
    expect(line.oddsB).toBe(-150)
    expect(line.pA).toBeLessThan(0.5)
    expect(line.overround).toBeGreaterThan(1)
    // A won in the results, but the price said B was favoured: that is fine, it is just data.
    expect(line.pA).toBeCloseTo(1 / 2.3 / (1 / 2.3 + 0.6) , 2)
  })

  it('ignores word order and punctuation in names', () => {
    const bouts = [bout('1', d(2019, 5, 1), "Jon O'Brien", 'Park Jun-ho', 'a')]
    expect(matchOdds(bouts, [rec('Jun-ho Park', 'Jon OBrien', d(2019, 5, 1), 'Blue')]).stats.matched).toBe(1)
  })

  it('accepts a one-day date offset only when unambiguous and counts it', () => {
    const bouts = [bout('1', d(2019, 5, 1), 'A One', 'B Two', 'a')]
    const near = matchOdds(bouts, [rec('A One', 'B Two', d(2019, 5, 1) + DAY, 'Red')])
    expect(near.stats).toMatchObject({ matched: 1, matchedOffByOneDay: 1, matchedExactDate: 0 })
    const far = matchOdds(bouts, [rec('A One', 'B Two', d(2019, 5, 1) + 3 * DAY, 'Red')])
    expect(far.stats).toMatchObject({ matched: 0, unmatched: 1 })
  })

  it('skips ambiguous pairs, draws and duplicate price rows', () => {
    const twice = [bout('1', d(2019, 5, 1), 'A One', 'B Two', 'a'), bout('2', d(2019, 5, 1), 'B Two', 'A One', 'b')]
    expect(matchOdds(twice, [rec('A One', 'B Two', d(2019, 5, 1), 'Red')]).stats.ambiguous).toBe(1)
    const one = [bout('1', d(2019, 5, 1), 'A One', 'B Two', 'a')]
    const dup = matchOdds(one, [rec('A One', 'B Two', d(2019, 5, 1), 'Red'), rec('A One', 'B Two', d(2019, 5, 1), 'Red')])
    expect(dup.stats).toMatchObject({ matched: 1, ambiguous: 1 })
    expect(matchOdds(one, [rec('A One', 'B Two', d(2019, 5, 1), 'Draw')]).stats.drawsSkipped).toBe(1)
  })

  it('flags disagreements about who won', () => {
    const bouts = [bout('1', d(2019, 5, 1), 'A One', 'B Two', 'a')]
    expect(matchOdds(bouts, [rec('A One', 'B Two', d(2019, 5, 1), 'Blue')]).stats.winnerDisagreements).toBe(1)
  })
})

describe('verified download', () => {
  it('refuses a file whose MD5 does not match what OpenML publishes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'octaiq-odds-'))
    await expect(fetchOddsDataset(dir, async () => 'tampered')).rejects.toThrow(/MD5/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes the file and a manifest with attribution when the checksum matches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'octaiq-odds-'))
    const body = 'hello'
    const manifest = await fetchOddsDataset(dir, async () => body, createHash('md5').update(body).digest('hex'))
    expect(readFileSync(join(dir, ODDS_SOURCE.file), 'utf8')).toBe(body)
    expect(manifest.attribution).toContain('CC BY 4.0')
    expect(manifest.bytes).toBe(5)
    expect(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).license).toContain('CC BY 4.0')
    rmSync(dir, { recursive: true, force: true })
  })

  it('does not write anything when the checksum fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'octaiq-odds-'))
    await expect(fetchOddsDataset(dir, async () => 'hello', 'deadbeef')).rejects.toThrow()
    expect(() => readFileSync(join(dir, ODDS_SOURCE.file))).toThrow()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('market comparison', () => {
  const noMatch: MatchStats = { records: 0, matched: 0, matchedExactDate: 0, matchedOffByOneDay: 0, unmatched: 0, ambiguous: 0, winnerDisagreements: 0, drawsSkipped: 0 }

  /** Latent true probabilities; the market sees them (with noise), the model sees them with extra noise. */
  function world(opts: { n: number; marketNoise: number; modelNoise: number; seed: number }): { preds: Prediction[]; lines: Map<string, MarketLine> } {
    const rng = createRng(opts.seed)
    const logit = (p: number): number => Math.log(p / (1 - p))
    const sig = (z: number): number => 1 / (1 + Math.exp(-z))
    const noise = (): number => (rng() + rng() + rng() - 1.5) * 2
    const preds: Prediction[] = []
    const lines = new Map<string, MarketLine>()
    for (let i = 0; i < opts.n; i++) {
      const truth = sig((rng() - 0.5) * 3)
      const y: 0 | 1 = rng() < truth ? 1 : 0
      const year = 2014 + (i % 6)
      const model = sig(logit(truth) + opts.modelNoise * noise())
      const mkt = sig(logit(truth) + opts.marketNoise * noise())
      preds.push({ id: `b${i}`, event: `E${year}-${Math.floor(i / 8)}`, year, y, priorA: 5, priorB: 5, coin: 0.5, elo: model, lr: model, lrStats: model, lrCal: null })
      lines.set(`b${i}`, { pA: mkt, overround: 1.03, oddsA: 100, oddsB: -100, offsetDays: 0 })
    }
    return { preds, lines }
  }
  const opt = { bootstrap: 200, seed: 1 }

  it('declares the market better when it sees the truth more clearly than the model', () => {
    const { preds, lines } = world({ n: 3000, marketNoise: 0.1, modelNoise: 0.8, seed: 2 })
    const r = compareWithMarket(preds, lines, noMatch, 'lr', opt)
    expect(r).not.toBeNull()
    const model = r!.models.find((m) => m.id === 'lr')!
    expect(model.vsMarket.lo).toBeGreaterThan(0)
    expect(r!.verdict).toContain('worse than')
    expect(r!.models[0].id).toBe('market')
  })

  it('does not claim a difference when the two are equally informed', () => {
    const { preds, lines } = world({ n: 3000, marketNoise: 0.4, modelNoise: 0.4, seed: 3 })
    const r = compareWithMarket(preds, lines, noMatch, 'lr', opt)!
    const model = r.models.find((m) => m.id === 'lr')!
    expect(model.vsMarket.lo).toBeLessThan(0.01)
    expect(model.vsMarket.hi).toBeGreaterThan(-0.01)
  })

  it('blend adds nothing when the model is only a noisier copy of the price', () => {
    const { preds, lines } = world({ n: 4000, marketNoise: 0.1, modelNoise: 0.8, seed: 4 })
    const r = compareWithMarket(preds, lines, noMatch, 'lr', opt)!
    expect(r.stack).not.toBeNull()
    expect(r.stack!.models[2].vsMarket.hi).toBeGreaterThan(-0.002)
    expect(r.verdict).toContain('does not demonstrably add information')
  })

  it('blend uses only earlier years when fitting (first test year is never fitted on itself)', () => {
    const { preds, lines } = world({ n: 4000, marketNoise: 0.3, modelNoise: 0.3, seed: 5 })
    const r = compareWithMarket(preds, lines, noMatch, 'lr', opt)!
    const firstYear = Math.min(...preds.map((p) => p.year))
    expect(Number(r.stack!.period.split('-')[0])).toBeGreaterThan(firstYear)
  })

  it('returns null when too few bouts have prices', () => {
    const { preds, lines } = world({ n: 60, marketNoise: 0.3, modelNoise: 0.3, seed: 6 })
    expect(compareWithMarket(preds, lines, noMatch, 'lr', opt)).toBeNull()
  })

  it('reports the average margin of matched prices', () => {
    const { preds, lines } = world({ n: 500, marketNoise: 0.3, modelNoise: 0.3, seed: 7 })
    expect(compareWithMarket(preds, lines, noMatch, 'lr', opt)!.averageOverround).toBeCloseTo(1.03, 6)
  })
})
