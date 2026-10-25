/** The visitor's own picks, kept only in this browser. */
export interface MyPick {
  boutId: string
  side: 'a' | 'b'
  a: string
  b: string
  eventTitle: string
  at: number
  /** What the model and the market said when the pick was made, for A */
  modelProbA?: number
  marketProbA?: number
}

const KEY = 'octaiq.picks.v1'

export function loadPicks(): Record<string, MyPick> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed as Record<string, MyPick>).filter(([, p]) => p && (p.side === 'a' || p.side === 'b') && typeof p.a === 'string' && typeof p.b === 'string'))
  } catch {
    return {}
  }
}

export function savePicks(picks: Record<string, MyPick>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(picks))
  } catch {
    /* Picks just won't persist. */
  }
}

/** Returns new picks with this one set, or removed when the same side is chosen again. */
export function togglePick(picks: Record<string, MyPick>, pick: MyPick): Record<string, MyPick> {
  const next = { ...picks }
  if (next[pick.boutId]?.side === pick.side) delete next[pick.boutId]
  else next[pick.boutId] = pick
  return next
}

export interface Scorecard {
  graded: number
  yours: number
  model: number
  market: number
  marketGraded: number
}

/** Scores picks against fights that have a result. `winners` maps bout id to the winning side. */
export function score(picks: Record<string, MyPick>, winners: Record<string, 'a' | 'b'>): Scorecard {
  const card: Scorecard = { graded: 0, yours: 0, model: 0, market: 0, marketGraded: 0 }
  for (const p of Object.values(picks)) {
    const w = winners[p.boutId]
    if (!w) continue
    card.graded++
    if (p.side === w) card.yours++
    if (p.modelProbA !== undefined && (p.modelProbA >= 0.5) === (w === 'a')) card.model++
    if (p.marketProbA !== undefined) {
      card.marketGraded++
      if ((p.marketProbA >= 0.5) === (w === 'a')) card.market++
    }
  }
  return card
}
