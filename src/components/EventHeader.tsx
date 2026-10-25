import { useEffect, useState } from 'react'
import type { EventPayload } from '../engine/eventTypes'

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function countdown(targetIso: string, now: number): string {
  const ms = Date.parse(targetIso) - now
  if (Number.isNaN(ms)) return '–'
  if (ms <= 0) return 'Started'
  const days = Math.floor(ms / 86_400_000)
  const hours = Math.floor((ms % 86_400_000) / 3_600_000)
  const mins = Math.floor((ms % 3_600_000) / 60_000)
  return `${days}d ${hours}h ${mins}m`
}

const when = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })

export function EventHeader({ payload }: { payload: EventPayload }) {
  const now = useNow(30_000)
  const { event, snapshot, odds, stats, changes } = payload
  const notes = payload.fights.reduce((n, f) => n + (f.bout?.notes.length ?? 0), 0)

  return (
    <section className="event-head" aria-label="Event overview">
      <div className="eh-main">
        <p className="eyebrow">{event.alias ?? 'UFC'} · Intelligence Center</p>
        <h2>{event.title}</h2>
        <p className="muted">{event.venue}, {event.city}</p>
        <p className="muted small">
          Prelims {when(event.prelimsStart)} · Main card {when(event.mainCardStart)}
        </p>
      </div>
      <div className="eh-count" aria-label="Time until main card">
        <span>Main card in</span>
        <strong>{countdown(event.mainCardStart, now)}</strong>
      </div>
      <dl className="eh-status">
        <div><dt>Card snapshot</dt>
          <dd>v{snapshot.version} · {new Date(snapshot.capturedAt).toLocaleDateString()} · <span className="warn-text">unverified vs ufc.com</span></dd></div>
        <div><dt>Odds</dt>
          <dd>
            {odds.status === 'live'
              ? `Live · ${odds.fetchedAt ? new Date(odds.fetchedAt).toLocaleTimeString() : ''}${odds.stale ? ' (stale)' : ''}${odds.quotaRemaining ? ` · ${odds.quotaRemaining} credits` : ''}`
              : <span className="warn-text">Unavailable · {odds.reason}</span>}
          </dd></div>
        <div><dt>Fighter stats</dt>
          <dd>
            {stats.status === 'available' && 'All fighters covered'}
            {stats.status === 'partial' && <span className="warn-text">{stats.missing.length} of {payload.fights.length * 2} fighters missing</span>}
            {stats.status === 'none' && <span className="warn-text">None loaded · model off</span>}
          </dd></div>
        <div><dt>Model</dt>
          <dd>octa-baseline-0.1 · unvalidated</dd></div>
      </dl>

      <details className="eh-provenance">
        <summary>Sources, discrepancies and card changes ({notes + snapshot.unlisted.length + changes.length + stats.warnings.length})</summary>
        <p className="small"><strong>Card source:</strong> {snapshot.source}</p>
        {snapshot.corroboration && <p className="small"><strong>Corroboration:</strong> {snapshot.corroboration}</p>}
        {snapshot.recordsSource && <p className="small"><strong>Records:</strong> {snapshot.recordsSource}</p>}
        {event.timesNote && <p className="small"><strong>Times:</strong> {event.timesNote}</p>}
        {snapshot.unlisted.length > 0 && (
          <>
            <h4>Reported but not on the card</h4>
            <ul className="reasons">{snapshot.unlisted.map((u) => <li key={u}>{u}</li>)}</ul>
          </>
        )}
        <h4>Card changes between versions</h4>
        {changes.length === 0
          ? <p className="muted small">Only one snapshot exists, so there is no change history yet. Add a new snapshot to data/events/ to track changes.</p>
          : <ul className="reasons">{changes.map((c) => <li key={c.description}>v{c.fromVersion} → v{c.toVersion}: {c.description}</li>)}</ul>}
        {stats.warnings.length > 0 && (
          <>
            <h4>Data warnings</h4>
            <ul className="reasons">{stats.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </>
        )}
        {event.officialUrl && (
          <p className="small"><a href={event.officialUrl} target="_blank" rel="noopener noreferrer">Official UFC event page</a> (check it before relying on this card)</p>
        )}
      </details>
    </section>
  )
}
