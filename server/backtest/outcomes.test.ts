import { describe, expect, it } from 'vitest'
import { createRng } from '../../src/engine/rng.ts'
import { buildCareers } from './careers.ts'
import type { Bout, FighterProfile, MethodKind, SideStats } from './dataset.ts'
import { buildFeatureRows } from './features.ts'
import { distanceInput, evaluateOutcomes, jointProbs, methodInput, weightClassKey, wcOneHot, WEIGHT_CLASSES } from './outcomes.ts'
import { recentEventResults } from './recent.ts'
import { predictUpcoming, upcomingDefaults } from './upcoming.ts'
import type { Prediction } from './walkForward.ts'

const DAY = 86_400_000
const START = Date.UTC(2005, 0, 1)
const noProfiles = new Map<string, FighterProfile>()
const side = (landed: number, extra: Partial<SideStats> = {}): SideStats => ({
  sigLanded: landed, sigAttempted: landed * 2, knockdowns: 0, tdLanded: 0, tdAttempted: 0, subAttempts: 0, ctrlSeconds: 0, ...extra,
})

/** Latent skill decides winners; a latent "finisher" trait decides whether fights end early. */
function world(opts: { finisherSignal: number; seed: number; years?: number; eventsPerYear?: number }): Bout[] {
  const rng = createRng(opts.seed)
  const n = 80
  const skill = Array.from({ length: n }, () => (rng() + rng() + rng() - 1.5) * 2)
  const trait = Array.from({ length: n }, () => (rng() + rng() - 1) * 2)
  const out: Bout[] = []
  let id = 0
  for (let y = 0; y < (opts.years ?? 9); y++) {
    for (let e = 0; e < (opts.eventsPerYear ?? 20); e++) {
      const date = START + (y * 365 + Math.floor((e * 365) / (opts.eventsPerYear ?? 20))) * DAY
      for (let m = 0; m < 10; m++) {
        const i = Math.floor(rng() * n)
        let j = Math.floor(rng() * n)
        if (j === i) j = (j + 1) % n
        const aWins = rng() < 1 / (1 + Math.exp(-(skill[i] - skill[j])))
        const pFinish = 1 / (1 + Math.exp(0.2 - opts.finisherSignal * (trait[i] + trait[j])))
        const finish = rng() < pFinish
        const method: MethodKind = finish ? (rng() < 0.7 ? 'ko' : 'sub') : 'dec'
        out.push({
          id: `b${id++}`, event: `E${y}-${e}`, date, a: `f${i}`, b: `f${j}`, nameA: `F${i}`, nameB: `F${j}`,
          result: aWins ? 'a' : 'b', method, weightClass: m % 2 ? 'Lightweight' : "Women's Strawweight", scheduledRounds: m === 0 ? 5 : 3,
          stats: { a: side(40, { knockdowns: finish && aWins ? 1 : 0 }), b: side(40), minutes: 12 },
        })
      }
    }
  }
  return out
}

describe('weight classes', () => {
  it('normalises the labels used in results and on event pages', () => {
    expect(weightClassKey('Lightweight Bout')).toBe('Lightweight')
    expect(weightClassKey("Women's Strawweight Bout")).toBe("Women's Strawweight")
    expect(weightClassKey('UFC Light Heavyweight Title Bout')).toBe('Light Heavyweight')
    expect(weightClassKey('Open Weight Bout')).toBeNull()
    expect(wcOneHot('Heavyweight').reduce((s, v) => s + v, 0)).toBe(1)
    expect(wcOneHot('Catch Weight')).toEqual(WEIGHT_CLASSES.map(() => 0))
  })

  it('builds model inputs with an intercept and the five-round flag', () => {
    const r = { dist: [1, 2], ctx: { rounds: 5, weightClass: 'Lightweight', method: 'dec' as const, result: 'a' as const } }
    const x = distanceInput(r)
    expect(x.slice(0, 4)).toEqual([1, 1, 2, 1])
    expect(x).toHaveLength(1 + 2 + 1 + WEIGHT_CLASSES.length)
    expect(methodInput([0.5, 1], 'Heavyweight')[0]).toBe(1)
  })
})

describe('joint outcome probabilities', () => {
  it('sum to one and follow the stated structure', () => {
    const j = jointProbs(0.7, { distance: 0.4, koIfA: 0.75, koIfB: 0.5 })
    expect(Object.values(j).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 10)
    expect(j.aDec).toBeCloseTo(0.7 * 0.4)
    expect(j.aKo).toBeCloseTo(0.7 * 0.6 * 0.75)
    expect(j.bSub).toBeCloseTo(0.3 * 0.6 * 0.5)
    expect(j.aDec + j.bDec).toBeCloseTo(0.4)
  })
})

