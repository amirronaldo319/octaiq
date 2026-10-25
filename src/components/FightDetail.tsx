import type { OutcomeCheck, ResultsModel, ResultsModelBout } from '../engine/eventTypes'
import type { Fighter, Method } from '../engine/types'
import type { FightAnalysis, SideAnalysis } from '../lib/analysis'
import { fmtOdds, fmtPct, fmtSignedPct } from '../lib/format'
import { agreementLabel, buildNarrative } from '../lib/narrative'
import { accuracyStrip, leanOf, trustFor, type PrimaryView } from '../lib/primary'
import { gapPoints, type MarketBout } from '../lib/market'
import { slugify } from '../lib/slug'
import { Avatar } from './Avatar'
import { LineChart } from './LineChart'
import { HitRate } from './HitRate'
import { PriceMovement } from './PriceMovement'
import { TugBar } from './TugBar'
import { WhyPick } from './WhyPick'

interface FightDetailProps {
  analysis: FightAnalysis
  view: PrimaryView
  results?: ResultsModelBout
  resultsMeta?: ResultsModel
  market?: MarketBout
  marketUpdated?: string
  isStatic: boolean
  onFighter: (slug: string) => void
  onShare: () => void
  onBet: (side: SideAnalysis, fightLabel: string) => void
  onAddLeg: (side: SideAnalysis, fightLabel: string) => void
  eventId?: string | null
  /** The visitor's own pick for this bout */
  myPick?: 'a' | 'b'
  onPick?: (side: 'a' | 'b') => void
  onSaveImage?: () => void
  /** Add a side to the parlay at the market's fair (margin-free) price */
  onAddFairLeg?: (side: 'a' | 'b') => void
}

const METHODS: Method[] = ['KO/TKO', 'Submission', 'Decision']

const STAT_ROWS: { label: string; get: (f: Fighter) => string }[] = [
  { label: 'Record', get: (f) => f.record },
  { label: 'Age', get: (f) => String(f.age) },
  { label: 'Reach', get: (f) => `${f.reachCm} cm` },
  { label: 'Style (inferred)', get: (f) => f.style },
  { label: 'Strikes landed per minute', get: (f) => f.slpm.toFixed(1) },
  { label: 'Strike accuracy', get: (f) => fmtPct(f.strikeAcc, 0) },
  { label: 'Strike defense', get: (f) => fmtPct(f.strikeDef, 0) },
  { label: 'Takedowns per 15 minutes', get: (f) => f.tdPer15.toFixed(1) },
  { label: 'Takedown defense', get: (f) => fmtPct(f.tdDef, 0) },
  { label: 'Finish rate', get: (f) => fmtPct(f.finishRate, 0) },
  { label: 'Days since last fight', get: (f) => String(f.layoffDays) },
]

const pct0 = (p: number): string => `${Math.round(p * 100)}%`

