import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createRng } from '../../src/engine/rng.ts'
import { parseBouts, profilesFor, type RawFiles } from './dataset.ts'
import { createResultsModelService, loadAliases } from './resultsModel.ts'
import type { BacktestOutput } from './types.ts'
import { predictUpcoming, upcomingDefaults } from './upcoming.ts'
import { runBacktest } from './walkForward.ts'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY = 86_400_000

/** Builds CSV text in the same layout as the real dataset from a latent-skill simulation. */
function synthFiles(seed: number, years = 9): RawFiles {
  const rng = createRng(seed)
  const skill = Array.from({ length: 70 }, () => (rng() + rng() + rng() - 1.5) * 2)
  const events = ['EVENT,URL,DATE,LOCATION']
  const results = ['EVENT,BOUT,OUTCOME,WEIGHTCLASS,METHOD,ROUND,TIME,TIME FORMAT,REFEREE,DETAILS,URL']
  let id = 0
  for (let y = 0; y < years; y++) {
    for (let e = 0; e < 14; e++) {
      const d = new Date(Date.UTC(2005 + y, 0, 1) + Math.floor((e * 365) / 14) * DAY)
      const name = `Event ${y}-${e}`
      events.push(`${name},u,"${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}",X`)
      for (let m = 0; m < 10; m++) {
        const i = Math.floor(rng() * 70)
        const j = (i + 1 + Math.floor(rng() * 69)) % 70
        const aWins = rng() < 1 / (1 + Math.exp(-1.5 * (skill[i] - skill[j])))
        results.push(`${name},Fighter ${i} vs. Fighter ${j},${aWins ? 'W/L' : 'L/W'},Open,${aWins ? 'KO/TKO' : 'Decision - Unanimous'},1,0:20,3 Rnd,R,D,http://x/${id++}`)
      }
    }
  }
  return { events: events.join('\n'), results: results.join('\n'), fighters: 'FIGHTER,HEIGHT,WEIGHT,REACH,STANCE,DOB,URL\n' }
}

describe('predictUpcoming', () => {
  const files = synthFiles(11)
  const { bouts } = parseBouts(files)
  const profiles = profilesFor(files)
  const date = Date.UTC(2030, 5, 1)
  const opts = upcomingDefaults(32)

  it('returns valid, mirror-image probabilities when the corners are swapped', () => {
    const [p1, p2] = predictUpcoming(bouts, profiles, [
      { id: 'x', a: 'Fighter 3', b: 'Fighter 9', date },
      { id: 'y', a: 'Fighter 9', b: 'Fighter 3', date },
    ], opts)
    expect(p1.probA).toBeGreaterThan(0)
    expect(p1.probA).toBeLessThan(1)
    expect(p1.probA + p1.probB).toBeCloseTo(1)
    expect(p1.probA).toBeCloseTo(p2.probB, 8)
    expect(p1.eloDiff).toBeCloseTo(-p2.eloDiff, 8)
  })

  it('rates a stronger fighter above a weaker one', () => {
    const ratings = new Map<string, number>()
    for (let i = 0; i < 70; i++) {
      const [pr] = predictUpcoming(bouts, profiles, [{ id: String(i), a: `Fighter ${i}`, b: 'Fighter 0', date }], opts)
      ratings.set(`Fighter ${i}`, pr.eloDiff)
    }
    const vals = [...ratings.values()]
    expect(Math.max(...vals)).toBeGreaterThan(Math.min(...vals) + 100)
  })

  it('flags unknown fighters as having no prior bouts and still returns a probability', () => {
    const [p] = predictUpcoming(bouts, profiles, [{ id: 'n', a: 'Brand New Person', b: 'Fighter 2', date }], opts)
    expect(p.priorA).toBe(0)
    expect(p.priorB).toBeGreaterThan(0)
    expect(Number.isFinite(p.probA)).toBe(true)
  })

  it('matches fighters across spelling and word order', () => {
    const [p] = predictUpcoming(bouts, profiles, [{ id: 'm', a: '2 fighter', b: 'FIGHTER 5', date }], opts)
    expect(p.priorA).toBeGreaterThan(0)
    expect(p.priorB).toBeGreaterThan(0)
  })

  it('applies verified aliases and ignores unverified ones', () => {
    const plain = predictUpcoming(bouts, profiles, [{ id: 'a', a: 'Fighter Seven', b: 'Fighter 2', date }], opts)[0]
    expect(plain.priorA).toBe(0)
    const aliased = predictUpcoming(bouts, profiles, [{ id: 'a', a: 'Fighter Seven', b: 'Fighter 2', date }], { ...opts, aliases: { 'fighter seven': 'fighter 7' } })[0]
    expect(aliased.priorA).toBeGreaterThan(0)
  })

  it('does not let the upcoming bouts change the training data', () => {
    const [one] = predictUpcoming(bouts, profiles, [{ id: 'a', a: 'Fighter 3', b: 'Fighter 9', date }], opts)
    const [many] = predictUpcoming(bouts, profiles, [
      { id: 'a', a: 'Fighter 3', b: 'Fighter 9', date },
      { id: 'b', a: 'Fighter 3', b: 'Fighter 11', date },
      { id: 'c', a: 'Fighter 9', b: 'Fighter 11', date },
    ], opts)
    expect(many.probA).toBeCloseTo(one.probA, 10)
  })
})

