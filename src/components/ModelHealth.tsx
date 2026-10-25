import { useEffect, useState } from 'react'
import type { BacktestOutput } from '../../server/backtest/types'
import { getFirstJson, withBase } from '../lib/fetchJson'

type State = { status: 'loading' } | { status: 'missing'; message: string } | { status: 'ready'; data: BacktestOutput }

const f = (n: number, d = 4): string => (Number.isFinite(n) ? n.toFixed(d) : '–')
const pctOf = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) ? '–' : `${(n * 100).toFixed(1)}%`)
const ci = (e: number, lo: number, hi: number): string => `${f(e)} [${f(lo)}, ${f(hi)}]`

function Reliability({ bins }: { bins: BacktestOutput['report']['models'][number]['metrics']['reliability'] }) {
  const W = 260
  const H = 220
  const pad = 28
  const x = (p: number): number => pad + ((p - 0.5) / 0.5) * (W - pad * 1.5)
  const y = (p: number): number => H - pad - ((p - 0.5) / 0.5) * (H - pad * 1.5)
  const pts = bins.filter((b) => b.n >= 20)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Reliability diagram: predicted versus observed win rate for the favored fighter" className="reliability">
      <line className="chart-base" x1={x(0.5)} y1={y(0.5)} x2={x(1)} y2={y(1)} />
      <polyline className="chart-line up" fill="none" points={pts.map((b) => `${x(b.meanPredicted)},${y(b.observed)}`).join(' ')} />
      {pts.map((b) => (
        <circle key={b.lo} className="chart-dot up" cx={x(b.meanPredicted)} cy={y(b.observed)} r={2 + Math.min(4, b.n / 300)}>
          <title>{`Predicted ${f(b.meanPredicted, 2)}, observed ${f(b.observed, 2)}, n=${b.n}`}</title>
        </circle>
      ))}
      <text x={pad} y={H - 6} className="axis-label">predicted (favored side) →</text>
      <text x={4} y={14} className="axis-label">observed</text>
    </svg>
  )
}

