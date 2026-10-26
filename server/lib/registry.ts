import type { Decision } from '../backtest/promotion.ts'

/**
 * A lightweight model registry: a committed JSON file listing what was evaluated, on which data, with which code, and what
 * happened to it. The production model is trained from the code and data at prediction time, so rolling back means returning
 * to the recorded code commit; the registry says which commit and data version that is.
 */
export interface ModelRecord {
  id: string
  /** Name of the model, e.g. the version constant stamped on every forecast */
  model: string
  createdAt: string
  dataVersion: string
  featurePipeline: string
  codeCommit: string | null
  seed: number
  testPeriod: string
  n: number
  logLoss: number
  logLossLo: number
  logLossHi: number
  brier: number
  accuracy: number
  calibrationSlope: number | null
  config: Record<string, unknown>
  status: 'production' | 'previous' | 'shadow' | 'rejected'
  decision?: string
}

export interface Registry {
  schema: 1
  production: string | null
  records: ModelRecord[]
}

export const emptyRegistry = (): Registry => ({ schema: 1, production: null, records: [] })

export interface RunSummary {
  model: string
  at: string
  dataVersion: string
  featurePipeline: string
  codeCommit: string | null
  seed: number
  testPeriod: string
  n: number
  logLoss: { estimate: number; lo: number; hi: number }
  brier: number
  accuracy: number
  calibrationSlope: number | null
  config: Record<string, unknown>
  challengers: Decision[]
}

const modelIdOf = (model: string, dataVersion: string): string => `${model}@${dataVersion}`

/**
 * Adds one evaluated run. The production record for this model and data version is created once; a different data version of the same
 * model gets its own record. Earlier production records become "previous". Challengers are recorded with the gate's decision.
 */
export function recordRun(reg: Registry, run: RunSummary): Registry {
  const id = modelIdOf(run.model, run.dataVersion)
  const records = reg.records.map((r) => ({ ...r }))
  const known = records.find((r) => r.id === id)
  if (!known) {
    for (const r of records) if (r.status === 'production') r.status = 'previous'
    records.push({
      id, model: run.model, createdAt: run.at, dataVersion: run.dataVersion, featurePipeline: run.featurePipeline, codeCommit: run.codeCommit, seed: run.seed,
      testPeriod: run.testPeriod, n: run.n, logLoss: run.logLoss.estimate, logLossLo: run.logLoss.lo, logLossHi: run.logLoss.hi, brier: run.brier,
      accuracy: run.accuracy, calibrationSlope: run.calibrationSlope, config: run.config, status: 'production',
    })
  } else if (known.status !== 'production') {
    for (const r of records) if (r.status === 'production') r.status = 'previous'
    known.status = 'production'
  }
  for (const c of run.challengers) {
    const cid = modelIdOf(c.name, run.dataVersion)
    if (c.mode === 'promote') continue
    const status: ModelRecord['status'] = c.mode === 'shadow' ? 'shadow' : 'rejected'
    const existing = records.find((r) => r.id === cid)
    const decision = c.reasons.slice(0, 2).join('; ')
    if (existing) {
      existing.status = status
      existing.decision = decision
    } else {
      records.push({
        id: cid, model: c.name, createdAt: run.at, dataVersion: run.dataVersion, featurePipeline: run.featurePipeline, codeCommit: run.codeCommit, seed: run.seed,
        testPeriod: run.testPeriod, n: run.n, logLoss: NaN, logLossLo: NaN, logLossHi: NaN, brier: NaN, accuracy: NaN, calibrationSlope: null,
        config: { comparedWith: c.incumbent, logLossDifference: c.estimate }, status, decision,
      })
    }
  }
  return { schema: 1, production: id, records }
}

/** Points production back at an earlier record and says exactly how to restore its code. Refuses records that were never production. */
export function rollback(reg: Registry, id: string): { registry: Registry; instructions: string } {
  const target = reg.records.find((r) => r.id === id)
  if (!target) throw new Error(`No record named ${id}`)
  if (target.status === 'rejected' || target.status === 'shadow') throw new Error(`${id} was never in production (status: ${target.status})`)
  const records = reg.records.map((r) => ({ ...r, status: r.id === id ? ('production' as const) : r.status === 'production' ? ('previous' as const) : r.status }))
  const how = target.codeCommit
    ? `git checkout ${target.codeCommit} -- server src data/ledger && npm run backtest && npm run snapshot`
    : 'The code commit was not recorded for this model; restore it from your own history.'
  return {
    registry: { ...reg, production: id, records },
    instructions: `Model ${id} is production again in the registry. To restore its behaviour: ${how}. The results data keeps growing, so predictions use data version ${target.dataVersion} only if that download is restored too.`,
  }
}