function Prediction({ analysis, view, results, meta }: { analysis: FightAnalysis; view: PrimaryView; results?: ResultsModelBout; meta?: ResultsModel }) {
  const { fight } = analysis
  if (view.source === 'none') {
    return (
      <section className="pred" aria-label="Prediction">
        <h3>Prediction</h3>
        <p className="muted">No prediction for this bout yet. {meta?.status === 'unavailable' ? meta.reason : ''}</p>
      </section>
    )
  }
  const lean = leanOf(view.probA)
  const favored = lean.side === 'a' ? fight.a : fight.b
  const favoredProb = lean.side === 'a' ? view.probA : view.probB
  const trust = trustFor(results)
  const strip = accuracyStrip(meta)
  const bt = meta?.backtest

  return (
    <section className="pred" aria-label="Prediction">
      <div className="pred-head">
        <h3>Model pick</h3>
        <span className="pred-source">
          {view.source === 'validated' ? `Backtested model ${meta?.version ?? ''}` : 'Untested estimate from fighter stats'}
        </span>
      </div>

      <div className="pred-split">
        <div className="pred-side a"><span>{fight.a.name}</span><strong>{pct0(view.probA)}</strong></div>
        <div className="pred-side b"><span>{fight.b.name}</span><strong>{pct0(view.probB)}</strong></div>
      </div>
      <TugBar nameA={fight.a.name} nameB={fight.b.name} probA={view.probA} size="lg" lo={view.source === 'validated' ? results?.probLo : undefined} hi={view.source === 'validated' ? results?.probHi : undefined} />
      {view.source === 'validated' && results?.probLo !== undefined && results.probHi !== undefined && (
        <p className="range-note">
          Likely range for {fight.a.name}: <strong>{pct0(results.probLo)} to {pct0(results.probHi)}</strong>. Shown as the pale band on the bar. It comes from
          re-fitting the model on resampled history, so it reflects how much the answer depends on which past fights were used, not everything the model cannot see.
        </p>
      )}

      <p className="pred-sentence">
        <strong>{lean.label}{lean.label === 'Toss-up' ? '' : `: ${favored.name}`}.</strong>{' '}
        {lean.label === 'Toss-up'
          ? 'The model sees almost nothing between them.'
          : `The model gives ${favored.name} ${pct0(favoredProb)}, ${Math.round(lean.points)} points above an even split.`}
      </p>

      {view.source === 'validated' && <HitRate pickProb={Math.max(view.probA, view.probB)} />}

      {view.source === 'validated' && (
        <div className="trust">
          <div className="trust-head">
            <span>How far to trust this</span>
            <strong className={`trust-level ${trust.level.toLowerCase()}`}>{trust.level}</strong>
          </div>
          <div className="trust-meter" role="img" aria-label={`Trust: ${trust.level}, out of Low, Moderate, High`}>
            <span className="on" />
            <span className={trust.level === 'Moderate' ? 'on' : ''} />
            <span className="locked" />
          </div>
          <p className="muted small">{trust.reason} High is not available because betting prices have beaten this model.</p>
        </div>
      )}

      {strip && view.source === 'validated' && (
        <div className="strip" aria-label="Accuracy on past fights">
          <h4>How often it picked the winner in past fights</h4>
          {[
            { label: 'Coin flip', v: strip.coin, cls: 'coin' },
            { label: 'This model', v: strip.model, cls: 'model' },
            ...(strip.market !== null ? [{ label: 'Betting market', v: strip.market, cls: 'market' }] : []),
          ].map((r) => (
            <div key={r.label} className="strip-row">
              <span>{r.label}</span>
              <span className="strip-track"><span className={`strip-fill ${r.cls}`} style={{ width: `${r.v * 100}%` }} /></span>
              <strong>{(r.v * 100).toFixed(1)}%</strong>
            </div>
          ))}
          <p className="muted small">
            Measured on {strip.n.toLocaleString()} fights from {strip.period}{strip.market !== null ? ' that have betting prices' : ''}. Each was predicted using only what was known before it.
            {strip.market !== null && ' The market was more accurate, so treat this as context, not a betting signal.'}
          </p>
        </div>
      )}
      {bt && view.source === 'validated' && results && (
        <p className="muted small">
          Trained on {meta?.trainedOn?.toLocaleString()} fights through {meta?.trainedThrough}. It sees results and per-minute fight statistics, not styles, injuries or camp news.
        </p>
      )}
    </section>
  )
}

