import type { Interval } from './metrics.ts'
import type { BacktestOutput } from './types.ts'

const f = (n: number, d = 4): string => (Number.isFinite(n) ? n.toFixed(d) : '–')
const ci = (i: Interval): string => `${f(i.estimate)} [${f(i.lo)}, ${f(i.hi)}]`
const sign = (i: Interval): string => `${i.estimate >= 0 ? '+' : ''}${f(i.estimate)} [${f(i.lo)}, ${f(i.hi)}]`

/** Plain-text summary for the terminal. Intervals are 95% event-level bootstrap. */
export function formatReport(out: BacktestOutput): string {
  const r = out.report
  const lines: string[] = []
  lines.push('OCTAIQ WALK-FORWARD BACKTEST')
  lines.push(`Dataset: ${out.dataset.source} (${out.dataset.license}), retrieved ${out.dataset.retrievedAt.slice(0, 10)}`)
  lines.push(`Bouts ${out.ingest.bouts} (${out.ingest.firstDate} to ${out.ingest.lastDate}); dropped: ${out.ingest.droppedNoEvent} no event date, ${out.ingest.droppedBadBout + out.ingest.droppedBadOutcome} unparsable`)
  lines.push(`Stats decay per fight ${r.statsDecay} (chosen on the same validation years); stats rows: ${out.ingest.statsCoverage.boutsWithStats} of ${out.ingest.bouts} bouts have statistics`)
  lines.push(`Scored test bouts ${r.rows.testScored} over ${r.rows.testPeriod}; Elo K=${r.eloK} (chosen on ${r.options.firstTestYear - r.options.validationYears}-${r.options.firstTestYear - 1} only)`)
  lines.push('')
  lines.push('Model                                         n     logloss [95% CI]            Δ vs Elo [95% CI]          Brier   acc    ECE')
  for (const m of r.models) {
    lines.push(
      `${m.label.padEnd(44)} ${String(m.metrics.n).padStart(5)}  ${ci(m.logLoss).padEnd(26)} ${(m.id === 'elo' ? '(reference)' : sign(m.logLossVsElo)).padEnd(26)} ${f(m.metrics.brier)} ${f(m.metrics.accuracy, 3)} ${f(m.metrics.ece, 3)}`,
    )
  }
  lines.push('')
  lines.push(`Stats features vs results-only (paired log loss, 95% CI): ${sign(r.statsVsResults)} -> ${r.statsAdopted ? 'ADOPTED (interval below zero)' : 'NOT adopted (interval does not exclude zero)'}; primary model: ${r.primary}`)
  if (r.calibration) {
    lines.push('')
    lines.push(`Temperature scaling (fitted on earlier out-of-sample years only), ${r.calibration.rows} bouts: logloss ${f(r.calibration.lrLogLoss)} -> ${f(r.calibration.calibratedLogLoss)}, Δ ${sign(r.calibration.diff)}`)
  }
  lines.push('')
  lines.push('By year (logloss): year  n   coin    elo     lr      lr+stats')
  for (const y of r.byYear) lines.push(`                   ${y.year} ${String(y.n).padStart(4)} ${f(y.coinLogLoss)} ${f(y.eloLogLoss)} ${f(y.lrLogLoss)} ${f(y.lrStatsLogLoss)}`)
  lines.push('')
  for (const e of r.experienced) {
    lines.push(`${e.label}: ` + e.models.map((m) => `${m.id} ll ${f(m.logLoss)} acc ${f(m.accuracy, 3)} (n=${m.n})`).join(' | '))
  }
  lines.push('')
  lines.push('Ablations (same walk-forward protocol):')
  for (const a of out.ablations) lines.push(`  ${a.label.padEnd(36)} logloss ${f(a.logLoss)}  acc ${f(a.accuracy, 3)}  ${a.note}`)
  lines.push('')
  const m = out.market
  if (m) {
    lines.push(`MARKET BASELINE (${out.oddsDataset?.license ?? ''}): ${m.n} matched bouts, ${m.period}; matched ${m.match.matched} of ${m.match.records} price rows (${m.match.matchedOffByOneDay} off by a day, ${m.match.winnerDisagreements} winner disagreements); average margin ${((m.averageOverround - 1) * 100).toFixed(1)}%`)
    lines.push('Model                                         n     logloss [95% CI]            Δ vs market [95% CI]       Brier   acc')
    for (const x of m.models) {
      lines.push(`${x.label.padEnd(44)} ${String(x.metrics.n).padStart(5)}  ${ci(x.logLoss).padEnd(26)} ${(x.id === 'market' ? '(reference)' : sign(x.vsMarket)).padEnd(26)} ${f(x.metrics.brier)} ${f(x.metrics.accuracy, 3)}`)
    }
    if (m.stack) {
      lines.push(`Walk-forward blend (${m.stack.period}, n=${m.stack.n}): ` + m.stack.models.map((x) => `${x.id} ${f(x.logLoss.estimate)}`).join(' | ') + `; blend vs market ${sign(m.stack.models[2].vsMarket)}`)
    }
    lines.push(m.verdict)
  } else {
    lines.push(`MARKET BASELINE unavailable. ${out.marketNote ?? ''}`)
  }
  lines.push('')
  lines.push('Interpretation limits: features are fight results plus rolling fight statistics (no odds, styles, injuries or camp news);')
  lines.push('the market comparison covers only bouts with matched prices (to March 2020);')
  lines.push('fighters are matched by name; a lower log loss than Elo is evidence about this model on this data, not a betting edge.')
  return lines.join('\n')
}