describe('outcome features do not leak', () => {
  const bouts = world({ finisherSignal: 1, seed: 1, years: 6, eventsPerYear: 6 })
  const build = (b: readonly Bout[]) => buildFeatureRows(b, noProfiles, { eloK: 32, statsDecay: 0.9 })

  it("a bout's own method and result never enter its own outcome features", () => {
    const t = 40
    const altered = bouts.map((b, i) => (i === t ? { ...b, method: 'dec' as const, result: b.result === 'a' ? ('b' as const) : ('a' as const) } : b))
    expect(build(altered)[t].dist).toEqual(build(bouts)[t].dist)
    expect(build(altered)[t].mw).toEqual(build(bouts)[t].mw)
  })

  it('features for early bouts are unchanged when later fights are removed or rewritten', () => {
    const full = build(bouts)
    const cutoff = bouts[Math.floor(bouts.length * 0.5)].date
    const rewritten = bouts.map((b) => (b.date > cutoff ? { ...b, method: 'ko' as const, result: 'a' as const } : b))
    const alt = build(rewritten)
    full.forEach((row, i) => { if (row.date <= cutoff) { expect(alt[i].dist).toEqual(row.dist); expect(alt[i].mw).toEqual(row.mw) } })
    build(bouts.filter((b) => b.date <= cutoff)).forEach((row, i) => expect(row.dist).toEqual(full[i].dist))
  })

  it('records the scheduled rounds and weight class used as context', () => {
    const row = build(bouts)[0]
    expect(row.ctx.rounds).toBe(5)
    expect(row.ctx.weightClass).toBe("Women's Strawweight")
  })
})

describe('walk-forward outcome evaluation', () => {
  const opts = { firstTestYear: 2010, ridge: 5, bootstrap: 200, seed: 3 }
  const evalWorld = (signal: number, seed: number) => {
    const bouts = world({ finisherSignal: signal, seed })
    const rows = buildFeatureRows(bouts, noProfiles, { eloK: 32, statsDecay: 0.9 })
    return evaluateOutcomes(rows, new Map(bouts.map((b) => [b.id, 0.5])), opts)
  }

  it('learns who finishes fights when a real signal exists', () => {
    const r = evalWorld(1.4, 11)
    expect(r).not.toBeNull()
    expect(r!.distance.gain.hi).toBeLessThan(0)
    expect(r!.distance.logLoss.estimate).toBeLessThan(r!.distance.baselineLogLoss)
  })

  it('finds no signal when the method is unrelated to the fighters (leak detector)', () => {
    const r = evalWorld(0, 12)
    expect(r).not.toBeNull()
    expect(r!.distance.logLoss.estimate).toBeGreaterThan(r!.distance.baselineLogLoss - 0.01)
    expect(r!.koShare.logLoss.estimate).toBeGreaterThan(r!.koShare.baselineLogLoss - 0.015)
  })

  it('scores the joint (winner, method) distribution against the base rates', () => {
    const r = evalWorld(1.4, 13)
    expect(r!.joint.n).toBeGreaterThan(500)
    expect(Number.isFinite(r!.joint.logLoss.estimate)).toBe(true)
    expect(r!.note).toContain('independent')
  })

  it('returns null when there is too little data to say anything', () => {
    const bouts = world({ finisherSignal: 1, seed: 14, years: 2, eventsPerYear: 2 })
    const rows = buildFeatureRows(bouts, noProfiles, { eloK: 32 })
    expect(evaluateOutcomes(rows, new Map(), opts)).toBeNull()
  })
})

describe('career timelines', () => {
  const bouts = world({ finisherSignal: 1, seed: 21, years: 6, eventsPerYear: 8 })

  it("ends at the same Elo gap the predictor uses for the pair's next fight", () => {
    const careers = buildCareers(bouts, ['F3', 'F9'], { eloK: 32 })
    const next = Date.UTC(2030, 0, 1)
    const probe: Bout = { id: 'probe', event: 'x', date: next, a: 'f3', b: 'f9', nameA: 'F3', nameB: 'F9', result: 'nc', method: 'other', weightClass: '' }
    const row = buildFeatureRows([...bouts, probe], noProfiles, { eloK: 32 }).find((r) => r.id === 'probe')!
    // Career ratings are rounded to 0.1 for the published JSON, so the gap can differ by up to 0.2.
    expect(Math.abs((careers.f3.eloNow as number) - (careers.f9.eloNow as number) - row.x[0] * 400)).toBeLessThan(0.2)
  })

  it('lists fights newest first with consistent records and charts oldest first', () => {
    const c = buildCareers(bouts, ['F3'], { eloK: 32 }).f3
    expect(c.matched).toBe(true)
    expect(c.wins + c.losses + c.draws + c.noContests).toBe(c.fights)
    expect(c.timeline).toHaveLength(c.fights)
    expect(c.timeline[0].date >= c.timeline[c.timeline.length - 1].date).toBe(true)
    expect(c.eloSeries[0].date <= c.eloSeries[c.eloSeries.length - 1].date).toBe(true)
    expect(c.koWins + c.subWins + c.decisionWins).toBeLessThanOrEqual(c.wins)
    expect(c.eloPeak as number).toBeGreaterThanOrEqual(c.eloNow as number)
    expect(c.recent?.fights).toBe(5)
  })

  it('marks unknown names unmatched, honours aliases, and ignores a day with no results', () => {
    const out = buildCareers(bouts, ['Nobody Known', 'Effthree'], { eloK: 32, aliases: { effthree: 'f3' } })
    expect(out['nobody-known']).toMatchObject({ matched: false, fights: 0, eloNow: null, recent: null })
    expect(out.effthree.matched).toBe(true)
    expect(out.effthree.fights).toBeGreaterThan(0)
  })

  it('applies same-day results together, so ratings never reflect a result from the same date', () => {
    const day = Date.UTC(2010, 0, 1)
    const mk = (id: string, a: string, b: string): Bout => ({ id, event: 'E', date: day, a, b, nameA: a, nameB: b, result: 'a', method: 'dec', weightClass: 'x' })
    const c = buildCareers([mk('1', 'p', 'q'), mk('2', 'p', 'r')], ['p'], { eloK: 32 }).p
    expect(c.timeline.map((t) => t.eloAfter)).toEqual([c.eloNow, c.eloNow])
  })
})

