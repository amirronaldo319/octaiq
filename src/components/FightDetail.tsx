import type { FightAnalysis, SideAnalysis } from '../lib/analysis'
import { fmtOdds, fmtPct, fmtSignedPct } from '../lib/format'
import { agreementLabel, buildNarrative } from '../lib/narrative'
import { LineChart } from './LineChart'
import { ProbBar } from './ProbBar'
import type { Fighter, Method } from '../engine/types'
import type { ResultsModel, ResultsModelBout } from '../engine/eventTypes'

interface FightDetailProps {
  analysis: FightAnalysis
  onBet: (side: SideAnalysis, fightLabel: string) => void
  onAddLeg: (side: SideAnalysis, fightLabel: string) => void
  /** Backtested results-only model output for this bout, when available */
  results?: ResultsModelBout
  resultsMeta?: ResultsModel
}

const METHODS: Method[] = ['KO/TKO', 'Submission', 'Decision']

const STAT_ROWS: { label: string; get: (f: Fighter) => string }[] = [
  { label: 'Record', get: (f) => f.record },
  { label: 'Age', get: (f) => String(f.age) },
  { label: 'Reach', get: (f) => `${f.reachCm} cm` },
  { label: 'Style (inferred)', get: (f) => f.style },
  { label: 'Sig. strikes / min', get: (f) => f.slpm.toFixed(1) },
  { label: 'Strike accuracy', get: (f) => fmtPct(f.strikeAcc, 0) },
  { label: 'Strike defense', get: (f) => fmtPct(f.strikeDef, 0) },
  { label: 'Takedowns / 15', get: (f) => f.tdPer15.toFixed(1) },
  { label: 'Takedown defense', get: (f) => fmtPct(f.tdDef, 0) },
  { label: 'Finish rate', get: (f) => fmtPct(f.finishRate, 0) },
  { label: 'Days since last fight', get: (f) => String(f.layoffDays) },
]

function SideCard({ s, modelOn, label, onBet, onAddLeg }: {
  s: SideAnalysis
  modelOn: boolean
  label: string
  onBet: FightDetailProps['onBet']
  onAddLeg: FightDetailProps['onAddLeg']
}) {
  const hasValue = modelOn && s.ev > 0
  return (
    <div className={`side-card ${hasValue ? 'has-value' : ''}`}>
      <h4>{s.fighter.name} <small className="muted">{s.fighter.record}</small></h4>
      <dl>
        <dt>Model</dt>
        <dd>{modelOn ? fmtPct(s.modelProb) : <span className="muted">n/a · no stats</span>}</dd>
        <dt>Market (no-vig)</dt>
        <dd>{s.fairProb === null ? <span className="muted">unavailable</span> : fmtPct(s.fairProb)}</dd>
        <dt>Best price</dt>
        <dd>
          {s.bestOdds === null ? <span className="muted">unavailable</span> : <>{fmtOdds(s.bestOdds)} <small>{s.bestBook}</small></>}
        </dd>
        {modelOn && s.priced && (
          <>
            <dt>Edge</dt><dd className={s.edge >= 0 ? 'pos' : 'neg'}>{fmtSignedPct(s.edge)}</dd>
            <dt>EV / unit</dt><dd className={s.ev >= 0 ? 'pos' : 'neg'}>{fmtSignedPct(s.ev)}</dd>
            <dt>Suggested stake</dt><dd>{fmtPct(s.kelly, 2)} of bankroll</dd>
          </>
        )}
      </dl>
      {s.priced && (
        <div className="row-actions">
          <button className="btn primary" onClick={() => onBet(s, label)}>Log bet</button>
          {modelOn && <button className="btn" onClick={() => onAddLeg(s, label)}>Add to parlay</button>}
        </div>
      )}
    </div>
  )
}

function Reasons({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4>{title}</h4>
      {items.length === 0 ? <p className="muted small">No factor clears the 0.05 log-odds threshold.</p> : (
        <ul className="reasons">{items.map((t) => <li key={t}>{t}</li>)}</ul>
      )}
    </div>
  )
}

