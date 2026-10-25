import { describe, expect, it } from 'vitest'
import { createRng } from '../../src/engine/rng.ts'
import { fightMinutes, parseBouts, parseClock, parseFightStats, parseOf, type Bout, type FighterProfile, type SideStats } from './dataset.ts'
import { buildFeatureRows, FEATURE_NAMES, STATS_FEATURES } from './features.ts'
import { runBacktest, selectStatsDecay, DEFAULT_OPTIONS } from './walkForward.ts'

const DAY = 86_400_000
const START = Date.UTC(2005, 0, 1)
const noProfiles = new Map<string, FighterProfile>()

const side = (landed: number, att: number, extra: Partial<SideStats> = {}): SideStats => ({
  sigLanded: landed, sigAttempted: att, knockdowns: 0, tdLanded: 0, tdAttempted: 0, subAttempts: 0, ctrlSeconds: 0, ...extra,
})

type StatMode = 'random' | 'outcomeLinked' | 'skillLinked'

/**
 * Synthetic card history with fight statistics.
 * - `signal` scales how much latent skill decides outcomes (0 = outcomes are coin flips).
 * - 'outcomeLinked': the winner always out-strikes the loser INSIDE the fight (post-fight leak bait).
 * - 'skillLinked': strikes landed depend on the fighter's latent skill.
 */
function synth(opts: { fighters: number; eventsPerYear: number; years: number; signal: number; mode: StatMode; seed: number }): Bout[] {
  const rng = createRng(opts.seed)
  const skill = Array.from({ length: opts.fighters }, () => (rng() + rng() + rng() - 1.5) * 2)
  const bouts: Bout[] = []
  let id = 0
  for (let y = 0; y < opts.years; y++) {
    for (let e = 0; e < opts.eventsPerYear; e++) {
      const date = START + (y * 365 + Math.floor((e * 365) / opts.eventsPerYear)) * DAY
      for (let m = 0; m < 10; m++) {
        const i = Math.floor(rng() * opts.fighters)
        let j = Math.floor(rng() * opts.fighters)
        if (j === i) j = (j + 1) % opts.fighters
        const aWins = rng() < 1 / (1 + Math.exp(-opts.signal * (skill[i] - skill[j])))
        const base = 40 + Math.floor(rng() * 30)
        let la = base
        let lb = base
        if (opts.mode === 'outcomeLinked') {
          la = aWins ? base + 25 : base - 15
          lb = aWins ? base - 15 : base + 25
        } else if (opts.mode === 'skillLinked') {
          la = Math.max(5, Math.round(base * Math.exp(0.4 * skill[i])))
          lb = Math.max(5, Math.round(base * Math.exp(0.4 * skill[j])))
        } else {
          la = base + Math.floor(rng() * 10)
          lb = base + Math.floor(rng() * 10)
        }
        bouts.push({
          id: `b${id++}`, event: `E${y}-${e}`, date, a: `f${i}`, b: `f${j}`, nameA: `F${i}`, nameB: `F${j}`,
          result: aWins ? 'a' : 'b', method: rng() < 0.4 ? 'ko' : 'dec', weightClass: 'x',
          stats: { a: side(la, la * 2, { knockdowns: aWins ? 1 : 0, tdLanded: 1, tdAttempted: 3, ctrlSeconds: 60 }), b: side(lb, lb * 2, { tdAttempted: 2, ctrlSeconds: 30 }), minutes: 12 },
        })
      }
    }
  }
  return bouts
}

const opts = { firstTestYear: 2010, validationYears: 3, bootstrap: 200, minCalibrationRows: 300, statsDecayCandidates: [1, 0.8] }