function MarketPanel({ analysis, results, market, updated, meta, onAddFairLeg }: { analysis: FightAnalysis; results?: ResultsModelBout; market: MarketBout; updated?: string; meta?: ResultsModel; onAddFairLeg?: (side: 'a' | 'b') => void }) {
  const { fight } = analysis
  const gap = results ? gapPoints(results.probA, market) : null
  const bt = meta?.backtest?.market
  const leans = gap === null ? null : Math.abs(gap) < 2 ? 'The model and the market agree.' : `The model gives ${gap > 0 ? fight.a.name : fight.b.name} ${Math.abs(gap).toFixed(0)} points more than the market does.`
  return (
    <section className="pred market-pred" aria-label="Betting market">
      <div className="pred-head">
        <h3>What the betting market says</h3>
        <span className="pred-source">{market.books} bookmaker{market.books === 1 ? '' : 's'}{updated ? `, updated ${new Date(updated).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}</span>
      </div>
      <div className="pred-split">
        <div className="pred-side a"><span>{fight.a.name}</span><strong>{pct0(market.pA)}</strong></div>
        <div className="pred-side b"><span>{fight.b.name}</span><strong>{pct0(1 - market.pA)}</strong></div>
      </div>
      <TugBar nameA={fight.a.name} nameB={fight.b.name} probA={market.pA} size="lg" lo={market.pLo} hi={market.pHi} />
      <p className="range-note">
        Consensus with the bookmakers’ margin removed. The pale band spans the lowest to highest single bookmaker ({pct0(market.pLo)} to {pct0(market.pHi)} for {fight.a.name}).
      </p>
      {onAddFairLeg && (
        <div className="row-actions">
          <button type="button" className="btn small" onClick={() => onAddFairLeg('a')}>Add {fight.a.name} to parlay at the fair price</button>
          <button type="button" className="btn small" onClick={() => onAddFairLeg('b')}>Add {fight.b.name} to parlay at the fair price</button>
        </div>
      )}
      {leans && (
        <p className="pred-sentence">
          <strong>{leans}</strong>{' '}
          {bt && `In past tests the market was the more accurate of the two (${(bt.marketAccuracy ?? 0) * 100 > 0 ? `${((bt.marketAccuracy ?? 0) * 100).toFixed(1)}% of winners against ${((bt.modelAccuracy ?? 0) * 100).toFixed(1)}%` : ''}), so where they differ, lean toward the market.`}
        </p>
      )}
    </section>
  )
}

const pctOf = (n: number, d = 0): string => `${(n * 100).toFixed(d)}%`

function Check({ label, c }: { label: string; c: OutcomeCheck }) {
  return (
    <li>
      <strong>{label}:</strong> log loss {c.logLoss.toFixed(3)} against {c.baselineLogLoss.toFixed(3)} for the base rate
      (gain {c.gain.toFixed(3)}, 95% range {c.gainLo.toFixed(3)} to {c.gainHi.toFixed(3)}); right {pctOf(c.accuracy)} of the time against {pctOf(c.baselineAccuracy)}.
    </li>
  )
}

function Outcomes({ analysis, results, meta }: { analysis: FightAnalysis; results?: ResultsModelBout; meta?: ResultsModel }) {
  if (!results?.joint || results.distance === undefined) return null
  const { fight } = analysis
  const j = results.joint
  const rows: { label: string; a: number; b: number }[] = [
    { label: 'Knockout or TKO', a: j.aKo, b: j.bKo },
    { label: 'Submission', a: j.aSub, b: j.bSub },
    { label: 'Decision', a: j.aDec, b: j.bDec },
  ]
  const top = Math.max(...rows.flatMap((r) => [r.a, r.b]))
  const oc = meta?.outcomes
  return (
    <section className="outcomes" aria-label="How it could end">
      <h3>How it could end</h3>
      <div className="distance">
        <div><strong>{pctOf(results.distance)}</strong><span>goes the distance</span></div>
        <div><strong>{pctOf(1 - results.distance)}</strong><span>ends in a finish</span></div>
      </div>
      <table className="tbl">
        <thead><tr><th>Winner and method</th><th>{fight.a.name}</th><th>{fight.b.name}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className={r.a === top ? 'best' : ''}>{pctOf(r.a)}</td>
              <td className={r.b === top ? 'best' : ''}>{pctOf(r.b)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        A single most likely outcome is rarely likely on its own: even the top row here is {pctOf(top)}.
        {oc ? ` ${oc.note}` : ''}
      </p>
      {oc && (
        <details className="fold inline-fold">
          <summary>How well these did on past fights ({oc.period})</summary>
          <ul className="reasons">
            <Check label="Goes the distance" c={oc.distance} />
            <Check label="Knockout or submission, among finishes" c={oc.koShare} />
            <Check label="Winner and method together" c={oc.joint} />
          </ul>
          <p className="muted small">A negative gain means the model beat simply guessing the usual rate. These are not compared with betting prices.</p>
        </details>
      )}
    </section>
  )
}

function Facts({ analysis, results }: { analysis: FightAnalysis; results?: ResultsModelBout }) {
  if (!results) return null
  const { fight } = analysis
  const ahead = results.eloDiff >= 0 ? fight.a.name : fight.b.name
  return (
    <section className="facts" aria-label="What the model sees">
      <div className="fact">
        <span>UFC fights in the data</span>
        <strong>{results.priorA} <small>vs</small> {results.priorB}</strong>
        <em>{fight.a.name} vs {fight.b.name}</em>
      </div>
      <div className="fact">
        <span>Rating edge</span>
        <strong>{Math.abs(Math.round(results.eloDiff))} <small>Elo points</small></strong>
        <em>{Math.abs(results.eloDiff) < 5 ? 'Even' : `Toward ${ahead}`}. Elo is a score built from past results.</em>
      </div>
    </section>
  )
}

function MarketSide({ s, modelOn, label, onBet, onAddLeg }: {
  s: SideAnalysis
  modelOn: boolean
  label: string
  onBet: FightDetailProps['onBet']
  onAddLeg: FightDetailProps['onAddLeg']
}) {
  return (
    <div className="side-card">
      <h4>{s.fighter.name}</h4>
      <dl>
        <dt>Best price</dt>
        <dd>{s.bestOdds === null ? 'unavailable' : <>{fmtOdds(s.bestOdds)} <small>{s.bestBook}</small></>}</dd>
        <dt>Market (margin removed)</dt>
        <dd>{s.fairProb === null ? 'unavailable' : fmtPct(s.fairProb)}</dd>
        {modelOn && s.priced && (
          <>
            <dt>Model gap</dt><dd className={s.edge >= 0 ? 'pos' : 'neg'}>{fmtSignedPct(s.edge)}</dd>
            <dt>Expected return per unit</dt><dd className={s.ev >= 0 ? 'pos' : 'neg'}>{fmtSignedPct(s.ev)}</dd>
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
      {items.length === 0 ? <p className="muted small">No factor is large enough to list.</p> : <ul className="reasons">{items.map((t) => <li key={t}>{t}</li>)}</ul>}
    </div>
  )
}

function DeepDive({ analysis, isStatic, onBet, onAddLeg }: Pick<FightDetailProps, 'analysis' | 'isStatic' | 'onBet' | 'onAddLeg'>) {
  const { fight, prediction, a, b, modelValid } = analysis
  const label = `${fight.a.name} vs ${fight.b.name}`
  const priced = fight.books.length > 0
  if (!modelValid && !priced) {
    return isStatic ? null : (
      <p className="muted small">
        Add fighter statistics (<code>UFCALENDAR_API_KEY</code> or <code>data/fighters.csv</code>) to unlock the stat-based breakdown, and
        an odds key to compare with prices.
      </p>
    )
  }
  const narrative = modelValid ? buildNarrative(fight, prediction) : null
  const maxFactor = Math.max(...prediction.factors.map((f) => Math.abs(f.value)), 0.01)

  return (
    <details className="fold" open={!isStatic}>
      <summary>Detailed breakdown</summary>
      <div className="fold-body">
        {modelValid && narrative && (
          <>
            <p className="model-badge" role="note">
              An untested estimate from fighter statistics (hand-set weights, no backtest). Agreement with its own simulation: {agreementLabel(prediction.disagreement)}.
            </p>
            <div className="grid-2">
              <Reasons title={`Why ${fight.a.name} could win`} items={narrative.forA} />
              <Reasons title={`Why ${fight.b.name} could win`} items={narrative.forB} />
            </div>
            <Reasons title="What could make this wrong" items={narrative.risks} />

            <div className="grid-2">
              <div>
                <h4>What tips it</h4>
                <ul className="factors">
                  {prediction.factors.map((f) => (
                    <li key={f.label}>
                      <span className="factor-label">{f.label}</span>
                      <span className="factor-track" aria-hidden="true">
                        <span className={`factor-bar ${f.value >= 0 ? 'right' : 'left'}`} style={{ width: `${(Math.abs(f.value) / maxFactor) * 50}%` }} />
                      </span>
                      <span className="factor-val">{f.value >= 0 ? '+' : ''}{f.value.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4>How it could end (simulated)</h4>
                <table className="tbl">
                  <thead><tr><th>Method</th><th>{fight.a.name}</th><th>{fight.b.name}</th></tr></thead>
                  <tbody>
                    {METHODS.map((m) => (
                      <tr key={m}><td>{m}</td><td>{fmtPct(prediction.methodA[m])}</td><td>{fmtPct(prediction.methodB[m])}</td></tr>
                    ))}
                    <tr className="total"><td>Goes the distance</td><td colSpan={2}>{fmtPct(prediction.distance)}</td></tr>
                  </tbody>
                </table>
                <div className="rounds">
                  {prediction.finishByRound.map((p, i) => (
                    <div key={i} className="round-col">
                      <div className="round-bar" style={{ height: `${Math.max(4, p * 400)}px` }} />
                      <span>Round {i + 1}</span>
                      <small>{fmtPct(p, 0)}</small>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <h4>Side by side</h4>
            <table className="tbl">
              <thead><tr><th></th><th>{fight.a.name}</th><th>{fight.b.name}</th></tr></thead>
              <tbody>
                {STAT_ROWS.map((r) => <tr key={r.label}><td>{r.label}</td><td>{r.get(fight.a)}</td><td>{r.get(fight.b)}</td></tr>)}
              </tbody>
            </table>
          </>
        )}

        {priced && (
          <>
            <h4>Prices</h4>
            <div className="grid-2">
              <MarketSide s={a} modelOn={modelValid} label={label} onBet={onBet} onAddLeg={onAddLeg} />
              <MarketSide s={b} modelOn={modelValid} label={label} onBet={onBet} onAddLeg={onAddLeg} />
            </div>
            <table className="tbl">
              <thead><tr><th>Book</th><th>{fight.a.name}</th><th>{fight.b.name}</th></tr></thead>
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
            <p className="muted small">Average margin {analysis.vig === null ? 'unknown' : fmtPct(analysis.vig)}.</p>
            <LineChart values={fight.history.map(lineValue)} label={`Line movement for ${fight.a.name}`} formatValue={(v) => fmtOdds(unlineValue(v))} />
          </>
        )}
      </div>
    </details>
  )
}

export function FightDetail({ analysis, view, results, resultsMeta, market, marketUpdated, isStatic, onFighter, onShare, onBet, onAddLeg, eventId, myPick, onPick, onSaveImage, onAddFairLeg }: FightDetailProps) {
  const { fight } = analysis
  const notes = fight.bout?.notes ?? []
  return (
    <article className="detail" aria-label={`${fight.a.name} versus ${fight.b.name}`}>
      <header className="detail-head">
        <h2 className="sr-only">{fight.a.name} versus {fight.b.name}</h2>
        <p className="muted">
          {fight.weightClass}, {fight.rounds} rounds
          {fight.bout ? `, ${fight.bout.card === 'main' ? 'main card' : 'prelims'}, bout ${fight.bout.order}` : ''}
          {fight.mainEvent ? ', main event' : ''}
        </p>
        <div className="detail-names">
          {([['a', fight.a], ['b', fight.b]] as const).map(([corner, f], i) => (
            <div key={corner} className="detail-fighter">
              {i === 1 && <span className="detail-vs">vs</span>}
              <button type="button" className={`detail-name ${corner}`} onClick={() => onFighter(slugify(f.name))} aria-label={`${f.name}: career and rating history`}>
                <Avatar name={f.name} corner={corner} size="lg" />
                <span>
                  <span className="fname">{f.name}</span>
                  <span className="detail-rec">{f.rank ? `Ranked #${f.rank}, ` : ''}{f.record}</span>
                </span>
              </button>
            </div>
          ))}
        </div>
        <div className="detail-actions">
          <button type="button" className="share" onClick={onShare}>Copy link to this bout</button>
          {onSaveImage && <button type="button" className="share" onClick={onSaveImage}>Save a pick image</button>}
          <button type="button" className="share" onClick={() => window.print()}>Print</button>
        </div>
        {onPick && (
          <div className="your-pick" role="group" aria-label="Your pick">
            <span>Your pick</span>
            {([['a', fight.a.name], ['b', fight.b.name]] as const).map(([side, name]) => (
              <button key={side} type="button" className={`chip ${myPick === side ? 'on' : ''}`} aria-pressed={myPick === side} onClick={() => onPick(side)}>{name}</button>
            ))}
          </div>
        )}
      </header>

      {market && <MarketPanel analysis={analysis} results={results} market={market} updated={marketUpdated} meta={resultsMeta} onAddFairLeg={onAddFairLeg} />}
      {market && eventId && <PriceMovement eventId={eventId} fightId={fight.id} nameA={fight.a.name} />}
      <Prediction analysis={analysis} view={view.source === 'market' && results ? { source: 'validated', probA: results.probA, probB: results.probB } : view} results={results} meta={resultsMeta} />
      {results?.why && <WhyPick why={results.why} nameA={fight.a.name} nameB={fight.b.name} />}
      <Outcomes analysis={analysis} results={results} meta={resultsMeta} />
      <Facts analysis={analysis} results={results} />

      {notes.length > 0 && (
        <section className="notes" aria-label="Worth checking">
          <h3>Worth checking</h3>
          <ul>{notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </section>
      )}

      <DeepDive analysis={analysis} isStatic={isStatic} onBet={onBet} onAddLeg={onAddLeg} />
    </article>
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