function ResultsPanel({ analysis, results, meta }: { analysis: FightAnalysis; results?: ResultsModelBout; meta?: ResultsModel }) {
  const { fight, prediction, modelValid } = analysis
  if (!meta) return null
  if (meta.status !== 'available' || !results || !meta.backtest) {
    return <p className="muted small">Validated results-only model unavailable: {meta.reason ?? 'no output for this bout'}</p>
  }
  const bt = meta.backtest
  const gap = Math.abs(results.probA - prediction.probA)
  return (
    <div className="panel validated">
      <h3>Validated model · {meta.version}</h3>
      <ProbBar nameA={fight.a.name} nameB={fight.b.name} probA={results.probA} />
      <p className="small">
        Trained on {meta.trainedOn} decisive UFC bouts through {meta.trainedThrough}.{' '}
        {meta.features === 'results+stats'
          ? 'It uses results (Elo, record, form, layoff, age, reach) plus rolling striking, takedown, control and submission rates from each fighter\'s earlier fights.'
          : 'It uses results only (Elo, record, form, layoff, age, reach).'}{' '}
        It cannot see styles, injuries, weigh-ins or camp news.
      </p>
      <p className="small">
        <strong>Walk-forward backtest {bt.period} ({bt.n} bouts):</strong> log loss {bt.logLoss.toFixed(3)} [{bt.logLossLo.toFixed(3)}, {bt.logLossHi.toFixed(3)}]
        vs {bt.coinLogLoss.toFixed(3)} for a coin flip, {bt.eloLogLoss.toFixed(3)} for Elo alone
        {meta.features === 'results+stats' ? ` and ${bt.resultsOnlyLogLoss.toFixed(3)} without fight statistics` : ''}; accuracy {(bt.accuracy * 100).toFixed(1)}%.
        This shows the model beats naive baselines on past fights.
      </p>
      {bt.market ? (
        <p className="warn" role="note">
          <strong>Against betting prices it loses.</strong> On {bt.market.n} past bouts with prices ({bt.market.period}), the market's log loss was {bt.market.marketLogLoss.toFixed(3)}
          vs {bt.market.modelLogLoss.toFixed(3)} for this model (gap +{bt.market.gap.toFixed(3)}, 95% CI {bt.market.gapLo.toFixed(3)} to {bt.market.gapHi.toFixed(3)}).
          {bt.market.blendGain ? ` Blending the model into the price changed log loss by ${bt.market.blendGain.estimate.toFixed(4)} [${bt.market.blendGain.lo.toFixed(4)}, ${bt.market.blendGain.hi.toFixed(4)}], with no demonstrable gain.` : ''}{' '}
          So a gap between this model and a price is more likely model error than value. It is not a betting edge.
        </p>
      ) : (
        <p className="small muted">No market comparison is available, so this is not evidence of a betting edge.</p>
      )}
      {(results.priorA === 0 || results.priorB === 0) && (
        <p className="warn" role="alert">
          {[results.priorA === 0 ? fight.a.name : null, results.priorB === 0 ? fight.b.name : null].filter(Boolean).join(' and ')} has no prior
          UFC bouts in the dataset (a UFC debut, or the name differs between sources), so this side is rated as a newcomer.
        </p>
      )}
      {results.priorA > 0 && results.priorB > 0 && Math.min(results.priorA, results.priorB) < 3 && (
        <p className="small muted">
          One fighter has fewer than 3 UFC bouts. In the backtest the model's edge over Elo is much smaller for these fights, so treat this number as weakly supported.
        </p>
      )}
      {modelValid && gap > 0.1 && (
        <p className="small muted">The validated model and the unvalidated baseline differ by {(gap * 100).toFixed(0)} points on the winner. Only the validated model has been tested on past fights.</p>
      )}
    </div>
  )
}

