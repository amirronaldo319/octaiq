import type { EventSummary } from '../engine/eventTypes'
import { splitTitle } from './Hero'

const day = (iso: string, tz = 'America/New_York'): string => new Date(iso).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' })

/** One chip per event, soonest first. The chosen event is marked with aria-current. */
export function EventPicker({ events, selectedId, onSelect }: { events: readonly EventSummary[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (events.length < 2) return null
  const sorted = [...events].sort((a, b) => Date.parse(a.mainCardStart) - Date.parse(b.mainCardStart))
  return (
    <nav className="picker" aria-label="Choose an event">
      {sorted.map((e) => {
        const t = splitTitle(e.title)
        return (
          <button key={e.id} type="button" className={`picker-chip ${e.id === selectedId ? 'on' : ''}`} aria-current={e.id === selectedId ? 'true' : undefined} onClick={() => onSelect(e.id)}>
            <strong>{t.headline}</strong>
            <span>{day(e.mainCardStart, e.timeZone)}, {e.city}</span>
          </button>
        )
      })}
    </nav>
  )
}