function YearChart({ rows }: { rows: BacktestOutput['report']['byYear'] }) {
  const W = 420
  const H = 150
  const pad = 26
  const all = rows.flatMap((r) => [r.coinLogLoss, r.eloLogLoss, r.lrLogLoss])
  const lo = Math.min(...all) - 0.005
  const hi = Math.max(...all) + 0.005
  const x = (i: number): number => pad + (i / Math.max(1, rows.length - 1)) * (W - pad * 2)
  const y = (v: number): number => H - pad - ((v - lo) / (hi - lo)) * (H - pad * 2)
  const line = (get: (r: (typeof rows)[number]) => number): string => rows.map((r, i) => `${x(i)},${y(get(r))}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Log loss by test year for the coin flip, Elo and logistic models" className="reliability">
      <polyline className="chart-base-line" fill="none" points={line((r) => r.coinLogLoss)} />
      <polyline className="series-elo" fill="none" points={line((r) => r.eloLogLoss)} />
      <polyline className="chart-line up" fill="none" points={line((r) => r.lrLogLoss)} />
      {rows.map((r, i) => (i % 2 === 0 ? <text key={r.year} x={x(i)} y={H - 8} className="axis-label" textAnchor="middle">{r.year}</text> : null))}
      <text x={pad} y={12} className="axis-label">log loss (lower is better) — grey coin, amber Elo, green logistic</text>
    </svg>
  )
}

export function ModelHealth() {
  const [state, setState] = useState<State>({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    getFirstJson(
      [withBase('api/backtest'), withBase('data/backtest.json')],
      (b) => typeof b === 'object' && b !== null && 'report' in b,
      controller.signal,
    )
      .then((found) => {
        if (found) setState({ status: 'ready', data: found.result.body as BacktestOutput })
        else setState({ status: 'missing', message: 'No backtest report yet.' })
      })
      .catch((err: unknown) => {
        if ((err as Error).name !== 'AbortError') setState({ status: 'missing', message: 'Could not load the backtest report.' })
      })
    return () => controller.abort()
  }, [])

  if (state.status === 'loading') return <div className="banner">Loading backtest…</div>
  if (state.status === 'missing') {
    return (
      <section className="panel">
        <h2>Model health</h2>
        <p className="empty">{state.message} Run <code>npm run backtest</code> to download the dataset and evaluate the model.</p>
      </section>
    )
  }

  const { report: r, dataset, ingest, ablations } = state.data
  const lr = r.models.find((m) => m.id === (r.primary ?? 'lr'))
  return (
    <section aria-label="Model health" className="health">
      <header className="health-head">
        <h1>Model health</h1>
        <p className="lead">
          How the model did on {r.rows.testScored.toLocaleString()} past fights ({r.rows.testPeriod}), each predicted using only what was known before it.
          {state.data.market && ' Against betting prices, the market was more accurate.'}
        </p>
      </header>

      <div className="kpis">
        <div className="kpi">
          <span>Picks the winner</span>
          <strong>{pctOf(lr?.metrics.accuracy)}</strong>
          <em>Coin flip 50%{state.data.market ? `. On the ${state.data.market.n.toLocaleString()} fights with prices: model ${pctOf(state.data.market.models.find((m) => m.id === state.data.market?.primaryModel)?.metrics.accuracy)}, betting market ${pctOf(state.data.market.models[0].metrics.accuracy)}` : ''}</em>
        </div>
        <div className="kpi">
          <span>Log loss, lower is better</span>
          <strong>{f(lr?.logLoss.estimate ?? NaN, 3)}</strong>
          <em>Coin flip {f(r.models[0].metrics.logLoss, 3)}. Elo {f(r.models[1].metrics.logLoss, 3)}</em>
        </div>
        <div className="kpi">
          <span>Probabilities match reality</span>
          <strong>{f((lr?.metrics.ece ?? NaN) * 100, 1)} pts</strong>
          <em>Average calibration error</em>
        </div>
        {state.data.market && (
          <div className="kpi bad">
            <span>Gap to betting prices</span>
            <strong>+{f(state.data.market.models.find((m) => m.id === state.data.market?.primaryModel)?.vsMarket.estimate ?? NaN, 3)}</strong>
            <em>Log loss behind the market, and it is statistically real</em>
          </div>
        )}
      </div>

      <details className="fold panel">
        <summary>Full results table and method</summary>
        <div className="fold-body">
        <h2>Walk-forward backtest, {r.primary === 'lrStats' ? 'results plus rolling fight statistics' : 'results only'}</h2>
        <p className="muted small">
          Generated {new Date(state.data.generatedAt).toLocaleString()}. Each year is scored by a model trained only on earlier years.
          Intervals are 95% event-level bootstrap. Dataset: <a href={dataset.source} target="_blank" rel="noopener noreferrer">{dataset.source}</a> ({dataset.license}),
          scraped from {dataset.upstream}; retrieved {dataset.retrievedAt.slice(0, 10)}; {ingest.bouts} bouts, {ingest.firstDate} to {ingest.lastDate}.
        </p>
        <table className="tbl">
          <thead><tr><th>Model</th><th>n</th><th>Log loss [95% CI]</th><th>Δ vs Elo [95% CI]</th><th>Brier</th><th>Accuracy</th><th>ECE</th></tr></thead>
          <tbody>
            {r.models.map((m) => (
              <tr key={m.id}>
                <td>{m.label}</td><td>{m.metrics.n}</td>
                <td>{ci(m.logLoss.estimate, m.logLoss.lo, m.logLoss.hi)}</td>
                <td>{m.id === 'elo' ? 'reference' : ci(m.logLossVsElo.estimate, m.logLossVsElo.lo, m.logLossVsElo.hi)}</td>
                <td>{f(m.metrics.brier)}</td><td>{f(m.metrics.accuracy, 3)}</td><td>{f(m.metrics.ece, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.statsVsResults && (
          <p className="small">
            <strong>Adoption rule (fixed before looking at test results):</strong> the rolling fight-statistics features are used only if the
            paired log-loss gain over the results-only model has a 95% interval entirely below zero. Gain {f(r.statsVsResults.estimate)}{' '}
            [{f(r.statsVsResults.lo)}, {f(r.statsVsResults.hi)}] → {r.statsAdopted ? 'adopted.' : 'not adopted.'}{' '}
            Older statistics fade by a factor of {r.statsDecay} per fight, chosen on {r.options.firstTestYear - r.options.validationYears}–{r.options.firstTestYear - 1} only.
          </p>
        )}
        {r.statsDecayValidation && (
          <p className="muted small">
            Caveat on the decay choice: validation log loss by decay was {r.statsDecayValidation.map((d) => `${d.decay}: ${f(d.logLoss, 3)}`).join(', ')}.
            They differ by under {f(Math.max(...r.statsDecayValidation.map((d) => d.logLoss)) - Math.min(...r.statsDecayValidation.map((d) => d.logLoss)) + 0.0005, 3)} and sit
            above a coin flip because the validation fit had little earlier data, so the choice is weakly supported. Treat the individual feature weights as uninterpretable: the features are correlated.
          </p>
        )}
        <p className="muted small">
          Elo K = {r.eloK}, chosen on {r.options.firstTestYear - r.options.validationYears}–{r.options.firstTestYear - 1} only. Test period {r.rows.testPeriod}.
          Draws and no-contests ({r.rows.excludedDrawOrNoContest}) are not scored.
        </p>
        </div>
      </details>

      {state.data.market ? (
        <div className="panel market-panel">
          <h2>Market baseline: model vs betting prices</h2>
          <p className="small">{state.data.market.verdict}</p>
          <table className="tbl">
            <thead><tr><th>Predictor</th><th>n</th><th>Log loss [95% CI]</th><th>Δ vs market [95% CI]</th><th>Brier</th><th>Accuracy</th></tr></thead>
            <tbody>
              {state.data.market.models.map((m) => (
                <tr key={m.id} className={m.id === 'market' ? 'best' : ''}>
                  <td>{m.label}</td><td>{m.metrics.n}</td>
                  <td>{ci(m.logLoss.estimate, m.logLoss.lo, m.logLoss.hi)}</td>
                  <td>{m.id === 'market' ? 'reference' : ci(m.vsMarket.estimate, m.vsMarket.lo, m.vsMarket.hi)}</td>
                  <td>{f(m.metrics.brier)}</td><td>{f(m.metrics.accuracy, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {state.data.market.stack && (
            <p className="small">
              <strong>Does the model add anything to the price?</strong> A walk-forward blend of the price and the model ({state.data.market.stack.period}, {state.data.market.stack.n} bouts)
              scored {f(state.data.market.stack.models[2].logLoss.estimate)} against {f(state.data.market.stack.models[0].logLoss.estimate)} for the price alone
              (difference {ci(state.data.market.stack.models[2].vsMarket.estimate, state.data.market.stack.models[2].vsMarket.lo, state.data.market.stack.models[2].vsMarket.hi)}).
            </p>
          )}
          <p className="muted small">
            Matched {state.data.market.match.matched} of {state.data.market.match.records} price rows by date and fighter names
            ({state.data.market.match.winnerDisagreements} winner disagreement{state.data.market.match.winnerDisagreements === 1 ? '' : 's'} between the sources);
            average bookmaker margin {((state.data.market.averageOverround - 1) * 100).toFixed(1)}%. Prices are used only after predictions are made, never as features.
          </p>
          <ul className="reasons">{state.data.market.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
          {state.data.oddsDataset && <p className="muted small">Prices: {state.data.oddsDataset.attribution} License: {state.data.oddsDataset.license}.</p>}
        </div>
      ) : (
        <div className="panel">
          <h2>Market baseline</h2>
          <p className="empty">Not available. {state.data.marketNote ?? 'Re-run `npm run backtest` with network access.'}</p>
        </div>
      )}

      <details className="fold panel">
        <summary>Calibration and stability charts</summary>
        <div className="fold-body grid-2">
        <div>
          <h3>Calibration</h3>
          {lr && <Reliability bins={lr.metrics.reliability} />}
          <p className="muted small">
            Points near the diagonal mean stated probabilities match observed win rates. Bins with fewer than 20 bouts are hidden.
            {r.calibration && ` Temperature scaling changed log loss by ${f(r.calibration.diff.estimate)} [${f(r.calibration.diff.lo)}, ${f(r.calibration.diff.hi)}], so the raw probabilities are used.`}
          </p>
        </div>
        <div>
          <h3>Stability by year</h3>
          <YearChart rows={r.byYear} />
          <p className="muted small">Single years hold only about 450 to 500 bouts, so year-to-year swings are partly noise.</p>
        </div>
        </div>
      </details>

      <details className="fold panel">
        <summary>Which inputs matter, and the leak I found and fixed</summary>
        <div className="fold-body grid-2">
        <div>
          <h3>Ablations</h3>
          <table className="tbl">
            <thead><tr><th>Feature set</th><th>Log loss</th><th>Acc.</th></tr></thead>
            <tbody>
              {ablations.map((a) => (
                <tr key={a.label}><td>{a.label}<small className="block muted">{a.note}</small></td><td>{f(a.logLoss)}</td><td>{f(a.accuracy, 3)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3>Leak found and fixed</h3>
          <p className="small">
            An early run used flags for “fighter profile has no date of birth / reach”. Those come from today’s profile pages, and fighters cut
            after a few losses tend to have sparse pages, so the flags leak future career length. They produced implausibly strong early years
            that faded over time. They are now excluded. The ablation row above keeps them only for comparison.
          </p>
          <p className="small muted">Remaining risk: missing age or reach is imputed as “no difference”, which can still carry a faint presence signal.</p>
        </div>
        </div>
      </details>

      <details className="fold panel">
        <summary>What this does not show</summary>
        <ul className="reasons fold-body">
          <li>Beating a coin flip or Elo is the easy test. The market comparison above is the hard one, and the market wins; its prices cover only 2014 to March 2020 and the source does not say which bookmaker or whether they are closing lines.</li>
          <li>Features are fight results and rolling per-minute statistics from earlier fights, not adjusted for opponent quality. Styles, injuries, weigh-ins and camp news are not used. The statistics gain appears mainly for experienced fighters; it is small for newcomers.</li>
          <li>Fighters are matched by name. {ingest.ambiguousNames} profile rows share a name with someone else and were ignored; {ingest.droppedNoEvent} result rows had no event date and were dropped.</li>
          <li>Only UFC bouts are included, so “debut” means UFC debut, not pro debut.</li>
          <li>The hand-weighted baseline shown on fight pages is a different model and has not been backtested.</li>
          <li>Fight statistics are post-fight records: they are used only for later bouts, and tests confirm a bout’s own statistics never enter its own features.</li>
        </ul>
      </details>
    </section>
  )
}
