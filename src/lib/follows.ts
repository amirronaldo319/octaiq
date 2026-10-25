/** Fighters and bouts the visitor follows, kept only in this browser. */
export interface FollowedFighter {
  name: string
  at: number
}

export interface SavedBout {
  boutId: string
  eventId: string
  eventTitle: string
  a: string
  b: string
  at: number
}

export interface Follows {
  fighters: Record<string, FollowedFighter>
  bouts: Record<string, SavedBout>
}

const KEY = 'octaiq.follows.v1'
export const emptyFollows = (): Follows => ({ fighters: {}, bouts: {} })

export function loadFollows(): Follows {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (typeof raw !== 'object' || raw === null) return emptyFollows()
    const o = raw as Partial<Follows>
    const fighters = Object.fromEntries(Object.entries(o.fighters ?? {}).filter(([, f]) => f && typeof f.name === 'string'))
    const bouts = Object.fromEntries(Object.entries(o.bouts ?? {}).filter(([, b]) => b && typeof b.a === 'string' && typeof b.b === 'string' && typeof b.eventId === 'string'))
    return { fighters, bouts }
  } catch {
    return emptyFollows()
  }
}

export function saveFollows(f: Follows): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(f))
  } catch {
    /* Not remembered. */
  }
}

/** New state with the fighter followed, or unfollowed when already followed. */
export function toggleFighter(f: Follows, slug: string, name: string, now = Date.now()): Follows {
  const fighters = { ...f.fighters }
  if (fighters[slug]) delete fighters[slug]
  else fighters[slug] = { name, at: now }
  return { ...f, fighters }
}

export function toggleBout(f: Follows, bout: SavedBout): Follows {
  const bouts = { ...f.bouts }
  if (bouts[bout.boutId]) delete bouts[bout.boutId]
  else bouts[bout.boutId] = bout
  return { ...f, bouts }
}

export interface UpcomingBout {
  eventId: string
  eventTitle: string
  boutId: string
  start: string
  fighter: string
  opponent: string
}

interface EventLike {
  event: { id: string; title: string; prelimsStart: string; mainCardStart: string }
  fights: { id: string; a: { name: string }; b: { name: string }; bout?: { card: 'main' | 'prelim' } }[]
}

/** Each followed fighter's next bout across all known events, soonest first. Past events are skipped. */
export function nextBouts(follows: Follows, events: readonly EventLike[], slugify: (n: string) => string, now: number): UpcomingBout[] {
  const out: UpcomingBout[] = []
  for (const ev of events) {
    for (const f of ev.fights) {
      const start = f.bout?.card === 'prelim' ? ev.event.prelimsStart : ev.event.mainCardStart
      if (Date.parse(ev.event.mainCardStart) + 6 * 3_600_000 < now) continue
      for (const [mine, theirs] of [[f.a.name, f.b.name], [f.b.name, f.a.name]] as const) {
        if (follows.fighters[slugify(mine)]) out.push({ eventId: ev.event.id, eventTitle: ev.event.title, boutId: f.id, start, fighter: mine, opponent: theirs })
      }
    }
  }
  return out.sort((x, y) => Date.parse(x.start) - Date.parse(y.start))
}
