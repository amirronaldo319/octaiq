import { describe, expect, it } from 'vitest'
import { createRng } from '../../src/engine/rng.ts'
import type { Bout, FighterProfile, MethodKind, SideStats } from './dataset.ts'
import { buildFeatureRows, FEATURE_NAMES } from './features.ts'
import { calibrationFit } from './metrics.ts'
import { predictUpcoming, upcomingDefaults } from './upcoming.ts'

const DAY = 86_400_000
const START = Date.UTC(2012, 0, 1)
const side = (landed: number, extra: Partial<SideStats> = {}): SideStats => ({
  sigLanded: landed, sigAttempted: landed * 2, knockdowns: 0, tdLanded: 1, tdAttempted: 3, subAttempts: 0, ctrlSeconds: 30, ...extra,
})
const profiles = new Map<string, FighterProfile>(Array.from({ length: 40 }, (_, i) => [`f${i}`, { dob: Date.UTC(1985 + (i % 8), i % 12, 1 + (i % 27)), reachCm: 170 + (i % 20), southpaw: i % 4 === 0 }]))

/** A small synthetic promotion: 40 fighters, skill decides winners, stats and methods vary. */
function world(seed = 5, events = 80): Bout[] {
  const rng = createRng(seed)
  const skill = Array.from({ length: 40 }, () => (rng() + rng() - 1) * 2)
  const out: Bout[] = []
  let id = 0
  for (let e = 0; e < events; e++) {
    const date = START + e * 21 * DAY
    for (let m = 0; m < 6; m++) {
      const i = Math.floor(rng() * 40)
      const j = (i + 1 + Math.floor(rng() * 39)) % 40
      const aWins = rng() < 1 / (1 + Math.exp(-(skill[i] - skill[j])))
      const method: MethodKind = rng() < 0.45 ? 'dec' : rng() < 0.7 ? 'ko' : 'sub'
      out.push({
        id: `b${id++}`, event: `E${e}`, date, a: `f${i}`, b: `f${j}`, nameA: `F${i}`, nameB: `F${j}`,
        result: aWins ? 'a' : 'b', method, weightClass: m % 2 ? 'Lightweight Bout' : 'Welterweight Bout', scheduledRounds: m === 0 ? 5 : 3,
        stats: { a: side(30 + Math.floor(rng() * 40)), b: side(30 + Math.floor(rng() * 40)), minutes: 5 + Math.floor(rng() * 15) },
      })
    }
  }
  return out
}

const opts = { eloK: 32 }
const close = (a: readonly number[], b: readonly number[], tol = 1e-9): boolean => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol)

describe('point-in-time features', () => {
  const bouts = world()
  const rows = buildFeatureRows(bouts, profiles, opts)

  it('are unchanged when everything after the forecast date is removed', () => {
    const cut = bouts[Math.floor(bouts.length * 0.6)].date
    const truncated = buildFeatureRows(bouts.filter((b) => b.date < cut), profiles, opts)
    const before = rows.filter((r) => r.date < cut)
    expect(truncated).toHaveLength(before.length)
    before.forEach((r, i) => {
      expect(truncated[i].id).toBe(r.id)
      expect(close(truncated[i].x, r.x)).toBe(true)
      expect(close(truncated[i].dist, r.dist)).toBe(true)
    })
  })

  it('do not depend on any result at or after the bout date, including the same day', () => {
    const day = bouts[Math.floor(bouts.length * 0.5)].date
    const flipped = bouts.map((b) => (b.date >= day ? { ...b, result: b.result === 'a' ? ('b' as const) : ('a' as const), method: 'ko' as MethodKind } : b))
    const rowsFlipped = buildFeatureRows(flipped, profiles, opts)
    rows.forEach((r, i) => {
      if (r.date <= day) expect(close(rowsFlipped[i].x, r.x)).toBe(true)
    })
  })

  it('give the same features to a forecast and to the training row for the same bout', () => {
    const target = bouts[Math.floor(bouts.length * 0.7)]
    const history = bouts.filter((b) => b.date < target.date)
    const row = rows.find((r) => r.id === target.id)!
    const [prediction] = predictUpcoming(history, profiles, [{ id: 'x', a: target.a, b: target.b, date: target.date, rounds: target.scheduledRounds ?? 3, weightClass: target.weightClass }], upcomingDefaults(32))
    expect(prediction.eloDiff).toBeCloseTo(row.x[FEATURE_NAMES.indexOf('elo')] * 400, 6)
    expect(prediction.priorA).toBe(row.priorA)
    expect(prediction.priorB).toBe(row.priorB)
  })
})

