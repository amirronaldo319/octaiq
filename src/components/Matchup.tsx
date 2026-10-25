import type { Career } from '../../server/backtest/careers'
import type { ResultsModelBout } from '../engine/eventTypes'
import type { Fight } from '../engine/types'
import type { MarketBout } from '../lib/market'
import { adjustedForm, conditionsFor, lastFive, oppositionLabel, pathsToVictory, roundHistory, whatCouldChange } from '../lib/matchup'
import { slugify } from '../lib/slug'
import { noteTags } from '../lib/tags'

interface MatchupProps {
  fight: Fight
  eventDate: string
  careers: { status: 'loading' | 'ready' | 'missing'; data?: Record<string, Career> }
  results?: ResultsModelBout
  market?: MarketBout
}

const RESULT_CLASS: Record<string, string> = { W: 'ok', L: 'miss', D: '', NC: '' }

function Side({ name, career, corner, eventDate, boutClass }: { name: string; career?: Career; corner: 'a' | 'b'; eventDate: string; boutClass: string }) {
  if (!career || !career.matched || career.fights === 0) {
    return <div className={`mu-side ${corner}`}><h4>{name}</h4><p className="muted small">No UFC fights found in the results data, so there is no recent form to show.</p></div>
  }
  const rows = lastFive(career)
  const conditions = conditionsFor(career, eventDate, boutClass)
  const form = adjustedForm(career)
  const rounds = roundHistory(career)
  return (
    <div className={`mu-side ${corner}`}>
      <h4>{name}</h4>
      {conditions.length > 0 && (
        <ul className="conditions">{conditions.map((c) => <li key={c.text} className={c.tone}>{c.text}</li>)}</ul>
      )}
      <table className="tbl mu-table">
        <caption className="sr-only">Last {rows.length} UFC fights of {name}</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Opponent</th><th scope="col">Result</th><th scope="col">Opponent level</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.date}-${r.opponent}`}>
              <td>{r.date}</td>
              <td>{r.opponent}</td>
              <td><span className={RESULT_CLASS[r.result]}>{r.result}</span> <small className="muted">{r.method}{r.rounds === 5 ? ', 5 rds' : ''}</small></td>
              <td><small>{oppositionLabel(r.oppElo, career.eloNow)} <span className="muted">({Math.round(r.oppElo)})</span></small></td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mu-facts">
        {form && (
          <li>
            Against the same opponents’ usual, landed <strong>{form.strikes?.toFixed(2)}×</strong> the strikes
            {form.takedowns !== null && <> and <strong>{form.takedowns.toFixed(2)}×</strong> the takedowns</>} over the last {form.fights} fights.
            <span className="muted small"> Above 1 is better than those opponents usually allowed.</span>
          </li>
        )}
        <li>
          Three-round fights: {rounds.three.wins}-{rounds.three.losses} ({rounds.three.fights}). Five-round fights: {rounds.five.wins}-{rounds.five.losses} ({rounds.five.fights}).
        </li>
      </ul>
    </div>
  )
}

/** Concrete context for one bout: recent form with opponent level, conditions, evidence-backed paths, what could change the forecast, and sourced news. */
export function Matchup({ fight, eventDate, careers, results, market }: MatchupProps) {
  const a = careers.data?.[slugify(fight.a.name)]
  const b = careers.data?.[slugify(fight.b.name)]
  const tags = noteTags(fight.bout?.notes ?? [])
  const condA = conditionsFor(a, eventDate, fight.weightClass)
  const condB = conditionsFor(b, eventDate, fight.weightClass)
  const change = whatCouldChange({
    tags: tags.map((t) => t.label),
    priorMin: results ? Math.min(results.priorA, results.priorB) : null,
    rangeWidth: results?.probLo !== undefined && results.probHi !== undefined ? results.probHi - results.probLo : null,
    marketGapPoints: results && market ? (results.probA - market.pA) * 100 : null,
    conditions: [...condA, ...condB],
  })
  const pathsA = pathsToVictory(a, b)
  const pathsB = pathsToVictory(b, a)
  const news = fight.bout?.news ?? []

  return (
    <section className="matchup" aria-label="Matchup context">
      <h3>Matchup context</h3>
      {careers.status === 'loading' && <p className="muted">Loading fighter histories…</p>}
      {careers.status === 'missing' && <p className="muted">Fighter histories are not available right now.</p>}
      {careers.status === 'ready' && (
        <div className="mu-cols">
          <Side name={fight.a.name} career={a} corner="a" eventDate={eventDate} boutClass={fight.weightClass} />
          <Side name={fight.b.name} career={b} corner="b" eventDate={eventDate} boutClass={fight.weightClass} />
        </div>
      )}

      {careers.status === 'ready' && (pathsA.length > 0 || pathsB.length > 0) && (
        <div className="paths">
          <h4>Paths to victory <span className="chip-status">Analysis, not a model input</span></h4>
          <div className="mu-cols">
            {([[fight.a.name, pathsA, 'a'], [fight.b.name, pathsB, 'b']] as const).map(([name, paths, corner]) => (
              <div key={name} className={`mu-side ${corner}`}>
                <h5>{name}</h5>
                {paths.length === 0 ? <p className="muted small">No clear pattern in the record.</p> : <ul>{paths.map((p) => <li key={p}>{p}</li>)}</ul>}
              </div>
            ))}
          </div>
          <p className="muted small">Read from each fighter’s own results and their opponent’s. The forecast above does not use these sentences; it uses the groups of factors listed under “Why”.</p>
        </div>
      )}

      <div className="could-change">
        <h4>What could change this forecast?</h4>
        <ul>{change.map((c) => <li key={c}>{c}</li>)}</ul>
      </div>

      <div className="news">
        <h4>Sourced news</h4>
        {news.length === 0 ? (
          <p className="muted small">No dated, sourced news is attached to this bout. News is added only with a publication date and a source; rumours are not.</p>
        ) : (
          <ul>
            {news.map((n) => (
              <li key={`${n.date}-${n.text}`}>
                <time dateTime={n.date}>{n.date}</time> {n.text}{' '}
                <span className="muted small">
                  {n.url ? <a href={n.url} target="_blank" rel="noopener noreferrer">{n.source}</a> : n.source}. Reported, not checked by OctaIQ.
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
