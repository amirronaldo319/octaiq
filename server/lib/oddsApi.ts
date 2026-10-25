import { devig, probToAmerican } from '../../src/engine/odds.ts'
import type { BookLine, Fight, Fighter } from '../../src/engine/types.ts'
import { buildNameIndex, slugify, type NameIndex } from './names.ts'

/** Subset of The Odds API v4 `/sports/{sport}/odds` response that we rely on. */
export interface OddsEvent {
  id: string
  commence_time: string
  home_team: string
  away_team: string
  bookmakers: {
    key: string
    title: string
    markets: { key: string; outcomes: { name: string; price: number }[] }[]
  }[]
}

export const SPORT_KEY = 'mma_mixed_martial_arts'

export function oddsUrl(apiKey: string): string {
  const q = new URLSearchParams({ apiKey, regions: 'us', markets: 'h2h', oddsFormat: 'american' })
  return `https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/odds?${q.toString()}`
}

export interface HistoryStore {
  /** Append a consensus line and return the full series for the event. */
  record(eventId: string, americanLine: number): number[]
}

const validAmerican = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && Math.abs(n) >= 100

/** Placeholder used when a fighter has no row in the stats file. */
export function placeholderFighter(name: string, record = '—'): Fighter {
  return {
    id: slugify(name), name, record, age: 30, reachCm: 180, style: 'Counter', slpm: 3.5,
    strikeAcc: 0.45, strikeDef: 0.55, tdPer15: 1.5, tdDef: 0.65, subPer15: 0.5, finishRate: 0.5,
    chin: 0.65, cardio: 0.75, layoffDays: 300,
  }
}

export function extractBooks(event: OddsEvent): BookLine[] {
  const lines: BookLine[] = []
  for (const bm of event.bookmakers ?? []) {
    const market = bm.markets?.find((m) => m.key === 'h2h')
    const a = market?.outcomes.find((o) => o.name === event.home_team)?.price
    const b = market?.outcomes.find((o) => o.name === event.away_team)?.price
    if (validAmerican(a) && validAmerican(b)) lines.push({ book: bm.title, a, b })
  }
  return lines.sort((x, y) => x.book.localeCompare(y.book))
}

export function mapEvents(
  events: readonly OddsEvent[],
  fighters: readonly Fighter[],
  history: HistoryStore,
  now = new Date(),
): Fight[] {
  const index: NameIndex<Fighter> = buildNameIndex(fighters, (f) => f.name)
  const fights: Fight[] = []
  for (const event of events) {
    // Skip fights that already started: pre-fight odds no longer apply.
    if (Date.parse(event.commence_time) <= now.getTime()) continue
    const books = extractBooks(event)
    if (books.length === 0) continue
    const statsA = index.find(event.home_team)
    const statsB = index.find(event.away_team)
    const fairA = books.map((l) => devig(l.a, l.b).a).reduce((s, v) => s + v, 0) / books.length
    fights.push({
      id: event.id,
      weightClass: 'MMA',
      rounds: 3,
      mainEvent: false,
      a: statsA ?? placeholderFighter(event.home_team),
      b: statsB ?? placeholderFighter(event.away_team),
      books,
      history: history.record(event.id, probToAmerican(fairA)),
      commenceTime: event.commence_time,
      statsMissing: !statsA || !statsB,
    })
  }
  return fights.sort((x, y) => Date.parse(x.commenceTime ?? '') - Date.parse(y.commenceTime ?? ''))
}