describe('fighter order', () => {
  const bouts = world(9, 70)

  it('negates every matchup feature when the corners are swapped, and keeps the symmetric ones', () => {
    const swapped = bouts.map((b) => ({ ...b, a: b.b, b: b.a, nameA: b.nameB, nameB: b.nameA, result: b.result === 'a' ? ('b' as const) : ('a' as const), stats: b.stats ? { ...b.stats, a: b.stats.b, b: b.stats.a } : undefined }))
    const rows = buildFeatureRows(bouts, profiles, opts)
    const rowsSwapped = buildFeatureRows(swapped, profiles, opts)
    rows.forEach((r, i) => {
      expect(close(rowsSwapped[i].x, r.x.map((v) => -v), 1e-9)).toBe(true)
      expect(close(rowsSwapped[i].dist, r.dist, 1e-9)).toBe(true)
      expect(rowsSwapped[i].y).toBe(r.y === null ? null : 1 - r.y)
    })
  })

  it('forecasts the swapped pairing as the complement, for the win chance and for each method', () => {
    const history = bouts.slice(0, 300)
    const date = history[history.length - 1].date + 7 * DAY
    const [p, q] = [
      predictUpcoming(history, profiles, [{ id: 'ab', a: 'f3', b: 'f17', date, rounds: 3, weightClass: 'Lightweight Bout' }], upcomingDefaults(32))[0],
      predictUpcoming(history, profiles, [{ id: 'ba', a: 'f17', b: 'f3', date, rounds: 3, weightClass: 'Lightweight Bout' }], upcomingDefaults(32))[0],
    ]
    expect(p.probA + q.probA).toBeCloseTo(1, 9)
    expect(p.distance).toBeCloseTo(q.distance, 9)
    expect(p.joint.aKo).toBeCloseTo(q.joint.bKo, 9)
    expect(p.joint.bSub).toBeCloseTo(q.joint.aSub, 9)
    expect(Object.values(p.joint).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9)
    expect(p.joint.aKo + p.joint.aSub + p.joint.aDec).toBeCloseTo(p.probA, 9)
  })
})

describe('calibrationFit', () => {
  it('finds slope near 1 and intercept near 0 for honest forecasts', () => {
    const rng = createRng(2)
    const p = Array.from({ length: 20000 }, () => 0.15 + rng() * 0.7)
    const y = p.map((v) => (rng() < v ? 1 : 0))
    const fit = calibrationFit(p, y)!
    expect(Math.abs(fit.slope - 1)).toBeLessThan(0.1)
    expect(Math.abs(fit.intercept)).toBeLessThan(0.05)
  })

  it('finds slope below 1 when forecasts are too extreme, and a bias when they favour one corner', () => {
    const rng = createRng(3)
    const truth = Array.from({ length: 20000 }, () => 0.3 + rng() * 0.4)
    const y = truth.map((v) => (rng() < v ? 1 : 0))
    const stretched = truth.map((v) => 1 / (1 + Math.exp(-2.2 * Math.log(v / (1 - v)))))
    expect(calibrationFit(stretched, y)!.slope).toBeLessThan(0.6)
    const biased = truth.map((v) => Math.min(0.99, v + 0.1))
    expect(calibrationFit(biased, y)!.intercept).toBeLessThan(-0.2)
  })

  it('declines to fit tiny or constant samples', () => {
    expect(calibrationFit([0.6, 0.4], [1, 0])).toBeNull()
    expect(calibrationFit(Array(100).fill(0.6), Array(100).fill(1))).toBeNull()
  })
})
