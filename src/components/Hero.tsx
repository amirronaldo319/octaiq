import { useEffect, useState } from 'react'
import type { EventPayload } from '../engine/eventTypes'
import { resolveZone, TZ_OPTIONS } from '../lib/timezone'

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function remaining(targetIso: string, now: number): { d: number; h: number; m: number } | null {
  const ms = Date.parse(targetIso) - now
  if (Number.isNaN(ms) || ms <= 0) return null
  return { d: Math.floor(ms / 86_400_000), h: Math.floor((ms % 86_400_000) / 3_600_000), m: Math.floor((ms % 3_600_000) / 60_000) }
}

/** "UFC Fight Night: Moicano vs. Nolan" becomes the headline "Moicano vs. Nolan" over "UFC Fight Night". */
export function splitTitle(title: string): { series: string; headline: string } {
  const at = title.indexOf(':')
  return at > 0 ? { series: title.slice(0, at).trim(), headline: title.slice(at + 1).trim() } : { series: '', headline: title }
}

const EASTERN = 'America/New_York'
const zone = (event: { timeZone?: string }): string => event.timeZone ?? EASTERN
const dayIn = (iso: string, tz: string): string => new Date(iso).toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' })
const timeIn = (iso: string, tz: string): string => new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })

/** Time at the venue, with US Eastern in brackets when that differs, since most viewers think in Eastern. */
export function venueTime(iso: string, tz: string): string {
  return tz === EASTERN ? timeIn(iso, tz) : `${timeIn(iso, tz)} (${timeIn(iso, EASTERN)})`
}

/** Time in the chosen zone. In the default "Venue time" mode the venue's time carries Eastern alongside. */
export function timeFor(iso: string, choice: string, venueZone: string): string {
  const tz = resolveZone(choice, venueZone)
  return choice === 'venue' ? venueTime(iso, venueZone) : timeIn(iso, tz)
}

interface HeroProps {
  payload: EventPayload
  onAbout: () => void
  /** When betting prices were last collected, if the site has them */
  marketUpdated?: string
  /** How current the prices are, in words, and a longer explanation for hover */
  marketLabel?: { label: string; detail: string; state: string }
  zoneChoice?: string
  onZoneChoice?: (id: string) => void
}

export function Hero({ payload, onAbout, marketUpdated, marketLabel, zoneChoice = 'venue', onZoneChoice }: HeroProps) {
  const now = useNow(30_000)
  const { event } = payload
  const { series, headline } = splitTitle(event.title)
  const left = remaining(event.mainCardStart, now)
  const verification = payload.snapshot.verification
  const verified = verification?.status === 'official'
  const checkedOn = verification?.checkedAt ? new Date(verification.checkedAt).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : ''

  return (
    <section className="hero" aria-label="Event overview">
      <div className="hero-main">
        <p className="hero-series">{[series, event.alias].filter(Boolean).join(', ')}</p>
        <h1 className="hero-title">{headline}</h1>
        <p className="hero-where">{event.venue}, {event.city}</p>
        <p className="hero-when">
          {dayIn(event.mainCardStart, resolveZone(zoneChoice, zone(event)))}. Early start {timeFor(event.prelimsStart, zoneChoice, zone(event))}. Main card {timeFor(event.mainCardStart, zoneChoice, zone(event))}.
          {onZoneChoice && (
            <label className="tz">
              <span>Show times in</span>
              <select value={zoneChoice} onChange={(e) => onZoneChoice(e.target.value)}>
                {TZ_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
          )}
        </p>
        <div className="hero-flags">
          {verified
            ? <button type="button" className="flag ok" onClick={onAbout}>Checked against ufc.com{checkedOn ? `, ${checkedOn}` : ''}</button>
            : <button type="button" className="flag" onClick={onAbout}>Card not verified against ufc.com</button>}
          {marketUpdated
            ? <button type="button" className={`flag ${marketLabel ? `m-${marketLabel.state}` : ''}`} title={marketLabel?.detail} onClick={onAbout}>{marketLabel ? `Prices: ${marketLabel.label.replace(/^Updated/, 'updated')}` : `Prices updated ${new Date(marketUpdated).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}</button>
            : payload.odds.status !== 'live' && <button type="button" className="flag" onClick={onAbout}>No live odds</button>}
          {payload.static && <button type="button" className="flag" onClick={onAbout}>Public snapshot</button>}
        </div>
      </div>
      <div className="countdown" aria-label="Time until the main card" role="timer">
        {left ? (
          <>
            <div><strong>{left.d}</strong><span>days</span></div>
            <div><strong>{String(left.h).padStart(2, '0')}</strong><span>hours</span></div>
            <div><strong>{String(left.m).padStart(2, '0')}</strong><span>minutes</span></div>
          </>
        ) : (
          <div className="countdown-done"><strong>Underway</strong><span>or finished</span></div>
        )}
      </div>
    </section>
  )
}

export function AboutData({ payload, open, onToggle, marketAttribution }: { payload: EventPayload; open: boolean; onToggle: (open: boolean) => void; marketAttribution?: string }) {
  const { event, snapshot, odds, stats, changes } = payload
  return (
    <details className="about" id="about" open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>About this data and its limits</summary>
      <div className="about-body">
        {payload.static && (
          <p>
            <strong>This is a public snapshot.</strong> It has no live odds and no licensed fighter statistics, so it shows the card and the
            backtested model only. For prices and the full breakdown, run OctaIQ yourself with your own keys:{' '}
            <a href="https://github.com/amirronaldo319/octaiq" target="_blank" rel="noopener noreferrer">source and setup</a>.
            Generated {new Date(payload.generatedAt).toLocaleString()}.
          </p>
        )}
        <h4>Where the card comes from</h4>
        <p>{snapshot.source}</p>
        {snapshot.verification && <p><strong>{snapshot.verification.status === 'official' ? 'Checked against the official page.' : 'Not checked against the official page.'}</strong> {snapshot.verification.note}</p>}
        {snapshot.corroboration && <p>{snapshot.corroboration}</p>}
        {snapshot.recordsSource && <p>{snapshot.recordsSource}</p>}
        {event.timesNote && <p>{event.timesNote}</p>}
        {event.officialUrl && (
          <p>
            <a href={event.officialUrl} target="_blank" rel="noopener noreferrer">Open the official UFC event page</a> and compare it with this card before relying on it.
          </p>
        )}
        {snapshot.unlisted.length > 0 && (
          <>
            <h4>Reported, but not on this card</h4>
            <ul>{snapshot.unlisted.map((u) => <li key={u}>{u}</li>)}</ul>
          </>
        )}
        <h4>Changes between card versions</h4>
        {changes.length === 0
          ? <p>Only one version exists, so there is no change history yet.</p>
          : <ul>{changes.map((c) => <li key={c.description}>Version {c.fromVersion} to {c.toVersion}: {c.description}</li>)}</ul>}
        <h4>Data status</h4>
        <ul>
          <li>Odds: {odds.status === 'live' ? 'live' : marketAttribution ?? `unavailable. ${odds.reason ?? ''}`}</li>
          <li>Fighter statistics: {stats.status === 'available' ? 'complete' : stats.status === 'partial' ? `${stats.missing.length} fighters missing` : 'not loaded'}</li>
          {stats.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      </div>
    </details>
  )
}
