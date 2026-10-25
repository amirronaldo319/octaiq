import { useCallback, useSyncExternalStore } from 'react'

export type Tab = 'event' | 'record' | 'health' | 'value' | 'parlay' | 'bankroll'

export interface Route {
  tab: Tab
  /** Which event the Event tab shows; absent means the next event */
  eventId?: string
  /** An open bout detail */
  boutId?: string
  /** An open fighter page (slug) */
  fighter?: string
}

const TABS: readonly Tab[] = ['event', 'record', 'health', 'value', 'parlay', 'bankroll']
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/

/** Parses the URL hash. Anything unrecognised falls back to the Event tab rather than throwing. */
export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p)
    } catch {
      return ''
    }
  })
  const [head, ...rest] = parts
  if (head === undefined || head === '') return { tab: 'event' }
  if (head !== 'event') return TABS.includes(head as Tab) && head !== 'event' ? { tab: head as Tab } : { tab: 'event' }

  const route: Route = { tab: 'event' }
  if (rest[0] && SAFE.test(rest[0]) && rest[0] !== 'bout' && rest[0] !== 'fighter') route.eventId = rest.shift()
  for (let i = 0; i + 1 < rest.length; i += 2) {
    const [key, value] = [rest[i], rest[i + 1]]
    if (!SAFE.test(value)) continue
    if (key === 'bout') route.boutId = value
    else if (key === 'fighter') route.fighter = value
  }
  return route
}

/** The canonical hash for a route; parseHash(buildHash(r)) returns r. */
export function buildHash(r: Route): string {
  if (r.tab !== 'event') return `#/${r.tab}`
  const segs = ['event']
  if (r.eventId) segs.push(encodeURIComponent(r.eventId))
  if (r.boutId) segs.push('bout', encodeURIComponent(r.boutId))
  if (r.fighter) segs.push('fighter', encodeURIComponent(r.fighter))
  return segs.length === 1 ? '#/' : `#/${segs.join('/')}`
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

/** The current route and a function that moves to another one. Back and forward work as the browser expects. */
export function useRoute(): [Route, (next: Route) => void] {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => '')
  const go = useCallback((next: Route) => {
    const target = buildHash(next)
    if (window.location.hash !== target) window.location.hash = target
  }, [])
  return [parseHash(hash), go]
}

/** Absolute, shareable URL for a route on the current page. */
export function shareUrl(r: Route): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}${buildHash(r)}`
}