export function FightDetail({ analysis, onBet, onAddLeg, results, resultsMeta }: FightDetailProps) {
  const { fight, prediction, a, b, modelValid } = analysis
  const label = `${fight.a.name} vs ${fight.b.name}`
  const maxFactor = Math.max(...prediction.factors.map((f) => Math.abs(f.value)), 0.01)
  const priced = fight.books.length > 0
  const narrative = modelValid ? buildNarrative(fight, prediction) : null
  const missingNames = [!fight.bout?.statsA ? fight.a.name : null, !fight.bout?.statsB ? fight.b.name : null].filter(Boolean)

  return (
    <section className="detail" aria-label={`${label} breakdown`}>
      <header className="detail-head">
        <div>
          <h2>{label}</h2>
          <p className="muted">
            {fight.weightClass} · {fight.rounds} rounds
            {fight.bout ? ` · ${fight.bout.card === 'main' ? 'Main card' : 'Prelims'} · bout ${fight.bout.order}` : ''}
            {fight.mainEvent ? ' · Main event' : ''}
          </p>
        </div>
        {modelValid && <ProbBar nameA={fight.a.name} nameB={fight.b.name} probA={prediction.probA} />}
      </header>

      {modelValid ? (
        <p className="model-badge" role="note">
          <strong>Baseline research estimate · not validated.</strong> Hand-weighted model plus simulation (octa-baseline-0.1).
          No historical backtest or calibration exists yet. Model agreement: {agreementLabel(prediction.disagreement)}.
        </p>
      ) : (
        <p className="warn" role="alert">
          No model output for this fight: no stats on file for {missingNames.join(' and ')}. Records shown come from a secondary
          source. Add <code>UFCALENDAR_API_KEY</code> or a row in <code>data/fighters.csv</code> (see data/README.md).
        </p>
      )}

      <ResultsPanel analysis={analysis} results={results} meta={resultsMeta} />

      {fight.bout && fight.bout.notes.length > 0 && (
        <div className="panel notes-panel">
          <h3>Verification notes</h3>
          <ul className="reasons">{fight.bout.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      )}

      <div className="grid-2">
        <SideCard s={a} modelOn={modelValid} label={label} onBet={onBet} onAddLeg={onAddLeg} />
        <SideCard s={b} modelOn={modelValid} label={label} onBet={onBet} onAddLeg={onAddLeg} />
      </div>

      {narrative && (
        <div className="panel">
          <h3>Reasoning</h3>
          <div className="grid-2">
            <Reasons title={`Why ${fight.a.name} could win`} items={narrative.forA} />
            <Reasons title={`Why ${fight.b.name} could win`} items={narrative.forB} />
          </div>
          <Reasons title="What could invalidate this" items={narrative.risks} />
        </div>
      )}

      {modelValid && (
        <div className="grid-2">
          <div className="panel">
            <h3>Why the model leans this way</h3>
            <p className="muted small">Bars right favor {fight.a.name}; left favor {fight.b.name}.</p>
            <ul className="factors">
              {prediction.factors.map((f) => (
                <li key={f.label}>
                  <span className="factor-label">{f.label}</span>
                  <span className="factor-track" aria-hidden="true">
                    <span
                      className={`factor-bar ${f.value >= 0 ? 'right' : 'left'}`}
                      style={{ width: `${(Math.abs(f.value) / maxFactor) * 50}%` }}
                    />
                  </span>
                  <span className="factor-val">{f.value >= 0 ? '+' : ''}{f.value.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel">
            <h3>Method of victory (simulated)</h3>
            <table className="tbl">
              <thead>
                <tr><th>Method</th><th>{fight.a.name}</th><th>{fight.b.name}</th></tr>
              </thead>
              <tbody>
                {METHODS.map((m) => (
                  <tr key={m}>
                    <td>{m}</td>
                    <td>{fmtPct(prediction.methodA[m])}</td>
                    <td>{fmtPct(prediction.methodB[m])}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td>Goes the distance</td>
                  <td colSpan={2}>{fmtPct(prediction.distance)}</td>
                </tr>
              </tbody>
            </table>
            <p className="muted small">
              20,000 seeded simulations. The sampling error is about ±0.7 points; the uncertainty in the inputs is far larger.
            </p>
            <h4 className="mt">Finish probability by round</h4>
            <div className="rounds">
              {prediction.finishByRound.map((p, i) => (
                <div key={i} className="round-col">
                  <div className="round-bar" style={{ height: `${Math.max(4, p * 400)}px` }} />
                  <span>R{i + 1}</span>
                  <small>{fmtPct(p, 0)}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid-2">
        <div className="panel">
          <h3>Tale of the tape</h3>
          <table className="tbl">
            <thead>
              <tr><th></th><th>{fight.a.name}</th><th>{fight.b.name}</th></tr>
            </thead>
            <tbody>
              {(modelValid ? STAT_ROWS : STAT_ROWS.slice(0, 1)).map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td>{r.get(fight.a)}</td>
                  <td>{r.get(fight.b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!modelValid && <p className="muted small">Detailed statistics are unavailable until stats are configured.</p>}
        </div>

        <div className="panel">
          <h3>Odds by book</h3>
          {priced ? (
            <>
              <table className="tbl">
                <thead>
                  <tr><th>Book</th><th>{fight.a.name}</th><th>{fight.b.name}</th></tr>
                </thead>
                <tbody>
                  {fight.books.map((l) => (
                    <tr key={l.book}>
                      <td>{l.book}</td>
                      <td className={l.a === a.bestOdds ? 'best' : ''}>{fmtOdds(l.a)}</td>
                      <td className={l.b === b.bestOdds ? 'best' : ''}>{fmtOdds(l.b)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">Average margin: {analysis.vig === null ? '–' : fmtPct(analysis.vig)}</p>
              <h4 className="mt">Line movement · {fight.a.name}</h4>
              <LineChart
                values={fight.history.map(lineValue)}
                label={`Line movement for ${fight.a.name}`}
                formatValue={(v) => fmtOdds(unlineValue(v))}
              />
            </>
          ) : (
            <p className="empty">
              No sportsbook quotes for this bout. The odds provider is not configured or unavailable, or this bout is not
              listed yet. Prices are never estimated.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

/** Map American odds onto one continuous axis so a +105 to -105 move plots correctly. */
function lineValue(american: number): number {
  return american > 0 ? american - 100 : american + 100
}

function unlineValue(v: number): number {
  const rounded = Math.round(v)
  return rounded >= 0 ? rounded + 100 : rounded - 100
}
