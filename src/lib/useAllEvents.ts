import { useEffect, useState } from 'react'
import type { EventIndex, EventPayload } from '../engine/eventTypes'
import { getFirstJson, withBase } from './fetchJson'

export type AllEvents = { status: 'idle' | 'loading' | 'missing' } | { status: 'ready'; events: EventPayload[] }

const isIndex = (b: unknown): boolean => typeof b === 'object' && b !== null && Array.isArray((b as EventIndex).events)
const isEvent = (b: unknown): boolean => typeof b === 'object' && b !== null && Array.isArray((b as EventPayload).fights) && typeof (b as EventPayload).event === 'object'

/** Every event the site knows about, loaded only when `enabled`, for things that span cards such as followed fighters. */
export function useAllEvents(enabled: boolean): AllEvents {
  const [state, setState] = useState<AllEvents>({ status: 'idle' })
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    setState({ status: 'loading' })
    ;(async () => {
      const idx = await getFirstJson([withBase('api/events'), withBase('data/events.json')], isIndex, controller.signal)
      if (!idx) return setState({ status: 'missing' })
      const ids = (idx.result.body as EventIndex).events.map((e) => e.id)
      const loaded = await Promise.all(ids.map((id) => getFirstJson([withBase(`api/event?id=${encodeURIComponent(id)}`), withBase(`data/event-${id}.json`)], isEvent, controller.signal)))
      setState({ status: 'ready', events: loaded.flatMap((l) => (l ? [l.result.body as EventPayload] : [])) })
    })().catch((err: unknown) => {
      if ((err as Error).name !== 'AbortError') setState({ status: 'missing' })
    })
    return () => controller.abort()
  }, [enabled])
  return state
}
