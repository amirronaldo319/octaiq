import { useCallback, useEffect, useState } from 'react'
import { FIGHTS } from '../data/card'
import type { EventPayload } from '../engine/eventTypes'
import type { Fight } from '../engine/types'

export type DataSource = 'demo' | 'live' | 'event'

export interface LiveMeta {
  fetchedAt: string
  quotaRemaining?: string
  stale: boolean
  warnings: string[]
  missingStats: string[]
}

export interface CardState {
  fights: Fight[]
  source: DataSource
  loading: boolean
  /** Why demo data is showing, when real data was expected */
  notice: string | null
  meta: LiveMeta | null
  event: EventPayload | null
  reload: () => void
}

interface ApiCard extends LiveMeta {
  fights: Fight[]
}

function isApiCard(v: unknown): v is ApiCard {
  return typeof v === 'object' && v !== null && Array.isArray((v as ApiCard).fights)
}

function isEventPayload(v: unknown): v is EventPayload {
  const e = v as EventPayload
  return typeof v === 'object' && v !== null && Array.isArray(e.fights) && typeof e.event === 'object' && e.event !== null
}

async function getJson(url: string, signal: AbortSignal): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(url, { signal })
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) }
}

type Loaded = Omit<CardState, 'reload' | 'loading'>

/** Loads the tracked event, then the live odds card, then demo data, in that order. */
export function useCard(): CardState {
  const [state, setState] = useState<Omit<CardState, 'reload'>>({
    fights: FIGHTS, source: 'demo', loading: true, notice: null, meta: null, event: null,
  })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const demo = (notice: string): Loaded => ({ fights: FIGHTS, source: 'demo', notice, meta: null, event: null })

    async function load(): Promise<Loaded> {
      const ev = await getJson('/api/event', controller.signal)
      if (ev.ok && isEventPayload(ev.body) && ev.body.fights.length > 0) {
        return { fights: ev.body.fights, source: 'event', notice: null, meta: null, event: ev.body }
      }
      const card = await getJson('/api/card', controller.signal)
      if (card.ok && isApiCard(card.body) && card.body.fights.length > 0) {
        return { fights: card.body.fights, source: 'live', notice: null, meta: card.body, event: null }
      }
      const msg = (card.body as { error?: string } | null)?.error
      return demo(msg ?? 'No upcoming MMA fights with odds right now.')
    }

    setState((s) => ({ ...s, loading: true }))
    load().then(
      (loaded) => setState({ ...loaded, loading: false }),
      (err: unknown) => {
        if ((err as Error).name === 'AbortError') return
        setState({ ...demo('The OctaIQ server is not running. Start it with `npm run server`.'), loading: false })
      },
    )
    return () => controller.abort()
  }, [tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload }
}
