import { describe, expect, it } from 'vitest'
import { createRng } from '../../src/engine/rng.ts'
import { classifyMethod, fnv1a, parseBouts, parseDate, parseProfiles, type Bout, type FighterProfile } from './dataset.ts'
import { buildFeatureRows } from './features.ts'
import { bootstrapLogLoss, logLossOne, metrics } from './metrics.ts'
import { applyTemperature, eloProb, fitTemperature, predictLogistic, trainLogistic } from './models.ts'
import { runBacktest } from './walkForward.ts'

const DAY = 86_400_000
const START = Date.UTC(2005, 0, 1)

interface SynthOptions { fighters: number; eventsPerYear: number; years: number; signal: number; seed: number }

/** Synthetic card history: each fighter has a latent skill; `signal` scales how much skill decides wins. */
function synthBouts({ fighters, eventsPerYear, years, signal, seed }: SynthOptions): Bout[] {
  const rng = createRng(seed)
  const skill = Array.from({ length: fighters }, () => (rng() + rng() + rng() - 1.5) * 2)
  const bouts: Bout[] = []
  let id = 0
  for (let y = 0; y < years; y++) {
    for (let e = 0; e < eventsPerYear; e++) {
      const date = START + (y * 365 + Math.floor((e * 365) / eventsPerYear)) * DAY
      for (let m = 0; m < 10; m++) {
        const i = Math.floor(rng() * fighters)
        let j = Math.floor(rng() * fighters)
        if (j === i) j = (j + 1) % fighters
        const pA = 1 / (1 + Math.exp(-signal * (skill[i] - skill[j])))
        bouts.push({
          id: `b${id++}`, event: `E${y}-${e}`, date, a: `f${i}`, b: `f${j}`, nameA: `F${i}`, nameB: `F${j}`,
          result: rng() < pA ? 'a' : 'b', method: rng() < 0.5 ? 'ko' : 'dec', weightClass: 'Lightweight',
        })
      }
    }
  }
  return bouts
}

const noProfiles = new Map<string, FighterProfile>()

describe('ingestion', () => {
  const events = 'EVENT,URL,DATE,LOCATION\nUFC 1,u,"November 12, 1993",X\nUFC 2,u,"March 11, 1994",X\n'
  const mk = (n: number): string => {
    const lines = ['EVENT,BOUT,OUTCOME,WEIGHTCLASS,METHOD,ROUND,TIME,TIME FORMAT,REFEREE,DETAILS,URL']
    for (let i = 0; i < n; i++) lines.push(`UFC 2 ,Fighter ${i} A vs. Fighter ${i} B,W/L,Open,KO/TKO ,1,0:20,No Time Limit,R,D,http://x/${i}`)
    return lines.join('\n')
  }

  it('parses dates and methods', () => {
    expect(parseDate('March 11, 1994')).toBe(Date.UTC(1994, 2, 11))
    expect(parseDate('Jul 13, 1978')).toBe(Date.UTC(1978, 6, 13))
    expect(parseDate('--')).toBeNull()
    expect(classifyMethod("TKO - Doctor's Stoppage")).toBe('ko')
    expect(classifyMethod('Decision - Split ')).toBe('dec')
    expect(classifyMethod('Overturned')).toBe('other')
  })

  it('drops rows it cannot place and counts them', () => {
    const csv = mk(2) + '\nGhost Event,A vs. B,W/L,Open,KO/TKO,1,0:20,x,r,d,http://x/g\nUFC 2,Bad Bout Name,W/L,Open,KO/TKO,1,0:20,x,r,d,http://x/h\nUFC 2,C vs. D,XX,Open,KO/TKO,1,0:20,x,r,d,http://x/i'
    const { bouts, stats } = parseBouts({ events, results: csv, fighters: 'FIGHTER,HEIGHT,WEIGHT,REACH,STANCE,DOB,URL\n' })
    expect(bouts).toHaveLength(2)
    expect(stats).toMatchObject({ droppedNoEvent: 1, droppedBadBout: 1, droppedBadOutcome: 1 })
  })

  it('randomises orientation so the listed order cannot predict the winner', () => {
    const { bouts } = parseBouts({ events, results: mk(2000), fighters: 'FIGHTER,DOB,REACH\n' })
    const aWins = bouts.filter((b) => b.result === 'a').length / bouts.length
    // Every raw row says the first-listed fighter won; after randomisation it must be ~50/50.
    expect(aWins).toBeGreaterThan(0.45)
    expect(aWins).toBeLessThan(0.55)
    expect(fnv1a('x')).toBe(fnv1a('x'))
  })

  it('keeps the winner correct after flipping', () => {
    const { bouts } = parseBouts({ events, results: mk(50), fighters: 'FIGHTER,DOB,REACH\n' })
    for (const b of bouts) {
      const winner = b.result === 'a' ? b.nameA : b.nameB
      expect(winner).toMatch(/ A$/)
    }
  })

  it('ignores bios for ambiguous names', () => {
    const csv = 'FIGHTER,HEIGHT,WEIGHT,REACH,STANCE,DOB,URL\nMike Davis,x,x,70",x,"Jan 01, 1980",u1\nMike Davis,x,x,72",x,"Jan 01, 1990",u2\nJo Solo,x,x,70",x,"Jan 01, 1985",u3'
    const { profiles, ambiguous } = parseProfiles(csv)
    expect(ambiguous).toBe(2)
    expect(profiles.get('mike davis')).toEqual({ dob: null, reachCm: null })
    expect(profiles.get('jo solo')?.reachCm).toBe(178)
  })
})