describe('stats parsing', () => {
  it('parses "X of Y" and clock values and rejects junk', () => {
    expect(parseOf('9 of 37')).toEqual([9, 37])
    expect(parseOf('---')).toBeNull()
    expect(parseOf('')).toBeNull()
    expect(parseClock('1:08')).toBe(68)
    expect(parseClock('--')).toBeNull()
  })

  it('computes fight minutes from round, clock and format', () => {
    expect(fightMinutes('3 Rnd (5-5-5)', '2', '2:30')).toBeCloseTo(7.5)
    expect(fightMinutes('3 Rnd (5-5-5)', '3', '5:00')).toBeCloseTo(15)
    expect(fightMinutes('5 Rnd (5-5-5-5-5)', '5', '5:00')).toBeCloseTo(25)
    expect(fightMinutes('1 Rnd (20)', '1', '12:00')).toBeCloseTo(12)
    expect(fightMinutes('No Time Limit', '1', '0:20')).toBeCloseTo(20 / 60)
    expect(fightMinutes('3 Rnd (5-5-5)', '', '2:30')).toBeNull()
    expect(fightMinutes('3 Rnd (5-5-5)', '2', '--')).toBeNull()
  })

  it('sums rounds per fighter and skips rows without a round or striking data', () => {
    const csv = [
      'EVENT,BOUT,ROUND,FIGHTER,KD,SIG.STR.,SIG.STR. %,TOTAL STR.,TD,TD %,SUB.ATT,REV.,CTRL,HEAD,BODY,LEG,DISTANCE,CLINCH,GROUND',
      'E ,A vs. B,Round 1,A,1,9 of 37,24%,9 of 37,1 of 2,50%,1,0,0:10,0 of 0,0 of 0,0 of 0,0 of 0,0 of 0,0 of 0',
      'E ,A vs. B,Round 2,A,0,5 of 16,31%,5 of 16,0 of 1,0%,2,0,1:05,0 of 0,0 of 0,0 of 0,0 of 0,0 of 0,0 of 0',
      'E ,A vs. B,Round 1,B,0,15 of 25,60%,15 of 25,0 of 0,---,0,0,--,0 of 0,0 of 0,0 of 0,0 of 0,0 of 0,0 of 0',
      'E ,A vs. B,,A,,---,,,,,,,,,,,,,',
    ].join('\n')
    const { byBout, skipped } = parseFightStats(csv)
    const a = byBout.get('E|A vs. B')?.get('a')
    expect(skipped).toBe(1)
    expect(a).toMatchObject({ sigLanded: 14, sigAttempted: 53, knockdowns: 1, tdLanded: 1, tdAttempted: 3, subAttempts: 3, ctrlSeconds: 75 })
    expect(byBout.get('E|A vs. B')?.get('b')?.ctrlSeconds).toBe(0)
  })

  it('attaches statistics to the correct corner after orientation is randomised', () => {
    const events = 'EVENT,URL,DATE,LOCATION\nE1,u,"March 11, 2010",X\n'
    const resultLines = ['EVENT,BOUT,OUTCOME,WEIGHTCLASS,METHOD,ROUND,TIME,TIME FORMAT,REFEREE,DETAILS,URL']
    const statLines = ['EVENT,BOUT,ROUND,FIGHTER,KD,SIG.STR.,SIG.STR. %,TOTAL STR.,TD,TD %,SUB.ATT,REV.,CTRL,HEAD,BODY,LEG,DISTANCE,CLINCH,GROUND']
    for (let i = 0; i < 300; i++) {
      resultLines.push(`E1,First ${i} vs. Second ${i},W/L,Open,KO/TKO,1,1:00,3 Rnd (5-5-5),R,D,http://x/${i}`)
      statLines.push(`E1,First ${i} vs. Second ${i},Round 1,First ${i},0,10 of 20,50%,10 of 20,0 of 0,---,0,0,0:00,0 of 0,0 of 0,0 of 0,0 of 0,0 of 0,0 of 0`)
      statLines.push(`E1,First ${i} vs. Second ${i},Round 1,Second ${i},0,3 of 6,50%,3 of 6,0 of 0,---,0,0,0:00,0 of 0,0 of 0,0 of 0,0 of 0,0 of 0,0 of 0`)
    }
    const { bouts, stats } = parseBouts({ events, results: resultLines.join('\n'), fighters: 'FIGHTER,DOB,REACH\n', stats: statLines.join('\n') })
    expect(stats.statsCoverage.boutsWithStats).toBe(300)
    expect(bouts.some((b) => b.nameA.startsWith('Second'))).toBe(true)
    for (const b of bouts) {
      expect(b.stats?.a.sigLanded).toBe(b.nameA.startsWith('First') ? 10 : 3)
      expect(b.stats?.b.sigLanded).toBe(b.nameB.startsWith('First') ? 10 : 3)
    }
  })

  it('leaves stats off bouts whose statistics are missing and counts unmatched stat bouts', () => {
    const events = 'EVENT,URL,DATE,LOCATION\nE1,u,"March 11, 2010",X\n'
    const results = 'EVENT,BOUT,OUTCOME,WEIGHTCLASS,METHOD,ROUND,TIME,TIME FORMAT,REFEREE,DETAILS,URL\nE1,A vs. B,W/L,Open,KO/TKO,1,1:00,3 Rnd (5-5-5),R,D,http://x/1'
    const stats = 'EVENT,BOUT,ROUND,FIGHTER,KD,SIG.STR.,SIG.STR. %,TOTAL STR.,TD,TD %,SUB.ATT,REV.,CTRL,HEAD,BODY,LEG,DISTANCE,CLINCH,GROUND\nE1,Ghost vs. Other,Round 1,Ghost,0,1 of 2,50%,1 of 2,0 of 0,---,0,0,0:00,0 of 0,0 of 0,0 of 0,0 of 0,0 of 0,0 of 0'
    const out = parseBouts({ events, results, fighters: 'FIGHTER,DOB,REACH\n', stats })
    expect(out.bouts[0].stats).toBeUndefined()
    expect(out.stats.statsCoverage).toMatchObject({ boutsWithStats: 0, statsBoutsUnmatched: 1 })
  })
})

