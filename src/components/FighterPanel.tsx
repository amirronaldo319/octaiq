import { useState } from 'react'
import type { Career } from '../../server/backtest/careers'
import { Avatar } from './Avatar'
import { LineChart } from './LineChart'

interface FighterPanelProps {
  name: string
  status: 'loading' | 'ready' | 'missing'
  career?: Career
  onBack?: () => void
  backLabel?: string
}

const RESULT_LABEL: Record<string, string> = { W: 'Win', L: 'Loss', D: 'Draw', NC: 'No contest' }
const pct = (n: number): string => `${Math.round(n * 100)}%`
const INITIAL_ROWS = 10

export function FighterPanel({ name, status, career, onBack, backLabel = 'Back' }: FighterPanelProps) {
  const [showAll, setShowAll] = useState(false)

  return (
    <article className="fighter" aria-label={`${name}: career and rating history`}>
      <header className="fighter-head">
        {onBack && <button type="button" className="back" onClick={onBack}>{backLabel}</button>}
        <div className="fighter-id">
          <Avatar name={name} corner="n" size="lg" />
          <h2>{name}</h2>
        </div>
      </header>

      {status === 'loading' && <p className="muted">Loading career…</p>}
      {status === 'missing' && <p className="empty">Career data is not available right now.</p>}

      {status === 'ready' && career && !career.matched && (
        <p className="empty">
          No UFC fights were found for “{name}” in the results data. That could mean a UFC debut, or that the name is spelled differently there.
        </p>
      )}

      {status === 'ready' && career?.matched && (
        <>
          <p className="fighter-line">
            <strong>{career.wins}-{career.losses}{career.draws ? `-${career.draws}` : ''}</strong> in the UFC
            {career.noContests ? `, ${career.noContests} no contest${career.noContests > 1 ? 's' : ''}` : ''}.
            Wins: {career.koWins} by knockout, {career.subWins} by submission, {career.decisionWins} by decision.
          </p>

          <section className="fighter-section" aria-label="Rating history">
            <h3>Rating history</h3>
            <p className="muted small">
              An Elo score built from UFC results only: it rises with wins over strong opponents and falls with losses.
              Now <strong>{Math.round(career.eloNow ?? 0)}</strong>, best <strong>{Math.round(career.eloPeak ?? 0)}</strong>; 1500 is where a newcomer starts.
            </p>
            <LineChart values={career.eloSeries.map((p) => p.elo)} label={`${name} rating history`} formatValue={(v) => String(Math.round(v))} />
            {career.eloSeries.length > 1 && (
              <p className="chart-axis muted small"><span>{career.eloSeries[0].date}</span><span>{career.eloSeries[career.eloSeries.length - 1].date}</span></p>
            )}
          </section>

          {career.recent && (
            <section className="fighter-section" aria-label="Recent form">
              <h3>Last {career.recent.fights} fights with statistics</h3>
              <div className="form-tiles">
                <div><strong>{career.recent.sigLandedPerMin.toFixed(1)}</strong><span>strikes landed per minute</span></div>
                <div><strong>{career.recent.sigAbsorbedPerMin.toFixed(1)}</strong><span>absorbed per minute</span></div>
                <div><strong>{pct(career.recent.sigAccuracy)}</strong><span>strike accuracy</span></div>
                <div><strong>{career.recent.tdPer15.toFixed(1)}</strong><span>takedowns per 15 min</span></div>
                <div><strong>{career.recent.subPer15.toFixed(1)}</strong><span>submission tries per 15</span></div>
                <div><strong>{career.recent.netControl >= 0 ? '+' : ''}{pct(career.recent.netControl)}</strong><span>net control time</span></div>
              </div>
            </section>
          )}

          <section className="fighter-section" aria-label="Fight history">
            <h3>Fight history</h3>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Date</th><th>Opponent</th><th>Result</th><th>Method</th><th>Rating after</th></tr></thead>
                <tbody>
                  {(showAll ? career.timeline : career.timeline.slice(0, INITIAL_ROWS)).map((r) => (
                    <tr key={`${r.date}-${r.opponent}`}>
                      <td>{r.date}</td>
                      <td>{r.opponent}<small className="block muted">{r.event}</small></td>
                      <td><span className={`res res-${r.result.toLowerCase()}`}>{RESULT_LABEL[r.result]}</span></td>
                      <td>{r.result === 'W' || r.result === 'L' ? r.method : '–'}</td>
                      <td>{Math.round(r.eloAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {career.timeline.length > INITIAL_ROWS && (
              <button type="button" className="btn small" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show fewer' : `Show all ${career.timeline.length} fights`}
              </button>
            )}
          </section>

          <p className="muted small">
            UFC fights only; fights elsewhere are not counted. Source: the open results dataset described on the Model health page.
          </p>
        </>
      )}
    </article>
  )
}
