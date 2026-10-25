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

/** US, extra US and EU books: together they cover the ten big sportsbooks (the EU region carries Pinnacle). */
export const ODDS_REGIONS = 'us,us2,eu'

/** The consensus averages at most this many bookmakers. */
export const MAX_BOOKS = 10

/**
 * Bookmakers in the order they are preferred when more than MAX_BOOKS quote a fight: the sharpest and
 * most widely used first. Any bookmaker not listed here fills remaining places alphabetically.
 */
export const PREFERRED_BOOKS: readonly string[] = [
  'pinnacle', 'draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'bovada',
  'betonlineag', 'betrivers', 'espnbet', 'fanatics', 'unibet_us', 'mybookieag',
]

export function oddsUrl(apiKey: string): string {
  const q = new URLSearchParams({ apiKey, regions: ODDS_REGIONS, markets: 'h2h', oddsFormat: 'american' })
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

const rankOf = (key: string): number => {
  const i = PREFERRED_BOOKS.indexOf(key)
  return i === -1 ? PREFERRED_BOOKS.length : i
}

/** Valid two-way quotes from at most `limit` bookmakers (preferred ones first), sorted by name. */
export function extractBooks(event: OddsEvent, limit = MAX_BOOKS): BookLine[] {
  const quotes: { key: string; line: BookLine }[] = []
  const seen = new Set<string>()
  for (const bm of event.bookmakers ?? []) {
    if (seen.has(bm.key)) continue
    const market = bm.markets?.find((m) => m.key === 'h2h')
    const a = market?.outcomes.find((o) => o.name === event.home_team)?.price
    const b = market?.outcomes.find((o) => o.name === event.away_team)?.price
    if (validAmerican(a) && validAmerican(b)) {
      seen.add(bm.key)
      quotes.push({ key: bm.key, line: { book: bm.title, a, b } })
    }
  }
  return quotes
    .sort((x, y) => rankOf(x.key) - rankOf(y.key) || x.line.book.localeCompare(y.line.book))
    .slice(0, limit)
    .map((q) => q.line)
    .sort((x, y) => x.book.localeCompare(y.book))
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
