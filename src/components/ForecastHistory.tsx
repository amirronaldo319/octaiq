import type { PublishedLedger } from '../../server/lib/snapshot'
import { HORIZONS } from '../engine/horizons'
import { withBase } from '../lib/fetchJson'
import { pctPair } from '../lib/rounding'
import { useJson } from '../lib/useJson'
import { versionId } from '../lib/versions'

const isLedger = (b: unknown): boolean => typeof b === 'object' && b !== null && Array.isArray((b as PublishedLedger).events)
const when = (iso: string): string => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })

interface ForecastHistoryProps {
  eventId: string
  fightId: string
  nameA: string
  nameB: string
  /** The forecast the page is showing now, probability that A wins */
  currentProbA?: number
  /** A saved version the visitor opened from a link */
  version?: string
  onVersion: (id: string | undefined) => void
}

/** Every saved version of this bout's forecast: when it changed, why, and which one counts for grading. */
export function ForecastHistory({ eventId, fightId, nameA, nameB, currentProbA, version, onVersion }: ForecastHistoryProps) {
  const ledger = useJson<PublishedLedger>([withBase('data/ledger.json')], isLedger)
  if (ledger.status !== 'ready') return null
  const ev = ledger.data.events.find((e) => e.eventId === eventId)
  const versions = (ev?.history ?? []).filter((h) => h.probs[fightId] !== undefined)
  if (!ev || versions.length === 0) return null
  const newestFirst = [...versions].reverse()
  const lock = Date.parse(ev.lockedAt)
  const counted = [...versions].filter((h) => Date.parse(h.at) < lock).pop()
  const viewing = version ? versions.find((h) => versionId(h.at) === version) : undefined
  const pa = (p: number): string => `${pctPair(p)[0]}% ${nameA.split(' ').slice(-1)[0]}, ${pctPair(p)[1]}% ${nameB.split(' ').slice(-1)[0]}`

  return (
    <section className="fhist" aria-label="Forecast history">
      <h3>Forecast history</h3>
      {viewing && (
        <p className="banner viewing" role="status">
          <span>
            You are looking at the forecast saved {when(viewing.at)}: <strong>{pa(viewing.probs[fightId])}</strong>.
            {currentProbA !== undefined && <> The current forecast is {pa(currentProbA)}.</>}
          </span>
          <button type="button" className="btn small" onClick={() => onVersion(undefined)}>Back to current</button>
        </p>
      )}
      <p className="muted small">
        {currentProbA !== undefined && <>Current forecast: <strong>{pa(currentProbA)}</strong>. </>}
        {counted ? <>The saved version that counts for grading: <strong>{pa(counted.probs[fightId])}</strong>, saved {when(counted.at)}.</> : 'No saved version yet.'}
        {' '}Until the event starts, a newer version replaces the one that counts.
      </p>
      <ul className="fhist-list">
        {newestFirst.map((h, i) => {
          const prev = newestFirst[i + 1]
          const delta = prev ? (h.probs[fightId] - prev.probs[fightId]) * 100 : null
          return (
            <li key={h.at} className={counted?.at === h.at ? 'counts' : ''}>
              <span className="fh-when">{when(h.at)}</span>
              <span className="fh-prob">{pctPair(h.probs[fightId])[0]}% <small className="muted">{nameA.split(' ').slice(-1)[0]}</small>{delta !== null && Math.abs(delta) >= 0.05 && <small className={delta > 0 ? 'pos' : 'neg'}> {delta > 0 ? '+' : ''}{delta.toFixed(1)}</small>}</span>
              <span className="fh-why muted small">
                {h.reason}{counted?.at === h.at ? ' · counts for grading' : ''}
                <br />
                <span className="fh-meta">
                  {HORIZONS.find((x) => x.id === h.horizon)?.label ?? h.horizon} · {h.forecastId}{h.supersedes ? `, replaces ${h.supersedes}` : ', the first version'} · {h.model} · data {h.dataVersion ?? 'version not recorded'}{h.dataThrough ? ` through ${h.dataThrough}` : ''} ·
                  {' '}{h.horizonHours >= 0 ? `${h.horizonHours} hours before the main card` : 'after the main card started'}
                </span>
              </span>
              <button type="button" className="btn small" aria-pressed={viewing?.at === h.at} onClick={() => onVersion(versionId(h.at))}>View</button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
