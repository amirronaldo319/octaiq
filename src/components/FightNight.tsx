import { useEffect, useState } from 'react'
import type { EventPayload } from '../engine/eventTypes'
import { resolveZone } from '../lib/timezone'
import { CompactList, type CompactItem } from './CompactList'

function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/** "2h 10m", "35m", or null once the time has passed. */
export function untilText(targetIso: string, now: number): string | null {
  const ms = Date.parse(targetIso) - now
  if (!(ms > 0)) return null
  const m = Math.floor(ms / 60_000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m % 60}m` : `${m}m`
}

/** Hours before the first bout when the site suggests fight-night view. */
export const FIGHT_DAY_HOURS = 14

export function isFightDay(payload: EventPayload, now: number): boolean {
  const first = Date.parse(payload.event.prelimsStart)
  const last = Date.parse(payload.event.mainCardStart) + 5 * 3_600_000
  return now >= first - FIGHT_DAY_HOURS * 3_600_000 && now <= last
}

interface FightNightProps {
  payload: EventPayload
  items: CompactItem[]
  zoneChoice: string
  onOpen: (id: string) => void
}

/**
 * The card in running order, prelims then the main card, with the start time of each part. Results are not tracked live
 * here: the site only learns outcomes when the open results data is updated, usually days later.
 */
export function FightNight({ payload, items, zoneChoice, onOpen }: FightNightProps) {
  const now = useNow(30_000)
  const { event } = payload
  const tz = resolveZone(zoneChoice, event.timeZone ?? 'America/New_York')
  const at = (iso: string): string => new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  const segment = (card: 'prelim' | 'main'): CompactItem[] =>
    items.filter((i) => (i.an.fight.bout?.card ?? 'main') === card).sort((x, y) => (y.an.fight.bout?.order ?? 0) - (x.an.fight.bout?.order ?? 0))
  const parts: { label: string; start: string; items: CompactItem[] }[] = [
    { label: 'Prelims', start: event.prelimsStart, items: segment('prelim') },
    { label: 'Main card', start: event.mainCardStart, items: segment('main') },
  ].filter((p) => p.items.length > 0)
  const next = parts.find((p) => Date.parse(p.start) > now)

  return (
    <section className="night" aria-label="Fight night">
      <p className="night-next" role="status">
        {next ? <>Next: <strong>{next.label}</strong> starts at {at(next.start)}, in <strong>{untilText(next.start, now)}</strong>.</> : <>Every part of the card has started.</>}
        {' '}<span className="muted small">Fights run from the top. Results are not tracked live here; they appear after the open results data updates, usually days later.</span>
      </p>
      {parts.map((p) => (
        <div key={p.label} className="night-part">
          <h2>{p.label} <small className="muted">{at(p.start)}</small></h2>
          <CompactList items={p.items} onOpen={onOpen} label={`${p.label}, in running order`} />
        </div>
      ))}
    </section>
  )
}
