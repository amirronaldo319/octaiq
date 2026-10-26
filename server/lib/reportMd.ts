import type { BacktestOutput } from '../backtest/types.ts'
import type { Registry } from './registry.ts'

const f = (n: number | null | undefined, d = 4): string => (n === null || n === undefined || Number.isNaN(n) ? '–' : n.toFixed(d))
const sg = (n: number, d = 4): string => `${n >= 0 ? '+' : ''}${n.toFixed(d)}`
const ci = (e: number, lo: number, hi: number, d = 4): string => `${sg(e, d)} [${sg(lo, d)}, ${sg(hi, d)}]`
const table = (head: string[], rows: (string | number)[][]): string => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')

/** The evaluation report as Markdown, generated from the saved backtest so no number in it is typed by hand. */
export function renderReport(out: BacktestOutput, registry: Registry | null): string {
  const r = out.report
  const rep = out.reproducibility
  const primary = r.models.find((m) => m.id === r.primary)
  const lines: string[] = []
  const push = (...l: string[]): void => { lines.push(...l, '') }

  push('# OctaIQ evaluation report', `Generated ${out.generatedAt} by \`npm run report\` from \`data/reports/backtest-latest.json\`. Every number below comes from that file; none is typed by hand.`)

  push('## 1. Reproduce this report')
  if (rep) {
    push(
      `- Command: \`${rep.command}\` after \`npm install\` (the results data is downloaded on first run).`,
      `- Results data version \`${rep.dataVersion}\` (retrieved ${out.dataset.retrievedAt.slice(0, 10)}); price data version \`${rep.oddsDataVersion ?? 'none'}\`.`,
      `- Feature pipeline \`${rep.featurePipeline}\`; code commit \`${rep.codeCommit ?? 'unknown'}\`${rep.codeDirty ? ' (the working tree had uncommitted changes, so the commit alone does not reproduce this run)' : ''}; ${rep.node}; random seed ${rep.seed}.`,
      `- Elo K ${rep.options.eloK}, statistics decay ${rep.options.statsDecay ?? 'n/a'}, ridge ${rep.options.ridge}, ${rep.options.bootstrap} event-level bootstrap resamples; features excluded by default: ${rep.options.excludedFeatures.join(', ')}.`,
      'The results data keeps growing, so a later run uses more fights; the data version says which files a report used.',
    )
  } else push('This report predates reproducibility records. Re-run `npm run backtest`.')

  push('## 2. Data', `- Source: ${out.dataset.source} (${out.dataset.license}), scraped from ${out.dataset.upstream}.`, `- ${out.ingest.bouts} bouts from ${out.ingest.firstDate} to ${out.ingest.lastDate}; ${r.rows.scoredDecisive} decisive fights are scored and ${r.rows.excludedDrawOrNoContest} draws or no-contests are excluded.`, `- Fights with per-fight statistics: ${out.ingest.statsCoverage?.boutsWithStats ?? 'n/a'}.`)

  push(
    '## 3. Evaluation protocol',
    `- Walk-forward by year: each year from ${r.options.firstTestYear} is forecast by a model trained on earlier events only; every bout from one event stays together; test period ${r.rows.testPeriod}, ${r.rows.testScored} fights.`,
    `- Settings chosen on ${r.options.firstTestYear - r.options.validationYears}-${r.options.firstTestYear - 1} only (Elo K, statistics decay). Calibration methods are fitted on earlier years' out-of-sample forecasts.`,
    '- Primary metric: out-of-sample log loss. Brier score, winner accuracy and the calibration slope and intercept are reported alongside.',
    `- **There is no untouched final holdout.** Years in the test period have informed development decisions (feature trials, the stats-feature rule, the promotion thresholds were fixed in code but after earlier looks). The only clean out-of-sample evidence is the prospective record in \`data/ledger/\`, which grows as events are graded.`,
    `- Experiments counted in this report: ${r.promotion.length + (r.outcomes?.jointDecision ? 1 : 0)} challenger comparisons and ${out.ablations.length} ablations, after earlier rounds of feature trials noted in the README. A best-of-many result should be read with that in mind.`,
  )

  push('## 4. Models on the same fights', 'Event-level 95% intervals. Calibration slope 1 is ideal; below 1 means forecasts are too extreme.')
  push(table(
    ['Model', 'n', 'Log loss [95% CI]', 'Brier', 'Accuracy', 'Calibration slope', 'Intercept'],
    r.models.map((m) => [m.label, m.metrics.n, `${f(m.logLoss.estimate)} [${f(m.logLoss.lo)}, ${f(m.logLoss.hi)}]`, f(m.metrics.brier), f(m.metrics.accuracy, 3), f(m.metrics.calibration?.slope, 2), f(m.metrics.calibration?.intercept, 2)]),
  ))
  push(`Production model: **${r.primary}** (${primary ? `log loss ${f(primary.logLoss.estimate)}, accuracy ${f(primary.metrics.accuracy, 3)}` : ''}).`)

  push('## 5. Promotion gates', 'Fixed before results were read: paired interval entirely below zero, improvement of at least 0.002, better in at least 60% of yearly folds, calibration slope between 0.8 and 1.2.')
  push(table(['Challenger', 'Against', 'Decision', 'Why'], [...r.promotion, ...(r.outcomes?.jointDecision ? [r.outcomes.jointDecision] : [])].map((d) => [d.name, d.incumbent, d.mode, d.reasons.join('; ')])))

  if (out.market) {
    const m = out.market
    const own = m.models.find((x) => x.id === m.primaryModel)
    push('## 6. Against the betting market', `The figures the site shows on Model health (winner accuracy ${f(own?.metrics.accuracy ?? NaN, 3)} for the model against ${f(m.models[0].metrics.accuracy, 3)} for the market) are this matched sample.`, `Period ${m.period}, ${m.n} fights with matched prices (average margin ${f(m.averageOverround - 1, 3)}).`, m.verdict)
    push(table(['Model', 'Log loss [95% CI]', 'Accuracy', 'Difference from market'], m.models.map((x) => [x.label, `${f(x.logLoss.estimate)} [${f(x.logLoss.lo)}, ${f(x.logLoss.hi)}]`, f(x.metrics.accuracy, 3), x.id === 'market' ? 'reference' : ci(x.vsMarket.estimate, x.vsMarket.lo, x.vsMarket.hi)])))
    if (m.stack?.addsInformation) push(`**Does the model add information beyond the price?** Blend versus the price recalibrated on the same earlier years: ${ci(m.stack.addsInformation.estimate, m.stack.addsInformation.lo, m.stack.addsInformation.hi)} (negative would mean yes). ${m.stack.addsInformation.hi < 0 ? 'The interval is below zero.' : 'The interval includes zero, so it is not demonstrated.'}`)
    if (own) push(`The model alone is ${own.vsMarket.lo > 0 ? 'worse than' : 'not distinguishable from'} the market.`)
    push('Limits:', ...m.caveats.map((c) => `- ${c}`))
  }

  if (r.outcomes) {
    const o = r.outcomes
    push('## 7. Method predictions', `Period ${o.period}. ${o.note}`)
    push(table(['Outcome model', 'n', 'Log loss', 'Against the base rate [95% CI]', 'Accuracy', 'Base-rate accuracy'], [['Goes the distance', o.distance], ['KO share of finishes', o.koShare], ['Winner and method together', o.joint]].map(([l, x]) => {
      const m = x as typeof o.distance
      return [l as string, m.n, f(m.logLoss.estimate), ci(m.gain.estimate, m.gain.lo, m.gain.hi), f(m.accuracy, 3), f(m.baselineAccuracy, 3)]
    })))
    if (o.jointDirect && o.jointHybrid) push(`Direct six-outcome model against the independent joint: ${ci(o.jointDirect.gain.estimate, o.jointDirect.gain.lo, o.jointDirect.gain.hi)}; hybrid with the validated win probability: ${ci(o.jointHybrid.gain.estimate, o.jointHybrid.gain.lo, o.jointHybrid.gain.hi)}. In use: **${o.jointUsed}**.`)
  }

  if (r.calibrationMethods) {
    push('## 8. Calibration methods', 'Each fitted on earlier years only, scored on the next year, on the same fights.')
    push(table(['Method', 'Log loss', 'Against none [95% CI]'], r.calibrationMethods.map((c) => [c.method, f(c.logLoss), c.vsNone ? ci(c.vsNone.estimate, c.vsNone.lo, c.vsNone.hi) : 'reference'])))
  }

  push('## 9. Where it does better and worse', 'Groups with at least 100 fights only; small groups are not shown because they cannot support conclusions.')
  push(table(['Group', 'n', 'Log loss', 'Accuracy'], r.experienced.flatMap((g) => {
    const m = g.models.find((x) => x.id === r.primary)
    return m && m.n >= 100 ? [[g.label, m.n, f(m.logLoss), f(m.accuracy, 3)]] : []
  })))

  push('## 10. Ablations', 'The same walk-forward protocol with different feature sets.')
  push(table(['Variant', 'Log loss', 'Accuracy', 'Note'], out.ablations.map((a) => [a.label, f(a.logLoss), f(a.accuracy, 3), a.note])))

  if (registry) {
    push('## 11. Registry', `Production: \`${registry.production ?? 'none'}\`. Records: ${registry.records.length}.`)
    push(table(['Record', 'Status', 'Data version', 'Note'], registry.records.map((x) => [x.id, x.status, x.dataVersion, x.decision ?? ''])))
  }
  return lines.join('\n')
}
