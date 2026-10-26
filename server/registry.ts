import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { RESULTS_MODEL_VERSION, STATS_MODEL_VERSION } from './backtest/resultsModel.ts'
import type { BacktestOutput } from './backtest/types.ts'
import { emptyRegistry, recordResearch, recordRun, rollback, type Registry, type ResearchEntry } from './lib/registry.ts'

/** `npm run registry` records the latest backtest; `npm run registry -- --rollback <id>` points production at an earlier model. */
const ROOT = resolve(import.meta.dirname, '..')
const path = resolve(ROOT, 'data/models/registry.json')
const read = (): Registry => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Registry
  } catch {
    return emptyRegistry()
  }
}
const write = (reg: Registry): void => {
  mkdirSync(resolve(ROOT, 'data/models'), { recursive: true })
  const text = JSON.stringify(reg, (_k, v) => (typeof v === 'number' && Number.isNaN(v) ? null : v), 2) + '\n'
  let old = ''
  try { old = readFileSync(path, 'utf8') } catch { /* first run */ }
  if (old !== text) writeFileSync(path, text)
}

const args = process.argv.slice(2)
const i = args.indexOf('--rollback')
if (i >= 0) {
  const { registry, instructions } = rollback(read(), args[i + 1] ?? '')
  write(registry)
  console.info(instructions)
  process.exit(0)
}

const out = JSON.parse(readFileSync(resolve(ROOT, 'data/reports/backtest-latest.json'), 'utf8')) as BacktestOutput
const r = out.report
const primary = r.models.find((m) => m.id === r.primary)
if (!primary || !out.reproducibility) {
  console.error('The backtest report has no reproducibility record. Re-run `npm run backtest`.')
  process.exit(1)
}
const repro = out.reproducibility
const reg = recordRun(read(), {
  model: r.primary === 'lrStats' ? STATS_MODEL_VERSION : RESULTS_MODEL_VERSION,
  at: out.generatedAt, dataVersion: repro.dataVersion, featurePipeline: repro.featurePipeline, codeCommit: repro.codeCommit, seed: repro.seed,
  testPeriod: r.rows.testPeriod, n: primary.metrics.n,
  logLoss: { estimate: primary.logLoss.estimate, lo: primary.logLoss.lo, hi: primary.logLoss.hi },
  brier: primary.metrics.brier, accuracy: primary.metrics.accuracy, calibrationSlope: primary.metrics.calibration?.slope ?? null,
  config: { ...repro.options, features: r.primary === 'lrStats' ? 'results + rolling fight statistics' : 'results only' },
  challengers: [...(r.promotion ?? []), ...(r.outcomes?.jointDecision ? [r.outcomes.jointDecision] : [])],
})
// Research-run models (trees, ratings, hierarchical, ensembles, neural), each with the gate's decision.
interface ResearchModel { summary: { logLoss: number; brier: number; accuracy: number; calibration: { slope: number } | null }; vsBaseline: { estimate: number; lo: number; hi: number } | null; decision: { mode: 'promote' | 'shadow' | 'reject' } | null }
const readResearch = (file: string): Record<string, ResearchModel> | null => {
  try {
    return (JSON.parse(readFileSync(resolve(ROOT, file), 'utf8')) as { models: Record<string, ResearchModel> }).models
  } catch {
    return null
  }
}
const entries: ResearchEntry[] = []
for (const [file, prefix] of [['data/experiments/results.json', ''], ['data/experiments/neural.json', 'neural: ']] as const) {
  for (const [name, m] of Object.entries(readResearch(file) ?? {})) {
    if (!m.decision || !m.vsBaseline) continue
    entries.push({ name: prefix + name, mode: m.decision.mode, estimate: m.vsBaseline.estimate, lo: m.vsBaseline.lo, hi: m.vsBaseline.hi, logLoss: m.summary.logLoss, brier: m.summary.brier, accuracy: m.summary.accuracy, calibrationSlope: m.summary.calibration?.slope ?? null })
  }
}
const withResearch = entries.length ? recordResearch(reg, { at: out.generatedAt, dataVersion: repro.dataVersion, featurePipeline: repro.featurePipeline, codeCommit: repro.codeCommit, seed: repro.seed, testPeriod: r.rows.testPeriod, n: primary.metrics.n, entries }) : reg
write(withResearch)
console.info(`Registry: production is ${withResearch.production}; ${withResearch.records.length} records (${withResearch.records.filter((x) => x.status === 'shadow').length} shadow, ${withResearch.records.filter((x) => x.status === 'rejected').length} rejected).`)
