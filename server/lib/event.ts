import { devig, probToAmerican } from '../../src/engine/odds.ts'
import type { CardChange, EventFile, EventSummary, Snapshot, SnapshotBout, Verification } from '../../src/engine/eventTypes.ts'
import type { BookLine, Fight, Fighter } from '../../src/engine/types.ts'
import { pickDefaultEvent } from '../../src/engine/pickEvent.ts'
import { buildNameIndex, sameName } from './names.ts'
import { extractBooks, placeholderFighter, type HistoryStore, type OddsEvent } from './oddsApi.ts'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

function validateBout(raw: unknown, where: string): SnapshotBout {
  if (!isObject(raw)) throw new Error(`${where}: bout must be an object`)
  const { order, card, weightClass, rounds, a, b, notes } = raw
  if (typeof order !== 'number') throw new Error(`${where}: order must be a number`)
  if (card !== 'main' && card !== 'prelim') throw new Error(`${where}: card must be "main" or "prelim"`)
  if (!isString(weightClass)) throw new Error(`${where}: weightClass is required`)
  if (rounds !== 3 && rounds !== 5) throw new Error(`${where}: rounds must be 3 or 5`)
  for (const [key, side] of [['a', a], ['b', b]] as const) {
    if (!isObject(side) || !isString(side.name)) throw new Error(`${where}: ${key}.name is required`)
  }
  const side = (s: unknown): { name: string; record: string; rank?: number } => {
    const o = s as Record<string, unknown>
    return {
      name: o.name as string,
      record: isString(o.record) ? o.record : '—',
      ...(typeof o.rank === 'number' ? { rank: o.rank } : {}),
    }
  }
  return {
    order, card, weightClass, rounds, a: side(a), b: side(b),
    notes: Array.isArray(notes) ? notes.filter(isString) : [],
  }
}

function parseVerification(raw: unknown): Verification | undefined {
  if (!isObject(raw)) return undefined
  if (raw.status !== 'official' && raw.status !== 'unverified') throw new Error('verification.status must be "official" or "unverified"')
  return {
    status: raw.status,
    ...(isString(raw.checkedAt) ? { checkedAt: raw.checkedAt } : {}),
    ...(isString(raw.url) ? { url: raw.url } : {}),
    ...(isString(raw.note) ? { note: raw.note } : {}),
  }
}

/** Validates an event file read from disk so a typo fails loudly instead of rendering a wrong card. */
export function parseEventFile(raw: unknown): EventFile {
  if (!isObject(raw) || !isObject(raw.event) || !Array.isArray(raw.snapshots)) throw new Error('Event file: expected { event, snapshots[] }')
  const ev = raw.event
  for (const key of ['id', 'title', 'venue', 'city', 'prelimsStart', 'mainCardStart']) {
    if (!isString(ev[key])) throw new Error(`Event file: event.${key} is required`)
  }
  if (raw.snapshots.length === 0) throw new Error('Event file: at least one snapshot is required')
  const snapshots: Snapshot[] = raw.snapshots.map((s: unknown, i: number) => {
    if (!isObject(s) || typeof s.version !== 'number' || !isString(s.capturedAt) || !isString(s.source) || !Array.isArray(s.bouts)) {
      throw new Error(`Event file: snapshot ${i} needs version, capturedAt, source and bouts`)
    }
    const bouts = s.bouts.map((b, j) => validateBout(b, `snapshot ${s.version} bout ${j + 1}`))
    const seen = new Set<number>()
    for (const b of bouts) {
      if (seen.has(b.order)) throw new Error(`snapshot ${s.version}: duplicate bout order ${b.order}`)
      seen.add(b.order)
    }
    return {
      version: s.version,
      verification: parseVerification(s.verification),
      capturedAt: s.capturedAt,
      source: s.source,
      corroboration: isString(s.corroboration) ? s.corroboration : undefined,
      recordsSource: isString(s.recordsSource) ? s.recordsSource : undefined,
      bouts,
      unlisted: Array.isArray(s.unlisted) ? s.unlisted.filter(isString) : [],
    }
  })
  return { event: raw.event as unknown as EventFile['event'], snapshots }
}

export function latestSnapshot(file: EventFile): Snapshot {
  return file.snapshots.reduce((best, s) => (s.version > best.version ? s : best))
}

const pairKey = (b: SnapshotBout): string => [b.a.name, b.b.name].map((n) => n.toLowerCase()).sort().join(' | ')

