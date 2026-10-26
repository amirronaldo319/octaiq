import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BacktestOutput } from '../backtest/types.ts'
import { renderReport } from './reportMd.ts'

const fixture = resolve(import.meta.dirname, '../../src/test/fixtures/data/backtest.json')

describe('renderReport', () => {
  it.skipIf(!existsSync(fixture))('builds every section from a saved report and states that there is no untouched holdout', () => {
    const out = JSON.parse(readFileSync(fixture, 'utf8')) as BacktestOutput
    const md = renderReport(out, null)
    for (const h of ['## 1. Reproduce this report', '## 3. Evaluation protocol', '## 4. Models on the same fights', '## 5. Promotion gates', '## 9. Where it does better and worse']) expect(md).toContain(h)
    expect(md).toContain('There is no untouched final holdout')
    expect(md).not.toMatch(/NaN|undefined/)
    const primary = out.report.models.find((m) => m.id === out.report.primary)!
    expect(md).toContain(primary.logLoss.estimate.toFixed(4))
  })
})