describe('recent event grading', () => {
  const bouts = world({ finisherSignal: 1, seed: 31, years: 4, eventsPerYear: 6 })
  const preds: Prediction[] = bouts.map((b) => ({
    id: b.id, event: b.event, year: new Date(b.date).getUTCFullYear(), y: b.result === 'a' ? 1 : 0, priorA: 5, priorB: 5,
    coin: 0.5, elo: 0.5, lr: 0.5, lrStats: b.result === 'a' ? 0.8 : 0.2, lrCal: null, gbm: null, ens: null,
  }))

  it('returns the newest events first, limited to the requested count', () => {
    const r = recentEventResults(bouts, preds, 'lrStats', 3)
    expect(r).toHaveLength(3)
    expect(r[0].date >= r[1].date && r[1].date >= r[2].date).toBe(true)
    expect(r[0].bouts).toHaveLength(10)
  })

  it('grades each pick against the actual winner using the primary model', () => {
    const [perfect] = recentEventResults(bouts, preds, 'lrStats', 1)
    expect(perfect.accuracy).toBe(1)
    expect(perfect.bouts.every((b) => b.correct)).toBe(true)
    expect(perfect.logLoss).toBeCloseTo(-Math.log(0.8), 6)
    const [coin] = recentEventResults(bouts, preds, 'lr', 1)
    expect(coin.logLoss).toBeCloseTo(Math.log(2), 6)
  })

  it('skips predictions whose bout is unknown', () => {
    expect(recentEventResults([], preds, 'lr', 3)).toEqual([])
  })
})

describe('upcoming outcomes and ranges', () => {
  const bouts = world({ finisherSignal: 1.2, seed: 41, years: 7, eventsPerYear: 10 })
  const input = [
    { id: 'x', a: 'F3', b: 'F9', date: Date.UTC(2030, 0, 1), rounds: 5, weightClass: 'Lightweight' },
    { id: 'y', a: 'F4', b: 'F8', date: Date.UTC(2030, 0, 1), rounds: 3, weightClass: "Women's Strawweight" },
  ]
  const base = upcomingDefaults(32)

  it('returns a coherent distribution over how each fight ends', () => {
    const preds = predictUpcoming(bouts, noProfiles, input, base)
    for (const p of preds) {
      expect(p.distance).toBeGreaterThan(0)
      expect(p.distance).toBeLessThan(1)
      expect(Object.values(p.joint).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 8)
      expect(p.joint.aDec + p.joint.bDec).toBeCloseTo(p.distance, 8)
      expect(p.joint.aKo + p.joint.aSub + p.joint.aDec).toBeCloseTo(p.probA, 8)
    }
  })

  it('adds a 90% range only when asked, and it is ordered, bounded and reproducible', () => {
    expect(predictUpcoming(bouts, noProfiles, input, base)[0].probLo).toBeUndefined()
    const a = predictUpcoming(bouts, noProfiles, input, { ...base, bootstrap: 20, seed: 5 })
    const b = predictUpcoming(bouts, noProfiles, input, { ...base, bootstrap: 20, seed: 5 })
    expect(a).toEqual(b)
    for (const p of a) {
      expect(p.probLo as number).toBeLessThanOrEqual(p.probHi as number)
      expect(p.probLo as number).toBeGreaterThan(0)
      expect(p.probHi as number).toBeLessThan(1)
      expect(p.probA).toBeGreaterThan((p.probLo as number) - 0.15)
      expect(p.probA).toBeLessThan((p.probHi as number) + 0.15)
    }
  })

  it('models five-round and three-round fights and different divisions differently', () => {
    const [five, three] = predictUpcoming(bouts, noProfiles, [
      { id: 'a', a: 'F3', b: 'F9', date: Date.UTC(2030, 0, 1), rounds: 5, weightClass: 'Lightweight' },
      { id: 'b', a: 'F3', b: 'F9', date: Date.UTC(2030, 0, 1), rounds: 3, weightClass: 'Lightweight' },
    ], base)
    expect(five.distance).not.toBe(three.distance)
  })
})