describe('feature leakage', () => {
  const bouts = synthBouts({ fighters: 60, eventsPerYear: 6, years: 6, signal: 1.2, seed: 1 })

  it('features for early bouts do not change when later bouts are removed', () => {
    const full = buildFeatureRows(bouts, noProfiles, { eloK: 32 })
    const cut = bouts.filter((b) => b.date < bouts[bouts.length - 1].date - 700 * DAY)
    const partial = buildFeatureRows(cut, noProfiles, { eloK: 32 })
    expect(partial.length).toBeGreaterThan(50)
    partial.forEach((row, i) => expect(row.x).toEqual(full[i].x))
  })

  it('features do not depend on future outcomes', () => {
    const cutoff = bouts[Math.floor(bouts.length * 0.6)].date
    const flipped = bouts.map((b) => (b.date > cutoff ? { ...b, result: b.result === 'a' ? ('b' as const) : ('a' as const) } : b))
    const base = buildFeatureRows(bouts, noProfiles, { eloK: 32 })
    const alt = buildFeatureRows(flipped, noProfiles, { eloK: 32 })
    base.forEach((row, i) => {
      if (row.date <= cutoff) expect(alt[i].x).toEqual(row.x)
    })
  })

  it("a bout's own result never enters its own features", () => {
    const one = bouts.slice(0, 10)
    const flippedLast = one.map((b, i) => (i === 9 ? { ...b, result: b.result === 'a' ? ('b' as const) : ('a' as const) } : b))
    const x1 = buildFeatureRows(one, noProfiles, { eloK: 32 })[9].x
    const x2 = buildFeatureRows(flippedLast, noProfiles, { eloK: 32 })[9].x
    expect(x1).toEqual(x2)
  })

  it('applies same-day results only after the whole day is featurised', () => {
    const day = Date.UTC(2010, 0, 1)
    const mk = (id: string, a: string, b: string, result: 'a' | 'b'): Bout => ({
      id, event: 'E', date: day, a, b, nameA: a, nameB: b, result, method: 'dec', weightClass: 'x',
    })
    const rows = buildFeatureRows([mk('1', 'p', 'q', 'a'), mk('2', 'p', 'r', 'a')], noProfiles, { eloK: 32 })
    expect(rows[1].x).toEqual(rows[0].x)
  })

  it('negates the feature vector when the fighters are swapped', () => {
    const sw = bouts.map((b) => ({ ...b, a: b.b, b: b.a, nameA: b.nameB, nameB: b.nameA, result: b.result === 'a' ? ('b' as const) : ('a' as const) }))
    const r1 = buildFeatureRows(bouts, noProfiles, { eloK: 32 })
    const r2 = buildFeatureRows(sw, noProfiles, { eloK: 32 })
    r1.forEach((row, i) => row.x.forEach((v, j) => expect(r2[i].x[j]).toBeCloseTo(-v, 9)))
  })
})

