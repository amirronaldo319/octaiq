import { describe, expect, it } from 'vitest'
import { createRng } from '../../src/engine/rng.ts'
import { applyIsotonic, applyPlatt, compareCalibrators, fitIsotonic, fitPlatt, type CalibrationRow } from './calibrate.ts'

function overconfident(n: number, seed: number, years = 8): CalibrationRow[] {
  const rng = createRng(seed)
  return Array.from({ length: n }, (_, i) => {
    const truth = 0.25 + rng() * 0.5
    const stretched = 1 / (1 + Math.exp(-2 * Math.log(truth / (1 - truth))))
    return { year: 2010 + (i % years), event: `e${Math.floor(i / 6)}`, p: stretched, y: rng() < truth ? 1 : 0 }
  })
}

describe('calibrators', () => {
  const rows = overconfident(6000, 4)
  const p = rows.map((r) => r.p)
  const y = rows.map((r) => r.y)

  it('Platt shrinks stretched forecasts and is symmetric', () => {
    const f = fitPlatt(p, y)!
    expect(f.slope).toBeLessThan(0.7)
    expect(Math.abs(f.intercept)).toBeLessThan(1e-6)
    expect(applyPlatt(0.8, f) + applyPlatt(0.2, f)).toBeCloseTo(1, 9)
    expect(applyPlatt(0.8, f)).toBeLessThan(0.8)
  })

  it('isotonic is non-decreasing and approximately symmetric, and stays inside 0.02 to 0.98', () => {
    const f = fitIsotonic(p, y)!
    for (let i = 1; i < f.ys.length; i++) expect(f.ys[i]).toBeGreaterThanOrEqual(f.ys[i - 1])
    let last = 0
    for (let q = 0.01; q < 1; q += 0.02) {
      const v = applyIsotonic(q, f)
      expect(v).toBeGreaterThanOrEqual(last - 1e-12)
      expect(v).toBeGreaterThanOrEqual(0.02)
      expect(v).toBeLessThanOrEqual(0.98)
      last = v
    }
    expect(Math.abs(applyIsotonic(0.7, f) + applyIsotonic(0.3, f) - 1)).toBeLessThan(0.05)
  })

  it('refuses to fit when there is nothing to learn', () => {
    expect(fitIsotonic([0.5, 0.5, 0.5], [1, 0, 1])).toBeNull()
  })
})

describe('compareCalibrators', () => {
  it('finds that recalibrating overconfident forecasts helps, using earlier years only', () => {
    const out = compareCalibrators(overconfident(9000, 8), { minRows: 800, bootstrap: 200, seed: 1 })!
    const platt = out.find((o) => o.method === 'platt')!
    expect(platt.logLoss).toBeLessThan(out.find((o) => o.method === 'none')!.logLoss)
    expect(platt.vsNone!.hi).toBeLessThan(0)
    expect(out.find((o) => o.method === 'none')!.vsNone).toBeNull()
  })

  it('finds no gain for forecasts that were already honest', () => {
    const rng = createRng(5)
    const honest: CalibrationRow[] = Array.from({ length: 6000 }, (_, i) => {
      const p = 0.2 + rng() * 0.6
      return { year: 2010 + (i % 8), event: `h${Math.floor(i / 6)}`, p, y: rng() < p ? 1 : 0 }
    })
    const out = compareCalibrators(honest, { minRows: 800, bootstrap: 200, seed: 2 })!
    for (const m of out.filter((o) => o.vsNone)) expect(m.vsNone!.hi).toBeGreaterThan(-0.002)
  })

  it('returns null when there is too little earlier data', () => {
    expect(compareCalibrators(overconfident(300, 1), { minRows: 800, bootstrap: 0, seed: 1 })).toBeNull()
  })
})