/** What changed between two card versions: new/removed pairings and changed opponents. */
export function diffSnapshots(prev: Snapshot, next: Snapshot): CardChange[] {
  const changes: CardChange[] = []
  const prevKeys = new Map(prev.bouts.map((b) => [pairKey(b), b]))
  const nextKeys = new Map(next.bouts.map((b) => [pairKey(b), b]))
  const addedBouts = next.bouts.filter((b) => !prevKeys.has(pairKey(b)))
  const removedBouts = prev.bouts.filter((b) => !nextKeys.has(pairKey(b)))
  const meta = { fromVersion: prev.version, toVersion: next.version }

  for (const [key, was] of prevKeys) {
    const now = nextKeys.get(key)
    if (now && now.card !== was.card) {
      changes.push({
        kind: 'placement-changed',
        description: `${now.a.name} vs. ${now.b.name} moved from the ${was.card === 'main' ? 'main card' : 'prelims'} to the ${now.card === 'main' ? 'main card' : 'prelims'}`,
        ...meta,
      })
    }
  }

  const handledRemoved = new Set<SnapshotBout>()
  for (const added of addedBouts) {
    const names = [added.a.name, added.b.name]
    const replaced = removedBouts.find((r) => !handledRemoved.has(r) && [r.a.name, r.b.name].some((n) => names.includes(n)))
    if (replaced) {
      handledRemoved.add(replaced)
      changes.push({
        kind: 'opponent-changed',
        description: `${replaced.a.name} vs. ${replaced.b.name} became ${added.a.name} vs. ${added.b.name}`,
        ...meta,
      })
    } else {
      changes.push({ kind: 'added', description: `${added.a.name} vs. ${added.b.name} added`, ...meta })
    }
  }
  for (const removed of removedBouts) {
    if (!handledRemoved.has(removed)) {
      changes.push({ kind: 'removed', description: `${removed.a.name} vs. ${removed.b.name} removed`, ...meta })
    }
  }
  return changes
}

export function allChanges(file: EventFile): CardChange[] {
  const sorted = [...file.snapshots].sort((x, y) => x.version - y.version)
  return sorted.slice(1).flatMap((s, i) => diffSnapshots(sorted[i], s))
}

function matchOdds(bout: SnapshotBout, odds: readonly OddsEvent[]): { event: OddsEvent; books: BookLine[] } | null {
  for (const event of odds) {
    const direct = sameName(event.home_team, bout.a.name) && sameName(event.away_team, bout.b.name)
    const reversed = sameName(event.home_team, bout.b.name) && sameName(event.away_team, bout.a.name)
    if (!direct && !reversed) continue
    const books = extractBooks(event)
    if (books.length === 0) continue
    return { event, books: reversed ? books.map((l) => ({ book: l.book, a: l.b, b: l.a })) : books }
  }
  return null
}

export interface BuildInput {
  file: EventFile
  snapshot: Snapshot
  fighters: readonly Fighter[]
  /** null when the odds provider is unavailable */
  odds: readonly OddsEvent[] | null
  history: HistoryStore
}

/** Joins the card snapshot with stats and odds. Missing pieces stay missing; nothing is invented. */
export function buildEventFights({ file, snapshot, fighters, odds, history }: BuildInput): Fight[] {
  const index = buildNameIndex(fighters, (f) => f.name)
  return [...snapshot.bouts]
    .sort((x, y) => x.order - y.order)
    .map((bout): Fight => {
      const statsA = index.find(bout.a.name)
      const statsB = index.find(bout.b.name)
      const market = odds ? matchOdds(bout, odds) : null
      const books = market?.books ?? []
      const fairA = books.length ? books.map((l) => devig(l.a, l.b).a).reduce((s, v) => s + v, 0) / books.length : null
      const side = (stats: Fighter | undefined, snap: SnapshotBout['a']): Fighter => {
        const base = stats
          ? { ...stats, name: snap.name, record: snap.record !== '—' ? snap.record : stats.record }
          : placeholderFighter(snap.name, snap.record)
        return snap.rank !== undefined ? { ...base, rank: snap.rank } : base
      }
      return {
        id: `${file.event.id}-${bout.order}`,
        weightClass: bout.weightClass,
        rounds: bout.rounds,
        mainEvent: bout.order === 1,
        a: side(statsA, bout.a),
        b: side(statsB, bout.b),
        books,
        history: market && fairA !== null ? history.record(`${file.event.id}:${market.event.id}`, probToAmerican(fairA)) : [],
        commenceTime: bout.card === 'main' ? file.event.mainCardStart : file.event.prelimsStart,
        statsMissing: !statsA || !statsB,
        bout: { order: bout.order, card: bout.card, notes: bout.notes, statsA: Boolean(statsA), statsB: Boolean(statsB), hasOdds: books.length > 0 },
      }
    })
}

/** One picker row for an event file, using its latest snapshot. */
export function summarizeEvent(file: EventFile): EventSummary {
  const snap = latestSnapshot(file)
  return {
    id: file.event.id,
    title: file.event.title,
    alias: file.event.alias,
    venue: file.event.venue,
    city: file.event.city,
    mainCardStart: file.event.mainCardStart,
    timeZone: file.event.timeZone,
    bouts: snap.bouts.length,
    verification: snap.verification?.status ?? 'unverified',
  }
}

export { pickDefaultEvent }
