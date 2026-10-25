import { useState } from 'react'
import type { BacktestOutput } from '../../server/backtest/types'
import type { PublishedLedger } from '../../server/lib/snapshot'
import type { GradedEvent } from '../../server/ledger/grade'
import { withBase } from '../lib/fetchJson'
import { useJson } from '../lib/useJson'

const isLedger = (b: unknown): boolean => typeof b === 'object' && b !== null && Array.isArray((b as PublishedLedger).events)
const isBacktest = (b: unknown): boolean => typeof b === 'object' && b !== null && 'report' in b
const pct = (n: number): string => `${Math.round(n * 100)}%`
const when = (iso: string): string => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
const dayOnly = (iso: string): string => new Date(iso).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })

const STATUS: Record<GradedEvent['status'], string> = {
  upcoming: 'Locked in, waiting for the fights',
  'awaiting-results': 'Event is over, waiting for results to be published',
  graded: 'Graded',
}

function LiveEvent({ e }: { e: GradedEvent }) {
  return (
    <section className="rec-event" aria-label={e.title}>
      <header>
        <h3>{e.title}</h3>
        <span className={`chip-status s-${e.status}`}>{STATUS[e.status]}</span>
      </header>
      <p className="muted small">
        {e.scoredEntryAt ? `Picks saved ${when(e.scoredEntryAt)}` : 'No picks saved yet'}
        {e.entries > 1 ? ` (the latest of ${e.entries} versions made before the event)` : ''}. Locked from {when(e.lockedAt)}.
        {e.status === 'graded' && e.graded > 0 && <> <strong>{e.correct} of {e.graded} winners picked correctly.</strong></>}
      </p>
      <ul className="rec-bouts">
        {e.bouts.map((b) => {
          const pickA = b.probA >= 0.5
          return (
            <li key={b.id}>
              <span className="rec-names">
                <span className={pickA ? 'picked' : ''}>{b.a}</span> <em>vs</em> <span className={!pickA ? 'picked' : ''}>{b.b}</span>
              </span>
              <span className="rec-pick">{pickA ? b.a : b.b} {pct(pickA ? b.probA : 1 - b.probA)}</span>
              <span className="rec-result">
                {b.correct === undefined
                  ? <span className="muted">{b.result === 'draw' || b.result === 'nc' ? 'Not graded' : 'Pending'}</span>
                  : <span className={b.correct ? 'ok' : 'miss'}>{b.correct ? 'Correct' : 'Missed'}</span>}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function TrackRecord() {
  const ledger = useJson<PublishedLedger>([withBase('data/ledger.json')], isLedger)
  const backtest = useJson<BacktestOutput>([withBase('api/backtest'), withBase('data/backtest.json')], isBacktest)
  const [open, setOpen] = useState<string | null>(null)

  const events = ledger.status === 'ready' ? ledger.data.events : []
  const saved = events.reduce((n, e) => n + (e.scoredEntryAt ? e.bouts.length : 0), 0)
  const graded = ledger.status === 'ready' ? ledger.data.graded : 0
  const correct = ledger.status === 'ready' ? ledger.data.correct : 0
  const recent = backtest.status === 'ready' ? backtest.data.recentEvents : []
  const nextLock = events
    .filter((e) => Date.parse(e.lockedAt) > Date.now())
    .sort((a, b) => Date.parse(a.lockedAt) - Date.parse(b.lockedAt))[0]

  return (
    <section className="record" aria-label="Track record">
      <header className="health-head">
        <h1>Track record</h1>
        <p className="lead">
          Predictions are saved before each event and can’t be edited afterwards: the file’s history is public on GitHub. Once the fights are
          in the open results data, each pick is graded.
          {ledger.status === 'ready' && (
            <> <a href={ledger.data.historyUrl} target="_blank" rel="noopener noreferrer">See the history</a>.</>
          )}
        </p>
      </header>

      <div className="kpis">
        <div className="kpi">
          <span>Saved before events</span>
          <strong>{saved}</strong>
          <em>picks across {events.filter((e) => e.scoredEntryAt).length} events</em>
        </div>
        <div className="kpi">
          <span>Graded so far</span>
          <strong>{graded === 0 ? 'None yet' : `${correct} of ${graded}`}</strong>
          <em>{graded === 0 ? 'Grading starts when the first event is in the results data' : `${pct(correct / graded)} of winners picked correctly. A small sample, so don’t read much into it`}</em>
        </div>
        {nextLock && (
          <div className="kpi">
            <span>Next lock</span>
            <strong>{new Date(nextLock.lockedAt).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })}</strong>
            <em>{nextLock.title}</em>
          </div>
        )}
      </div>

      <h2 className="section-title">Recorded live</h2>
      {ledger.status === 'loading' && <p className="muted">Loading…</p>}
      {ledger.status === 'missing' && <p className="empty">No ledger is published yet. It starts when the first predictions are recorded.</p>}
      {events.map((e) => <LiveEvent key={e.eventId} e={e} />)}

      <h2 className="section-title">Replay of the last {recent.length || 6} events</h2>
      <p className="muted small">
        These picks were made by a model that had not seen the event or anything after it. They are a replay of the test, not a live record, and
        they show how a typical card goes: expect a good share of misses.
      </p>
      {backtest.status === 'ready' && recent.length === 0 && <p className="empty">No replay data in this report.</p>}
      <ul className="replay">
        {recent.map((e) => (
          <li key={e.event} className="replay-item">
            <button type="button" className="replay-head" aria-expanded={open === e.event} onClick={() => setOpen(open === e.event ? null : e.event)}>
              <span className="replay-name"><strong>{e.event}</strong><small className="muted">{dayOnly(e.date)}</small></span>
              <span className="replay-score">{e.bouts.filter((b) => b.correct).length} of {e.bouts.length}</span>
              <span className="replay-bar" aria-hidden="true"><span style={{ width: pct(e.accuracy) }} /></span>
            </button>
            {open === e.event && (
              <ul className="rec-bouts">
                {e.bouts.map((b) => {
                  const pickA = b.probA >= 0.5
                  return (
                    <li key={`${b.a}-${b.b}`}>
                      <span className="rec-names"><span className={pickA ? 'picked' : ''}>{b.a}</span> <em>vs</em> <span className={!pickA ? 'picked' : ''}>{b.b}</span></span>
                      <span className="rec-pick">{pickA ? b.a : b.b} {pct(pickA ? b.probA : 1 - b.probA)}</span>
                      <span className="rec-result"><span className={b.correct ? 'ok' : 'miss'}>{b.correct ? 'Correct' : 'Missed'}</span></span>
                    </li>
                  )
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
