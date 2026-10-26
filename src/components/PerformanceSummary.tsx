import type { BacktestOutput } from '../../server/backtest/types'
import type { PublishedLedger } from '../../server/lib/snapshot'
import { withBase } from '../lib/fetchJson'
import { useJson } from '../lib/useJson'
import type { Monitor } from '../../server/lib/monitor'
import { wilson } from '../lib/wilson'

const isLedger = (b: unknown): boolean => typeof b === 'object' && b !== null && Array.isArray((b as PublishedLedger).events)
const pct = (n: number, d = 0): string => `${(n * 100).toFixed(d)}%`

/** The question a visitor actually has: when you say 70%, how often does it happen? */
export function CalibrationExplainer({ backtest }: { backtest: BacktestOutput }) {
  const model = backtest.report.models.find((m) => m.id === backtest.report.primary)
  const buckets = (model?.metrics.reliability ?? []).filter((b) => b.n >= 30)
  if (buckets.length === 0) return null
  return (
    <section className="panel calib" aria-label="How trustworthy the percentages are">
      <h2>When we say 70%, how often does it happen?</h2>
      <p className="muted small">
        For every past fight in the test, the model gave its favourite a chance. Grouped by that chance, here is how often the favourite really won. If the model
        is honest, the two bars in each row are about the same length.
      </p>
      <div className="calib-rows">
        {buckets.map((b) => (
          <div key={b.lo} className="calib-row">
            <span className="calib-label">{pct(b.lo)} to {pct(b.hi)}</span>
            <span className="calib-bars" aria-hidden="true">
              <span className="said" style={{ width: pct(b.meanPredicted) }} />
              <span className="won" style={{ width: pct(b.observed) }} />
            </span>
            <span className="calib-nums">said {pct(b.meanPredicted)}, won {pct(b.observed)} <small className="muted">({b.n.toLocaleString()} fights)</small></span>
          </div>
        ))}
      </div>
      <p className="muted small"><span className="legend said" /> What the model said <span className="legend won" /> How often the favourite won</p>
    </section>
  )
}

/** Four plain-language answers above the technical tables. */
export function PerformanceSummary({ backtest }: { backtest: BacktestOutput }) {
  const ledger = useJson<PublishedLedger>([withBase('data/ledger.json')], isLedger)
  const r = backtest.report
  const primary = r.models.find((m) => m.id === r.primary)
  const coin = r.models.find((m) => m.id === 'coin')
  const recent = backtest.recentEvents
  const recentK = recent.reduce((s, e) => s + e.bouts.filter((b) => b.correct).length, 0)
  const recentN = recent.reduce((s, e) => s + e.bouts.length, 0)
  const ci = wilson(recentK, recentN)
  const overallAcc = primary?.metrics.accuracy ?? 0
  const groups = r.experienced
    .map((g) => {
      const m = g.models.find((x) => x.id === r.primary)
      return m && m.n >= 100 ? { label: g.label, n: m.n, accuracy: m.accuracy, logLoss: m.logLoss } : null
    })
    .filter((g): g is { label: string; n: number; accuracy: number; logLoss: number } => g !== null)
  const worst = [...groups].sort((x, y) => x.accuracy - y.accuracy).slice(0, 3)
  const ledgerData = ledger.status === 'ready' ? ledger.data : null
  const versions = ledgerData ? ledgerData.events.reduce((s, e) => s + e.entries, 0) : 0

  return (
    <section className="summary-grid" aria-label="Performance in plain terms">
      <article className="panel">
        <h2>Historical testing</h2>
        <p><strong>{primary ? pct(primary.metrics.accuracy, 1) : '–'}</strong> of winners picked, across {r.rows.testScored.toLocaleString()} fights ({r.rows.testPeriod}).</p>
        <p className="muted small">
          Each year was forecast by a model that had only seen earlier years. Probability quality (log loss, lower is better): {primary ? primary.metrics.logLoss.toFixed(3) : '–'},
          against {coin ? coin.metrics.logLoss.toFixed(3) : '0.693'} for a coin flip.
        </p>
      </article>
      <article className="panel">
        <h2>Published before events</h2>
        {ledgerData ? (
          <>
            <p><strong>{ledgerData.graded === 0 ? 'None graded yet' : `${ledgerData.correct} of ${ledgerData.graded} correct`}</strong>{ledgerData.graded > 0 ? ` (${pct(ledgerData.correct / ledgerData.graded)})` : ''}</p>
            <p className="muted small">{ledgerData.events.length} cards tracked, {versions} saved forecast versions. Each version has a time, a model version and a reason, on the Track record page.</p>
          </>
        ) : <p className="muted small">Loading the public archive…</p>}
      </article>
      <article className="panel">
        <h2>Recent performance</h2>
        {recentN > 0 ? (
          <>
            <p><strong>{pct(recentK / recentN)}</strong> over the last {recent.length} events ({recentN} fights).</p>
            <p className="muted small">
              With a sample this size the true rate could be anywhere from {pct(ci.lo)} to {pct(ci.hi)} (95% interval). Replay of the test, not a live record.
            </p>
          </>
        ) : <p className="muted small">No recent replay in this report.</p>}
      </article>
      <article className="panel">
        <h2>Where it struggles</h2>
        {worst.length === 0 ? <p className="muted small">Not enough fights in any group to say.</p> : (
          <ul className="struggle">
            {worst.map((g) => (
              <li key={g.label}>{g.label}: <strong>{pct(g.accuracy)}</strong> <small className="muted">of {g.n.toLocaleString()}, against {pct(overallAcc)} overall</small></li>
            ))}
          </ul>
        )}
        <p className="muted small">Lowest accuracy among groups with at least 100 fights. The full list is in the table further down.</p>
      </article>
    </section>
  )
}

const isMonitor = (b: unknown): boolean => typeof b === 'object' && b !== null && Array.isArray((b as Monitor).alerts)

/** Operational checks from the last refresh: published results, inputs, drift and price freshness. */
export function MonitorPanel() {
  const m = useJson<Monitor>([withBase('data/monitor.json')], isMonitor)
  if (m.status !== 'ready') return null
  const d = m.data
  return (
    <section className="panel" aria-label="Monitoring">
      <h2>Monitoring</h2>
      {d.alerts.length === 0 ? <p><strong>No alerts</strong> at the last refresh.</p> : <ul className="alerts">{d.alerts.map((a) => <li key={a}>{a}</li>)}</ul>}
      <ul className="small muted">
        <li>Published forecasts graded: {d.prospective.graded}{d.prospective.logLoss !== null ? `, log loss ${d.prospective.logLoss.toFixed(3)} over the last ${d.prospective.window}` : ''}. {d.prospective.note}</li>
        <li>Bouts on current cards: {d.inputs.fights}, with a forecast: {d.inputs.withForecast}, involving a UFC debutant: {d.inputs.debutantBouts}.</li>
        <li>Fighter names checked against the results data: {d.inputs.identityChecked ?? 'not run'}; waiting for a person to confirm: {d.inputs.quarantined ?? 'not run'}.</li>
        <li>Forecast confidence now {d.drift.currentMeanConfidence?.toFixed(2) ?? '–'} on average, against {d.drift.trainingMeanConfidence?.toFixed(2) ?? '–'} in the tests{d.drift.flagged ? ' (a notable shift)' : ''}.</li>
        {d.market && <li>Betting prices: collected {d.market.ageHours} hours ago, covering {d.market.pricedBouts} of {d.market.fights} bouts.</li>}
      </ul>
    </section>
  )
}