describe('models and metrics', () => {
  it('elo probability is symmetric', () => {
    expect(eloProb(0)).toBeCloseTo(0.5)
    expect(eloProb(0.5) + eloProb(-0.5)).toBeCloseTo(1)
  })

  it('logistic regression recovers a known coefficient', () => {
    const rng = createRng(3)
    const x: number[][] = []
    const y: number[] = []
    for (let i = 0; i < 4000; i++) {
      const v = rng() * 4 - 2
      x.push([v, rng() * 2 - 1])
      y.push(rng() < 1 / (1 + Math.exp(-1.5 * v)) ? 1 : 0)
    }
    const m = trainLogistic(x, y, 0.1)
    const w = m.weights.map((wj, j) => wj / m.scales[j])
    expect(w[0]).toBeGreaterThan(1.3)
    expect(w[0]).toBeLessThan(1.7)
    expect(Math.abs(w[1])).toBeLessThan(0.3)
    expect(predictLogistic(m, [0, 0])).toBeCloseTo(0.5, 5)
  })

  it('temperature scaling shrinks overconfident predictions', () => {
    const rng = createRng(4)
    const preds: number[] = []
    const y: number[] = []
    for (let i = 0; i < 3000; i++) {
      const true_p = 0.35 + rng() * 0.3
      y.push(rng() < true_p ? 1 : 0)
      preds.push(1 / (1 + Math.exp(-3 * Math.log(true_p / (1 - true_p)))))
    }
    const a = fitTemperature(preds, y)
    expect(a).toBeLessThan(0.6)
    expect(applyTemperature(0.9, a)).toBeLessThan(0.9)
  })

  it('computes metrics on known values', () => {
    const m = metrics([0.8, 0.8, 0.2, 0.5], [1, 0, 0, 1])
    expect(m.n).toBe(4)
    expect(m.brier).toBeCloseTo((0.04 + 0.64 + 0.04 + 0.25) / 4)
    expect(m.accuracy).toBeCloseTo((1 + 0 + 1 + 0.5) / 4)
    expect(logLossOne(0.5, 1)).toBeCloseTo(Math.log(2))
    expect(metrics([], []).n).toBe(0)
  })

  it('bootstrap intervals bracket the point estimate and the paired difference is zero for the reference', () => {
    const events = Array.from({ length: 80 }, (_, i) => ({ n: 5, ll: [3.5 + (i % 3) * 0.1, 3.4 + (i % 3) * 0.1] }))
    const b = bootstrapLogLoss(events, 0, 300, 1)
    expect(b.logLoss[0].lo).toBeLessThanOrEqual(b.logLoss[0].estimate)
    expect(b.logLoss[0].hi).toBeGreaterThanOrEqual(b.logLoss[0].estimate)
    expect(b.diffVsRef[0]).toMatchObject({ estimate: 0, lo: 0, hi: 0 })
    expect(b.diffVsRef[1].hi).toBeLessThan(0)
  })
})

describe('walk-forward backtest', () => {
  const opts = { firstTestYear: 2010, validationYears: 3, bootstrap: 200, minCalibrationRows: 300 }

  it('never trains on or after the test year', () => {
    const { report } = runBacktest(synthBouts({ fighters: 80, eventsPerYear: 12, years: 9, signal: 1.2, seed: 5 }), noProfiles, opts)
    expect(report.folds.length).toBeGreaterThan(2)
    for (const fold of report.folds) {
      expect(Date.parse(fold.trainEnd)).toBeLessThan(Date.UTC(fold.year, 0, 1))
    }
  })

  it('learns real signal: beats a coin flip and has a stable ordering', () => {
    const { report } = runBacktest(synthBouts({ fighters: 80, eventsPerYear: 20, years: 9, signal: 1.8, seed: 6 }), noProfiles, opts)
    const [coin, elo, lr] = report.models
    expect(coin.metrics.logLoss).toBeCloseTo(Math.log(2), 6)
    expect(elo.metrics.logLoss).toBeLessThan(coin.metrics.logLoss)
    expect(lr.metrics.logLoss).toBeLessThan(coin.metrics.logLoss)
    expect(lr.logLoss.lo).toBeLessThanOrEqual(lr.logLoss.estimate)
  })

  it('finds NO signal in pure noise (leakage detector)', () => {
    // Outcomes are independent of everything. Any log loss clearly below ln(2) would mean leakage.
    const { report } = runBacktest(synthBouts({ fighters: 80, eventsPerYear: 20, years: 9, signal: 0, seed: 7 }), noProfiles, opts)
    for (const m of report.models) {
      expect(m.metrics.logLoss).toBeGreaterThan(Math.log(2) - 0.015)
    }
    expect(report.models[2].metrics.accuracy).toBeLessThan(0.55)
  })

  it('selects the Elo K using only pre-test years', () => {
    const { report } = runBacktest(synthBouts({ fighters: 80, eventsPerYear: 12, years: 9, signal: 1.2, seed: 8 }), noProfiles, opts)
    expect(report.options.eloKCandidates).toContain(report.eloK)
    expect(report.eloKValidation).toHaveLength(report.options.eloKCandidates.length)
  })

  it('throws a clear error when there is nothing to test', () => {
    const tiny = synthBouts({ fighters: 10, eventsPerYear: 1, years: 2, signal: 1, seed: 9 })
    expect(() => runBacktest(tiny, noProfiles, { ...opts, firstTestYear: 2030 })).toThrow(/No test predictions/)
  })
})