describe('stats feature leakage', () => {
  const bouts = synth({ fighters: 60, eventsPerYear: 6, years: 6, signal: 1.2, mode: 'skillLinked', seed: 21 })
  const statIdx = FEATURE_NAMES.map((n, i) => ((STATS_FEATURES as readonly string[]).includes(n) ? i : -1)).filter((i) => i >= 0)
  const build = (b: readonly Bout[]) => buildFeatureRows(b, noProfiles, { eloK: 32, statsDecay: 0.9 })

  it("a bout's own post-fight statistics never enter its own features", () => {
    const target = 40
    const altered = bouts.map((b, i) => (i === target ? { ...b, stats: { a: side(500, 600), b: side(1, 90), minutes: 1 } } : b))
    expect(build(altered)[target].x).toEqual(build(bouts)[target].x)
  })

  it('features for early bouts do not change when later fights or their stats are altered or removed', () => {
    const full = build(bouts)
    const cutoff = bouts[Math.floor(bouts.length * 0.5)].date
    const scrambled = bouts.map((b) => (b.date > cutoff ? { ...b, stats: { a: side(300, 301), b: side(2, 200), minutes: 3 } } : b))
    const alt = build(scrambled)
    full.forEach((row, i) => { if (row.date <= cutoff) expect(alt[i].x).toEqual(row.x) })
    const truncated = build(bouts.filter((b) => b.date <= cutoff))
    truncated.forEach((row, i) => expect(row.x).toEqual(full[i].x))
  })

  it('applies same-day statistics only after the whole day is featurised', () => {
    const day = Date.UTC(2010, 0, 1)
    const mk = (id: string, a: string, b: string, la: number): Bout => ({
      id, event: 'E', date: day, a, b, nameA: a, nameB: b, result: 'a', method: 'dec', weightClass: 'x',
      stats: { a: side(la, la * 2), b: side(5, 10), minutes: 10 },
    })
    const rows = build([mk('1', 'p', 'q', 90), mk('2', 'p', 'r', 90)])
    expect(rows[1].x).toEqual(rows[0].x)
  })

  it('earlier statistics do change later features (the stats are actually used)', () => {
    const withStats = build(bouts)
    const without = build(bouts.map((b) => ({ ...b, stats: undefined })))
    const last = withStats.length - 1
    expect(statIdx.some((i) => withStats[last].x[i] !== without[last].x[i])).toBe(true)
    expect(statIdx.every((i) => without[last].x[i] === 0)).toBe(true)
  })

  it('negates the whole feature vector, stats included, when the corners are swapped', () => {
    const swapped = bouts.map((b) => b.stats
      ? { ...b, a: b.b, b: b.a, nameA: b.nameB, nameB: b.nameA, result: b.result === 'a' ? ('b' as const) : ('a' as const), stats: { a: b.stats.b, b: b.stats.a, minutes: b.stats.minutes } }
      : b)
    const r1 = build(bouts)
    const r2 = build(swapped)
    r1.forEach((row, i) => row.x.forEach((v, j) => expect(r2[i].x[j]).toBeCloseTo(-v, 9)))
  })

  it('keeps statistics from drifting toward noise when decay is high', () => {
    const fast = buildFeatureRows(bouts, noProfiles, { eloK: 32, statsDecay: 0.5 })
    const slow = buildFeatureRows(bouts, noProfiles, { eloK: 32, statsDecay: 1 })
    expect(fast[fast.length - 1].x).not.toEqual(slow[slow.length - 1].x)
  })
})