describe('aliases file', () => {
  it('normalises names, skips comments, and tolerates a missing or broken file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'octaiq-alias-'))
    expect(loadAliases(dir)).toEqual({})
    mkdirSync(join(dir, 'data'), { recursive: true })
    writeFileSync(join(dir, 'data/aliases.json'), JSON.stringify({ _comment: 'x', 'Zachary Reese': 'Zach Reese', bad: 5 }))
    expect(loadAliases(dir)).toEqual({ 'zachary reese': 'zach reese' })
    writeFileSync(join(dir, 'data/aliases.json'), '{oops')
    expect(loadAliases(dir)).toEqual({})
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('results model service', () => {
  const root = mkdtempSync(join(tmpdir(), 'octaiq-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const inputs = [{ id: 'f1', a: 'Fighter 1', b: 'Fighter 2', date: Date.UTC(2030, 0, 1) }]

  it('says how to proceed when nothing has been generated', () => {
    const svc = createResultsModelService(root)
    const out = svc.predict(inputs)
    expect(out.status).toBe('unavailable')
    expect(out.reason).toContain('npm run backtest')
    expect(out.bouts).toEqual({})
  })

  it('refuses to label predictions validated without a report, even when the data exists', () => {
    const files = synthFiles(12)
    mkdirSync(join(root, 'data/raw/ufc'), { recursive: true })
    writeFileSync(join(root, 'data/raw/ufc/ufc_event_details.csv'), files.events)
    writeFileSync(join(root, 'data/raw/ufc/ufc_fight_results.csv'), files.results)
    writeFileSync(join(root, 'data/raw/ufc/ufc_fighter_tott.csv'), files.fighters)
    expect(createResultsModelService(root).predict(inputs).status).toBe('unavailable')
  })

  it('serves predictions with the backtest summary once a report exists', () => {
    const files = synthFiles(12)
    const { bouts, stats } = parseBouts(files)
    const { report, predictions } = runBacktest(bouts, profilesFor(files), { firstTestYear: 2010, validationYears: 3, bootstrap: 100, minCalibrationRows: 300 })
    const out: BacktestOutput = {
      generatedAt: '2030-01-01T00:00:00Z',
      dataset: { source: 'https://github.com/Greco1899/scrape_ufc_stats', license: 'GPL-3.0', upstream: 'test', retrievedAt: '2030-01-01T00:00:00Z', files: [] },
      ingest: stats, report, predictionCount: predictions.length, ablations: [], market: null, oddsDataset: null, recentEvents: [],
    }
    mkdirSync(join(root, 'data/reports'), { recursive: true })
    writeFileSync(join(root, 'data/reports/backtest-latest.json'), JSON.stringify(out))

    const res = createResultsModelService(root).predict(inputs)
    expect(res.status).toBe('available')
    expect(res.backtest?.period).toBe(report.rows.testPeriod)
    expect(res.backtest?.coinLogLoss).toBeCloseTo(Math.log(2), 6)
    expect(res.bouts.f1.probA + res.bouts.f1.probB).toBeCloseTo(1)
    expect(res.trainedOn).toBe(report.rows.scoredDecisive)
  })

  it('uses the stats feature set and labels it only when the backtest adopted it', () => {
    const files = synthFiles(12)
    const { bouts, stats } = parseBouts(files)
    const { report, predictions } = runBacktest(bouts, profilesFor(files), { firstTestYear: 2010, validationYears: 3, bootstrap: 100, minCalibrationRows: 300 })
    const base: Omit<BacktestOutput, 'report'> = {
      generatedAt: '2030-01-01T00:00:00Z',
      dataset: { source: 'https://github.com/Greco1899/scrape_ufc_stats', license: 'GPL-3.0', upstream: 'test', retrievedAt: '2030-01-01T00:00:00Z', files: [] },
      ingest: stats, predictionCount: predictions.length, ablations: [], market: null, oddsDataset: null, recentEvents: [],
    }
    const write = (primary: 'lr' | 'lrStats'): void =>
      writeFileSync(join(root, 'data/reports/backtest-latest.json'), JSON.stringify({ ...base, report: { ...report, primary, statsAdopted: primary === 'lrStats' } }))

    write('lr')
    const plain = createResultsModelService(root).predict(inputs)
    expect(plain.features).toBe('results')
    expect(plain.version).toBe('octa-results-lr-0.1')

    write('lrStats')
    const withStats = createResultsModelService(root).predict(inputs)
    expect(withStats.status).toBe('available')
    expect(withStats.features).toBe('results+stats')
    expect(withStats.version).toBe('octa-results-stats-lr-0.1')
    expect(withStats.backtest?.resultsOnlyLogLoss).toBeCloseTo(report.models.find((m) => m.id === 'lr')?.metrics.logLoss ?? NaN, 10)
    expect(withStats.bouts.f1.probA + withStats.bouts.f1.probB).toBeCloseTo(1)
  })

  it('reports an unreadable report instead of throwing', () => {
    writeFileSync(join(root, 'data/reports/backtest-latest.json'), '{not json')
    expect(createResultsModelService(root).predict(inputs).status).toBe('unavailable')
  })
})
