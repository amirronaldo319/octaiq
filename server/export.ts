import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadDataset } from './backtest/resultsModel.ts'
import { buildFeatureRows, FEATURE_NAMES } from './backtest/features.ts'
import type { BacktestOutput } from './backtest/types.ts'

/**
 * Writes the point-in-time feature matrix that the Python research models train on, so every model family sees exactly the rows and
 * features the production model sees. Each row's features use only bouts dated before its own event. Output is not committed.
 */
const ROOT = resolve(import.meta.dirname, '..')
const data = loadDataset(ROOT)
if (!data) {
  console.error('Dataset not downloaded. Run `npm run fetch-data`.')
  process.exit(1)
}
const report = JSON.parse(readFileSync(resolve(ROOT, 'data/reports/backtest-latest.json'), 'utf8')) as BacktestOutput
const rows = buildFeatureRows(data.bouts, data.profiles, { eloK: report.report.eloK, statsDecay: report.report.statsDecay ?? 0.9 })
const byId = new Map(data.bouts.map((b) => [b.id, b]))

const head = [
  'id', 'event', 'date', 'year', 'y', 'a', 'b', 'prior_a', 'prior_b', 'rounds', 'weight_class', 'method', 'result', 'end_round', 'end_seconds', 'layoff_a', 'layoff_b', 'dob_a', 'dob_b', 'reach_a', 'reach_b',
  ...FEATURE_NAMES.map((n) => `x_${n}`), ...Array.from({ length: 11 }, (_, i) => `d${i}`), 'meta_missing',
]
const q = (s: string): string => `"${s.replace(/"/g, '""')}"`
const lines = [head.join(',')]
for (const r of rows) {
  const b = byId.get(r.id)
  if (!b) continue
  lines.push([
    q(r.id), q(r.event), new Date(r.date).toISOString().slice(0, 10), new Date(r.date).getUTCFullYear(), r.y ?? '', q(b.a), q(b.b), r.priorA, r.priorB, r.ctx.rounds ?? '', q(r.ctx.weightClass),
    r.ctx.method, r.ctx.result, b.endRound ?? '', b.endSeconds ?? '', r.ctx.layoffDays?.[0] ?? '', r.ctx.layoffDays?.[1] ?? '',
    data.profiles.get(b.a)?.dob != null ? 1 : 0, data.profiles.get(b.b)?.dob != null ? 1 : 0, data.profiles.get(b.a)?.reachCm != null ? 1 : 0, data.profiles.get(b.b)?.reachCm != null ? 1 : 0,
    ...r.x, ...r.dist, b.stats ? 0 : 1,
  ].join(','))
}
mkdirSync(resolve(ROOT, 'data/experiments'), { recursive: true })
writeFileSync(resolve(ROOT, 'data/experiments/features.csv'), lines.join('\n') + '\n')
console.info(`Wrote data/experiments/features.csv: ${rows.length} bouts, ${FEATURE_NAMES.length} matchup features, data version ${report.reproducibility?.dataVersion ?? 'unknown'}.`)

// Per-fighter fight tokens for the sequence models: one row per (fighter, bout), with what happened in that fight.
const long = ['fighter,bout_id,date,result,ko,sub,dec,minutes,has_stats,sig_landed_pm,sig_absorbed_pm,td_per15,td_att_per15,sub_per15,kd,ctrl_share,rounds']
for (const b of data.bouts) {
  if (b.result === 'nc') continue
  for (const side of ['a', 'b'] as const) {
    const key = side === 'a' ? b.a : b.b
    const score = b.result === 'draw' ? 0.5 : b.result === side ? 1 : 0
    const own = b.stats ? (side === 'a' ? b.stats.a : b.stats.b) : null
    const opp = b.stats ? (side === 'a' ? b.stats.b : b.stats.a) : null
    const m = b.stats?.minutes ?? 0
    const won = score === 1
    long.push([
      `"${key.replace(/"/g, '""')}"`, `"${b.id.replace(/"/g, '""')}"`, new Date(b.date).toISOString().slice(0, 10), score,
      won && b.method === 'ko' ? 1 : 0, won && b.method === 'sub' ? 1 : 0, b.method === 'dec' ? 1 : 0, m, own ? 1 : 0,
      own && m > 0 ? own.sigLanded / m : '', own && opp && m > 0 ? opp.sigLanded / m : '', own && m > 0 ? (own.tdLanded / m) * 15 : '', own && m > 0 ? (own.tdAttempted / m) * 15 : '',
      own && m > 0 ? (own.subAttempts / m) * 15 : '', own?.knockdowns ?? '', own && m > 0 ? own.ctrlSeconds / 60 / m : '', b.scheduledRounds ?? '',
    ].join(','))
  }
}
writeFileSync(resolve(ROOT, 'data/experiments/fights_long.csv'), long.join('\n') + '\n')
console.info(`Wrote data/experiments/fights_long.csv: ${long.length - 1} fighter-fight rows.`)
