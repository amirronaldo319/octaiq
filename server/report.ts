import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BacktestOutput } from './backtest/types.ts'
import type { Registry } from './lib/registry.ts'
import { renderReport } from './lib/reportMd.ts'

/** Writes docs/REPORT.md from the latest backtest and the registry. */
const ROOT = resolve(import.meta.dirname, '..')
const out = JSON.parse(readFileSync(resolve(ROOT, 'data/reports/backtest-latest.json'), 'utf8')) as BacktestOutput
let registry: Registry | null = null
try { registry = JSON.parse(readFileSync(resolve(ROOT, 'data/models/registry.json'), 'utf8')) as Registry } catch { /* none yet */ }
mkdirSync(resolve(ROOT, 'docs'), { recursive: true })
writeFileSync(resolve(ROOT, 'docs/REPORT.md'), renderReport(out, registry))
console.info('Wrote docs/REPORT.md')