describe('walk-forward with statistics', () => {
  it('finds NO signal when outcomes are random even though each bout\'s stats reveal its outcome', () => {
    // If a bout's own statistics leaked into its features, both logistic models would beat a coin flip by a wide margin.
    const bouts = synth({ fighters: 80, eventsPerYear: 20, years: 9, signal: 0, mode: 'outcomeLinked', seed: 31 })
    const { report } = runBacktest(bouts, noProfiles, opts)
    for (const m of report.models) expect(m.metrics.logLoss).toBeGreaterThan(Math.log(2) - 0.015)
    expect(report.statsAdopted).toBe(false)
    expect(report.primary).toBe('lr')
  })

  it('ties adoption strictly to the paired interval', () => {
    const bouts = synth({ fighters: 80, eventsPerYear: 20, years: 9, signal: 1.5, mode: 'skillLinked', seed: 32 })
    const { report } = runBacktest(bouts, noProfiles, opts)
    expect(report.statsAdopted).toBe(report.statsVsResults.hi < 0)
    expect(report.primary).toBe(report.statsAdopted ? 'lrStats' : 'lr')
    expect(report.models.map((m) => m.id)).toEqual(['coin', 'elo', 'lr', 'lrStats'])
    const [coin, , lr, lrStats] = report.models
    expect(lr.metrics.logLoss).toBeLessThan(coin.metrics.logLoss)
    expect(lrStats.metrics.logLoss).toBeLessThan(coin.metrics.logLoss)
  })

  it('never trains on the test year and picks the decay from the candidate list using pre-test data only', () => {
    const bouts = synth({ fighters: 80, eventsPerYear: 12, years: 9, signal: 1.2, mode: 'skillLinked', seed: 33 })
    const { report } = runBacktest(bouts, noProfiles, opts)
    expect(opts.statsDecayCandidates).toContain(report.statsDecay)
    expect(report.statsDecayValidation).toHaveLength(opts.statsDecayCandidates.length)
    for (const fold of report.folds) expect(Date.parse(fold.trainEnd)).toBeLessThan(Date.UTC(fold.year, 0, 1))
  })

  it('selectStatsDecay validates only before the first test year', () => {
    const bouts = synth({ fighters: 60, eventsPerYear: 12, years: 9, signal: 1.2, mode: 'skillLinked', seed: 34 })
    const o = { ...DEFAULT_OPTIONS, ...opts }
    const base = selectStatsDecay(bouts, noProfiles, 32, o)
    // Wrecking every statistic dated in or after the first test year must not change the selection.
    const testStart = Date.UTC(o.firstTestYear, 0, 1)
    const wrecked = bouts.map((b) => (b.date >= testStart ? { ...b, stats: { a: side(900, 901), b: side(1, 400), minutes: 2 } } : b))
    expect(selectStatsDecay(wrecked, noProfiles, 32, o)).toEqual(base)
  })
})
