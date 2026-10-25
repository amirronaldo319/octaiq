import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EventIndex, EventPayload, ResultsModel } from '../../src/engine/eventTypes.ts'
import { allChanges, buildEventFights, latestSnapshot, parseEventFile, pickDefaultEvent, summarizeEvent } from './event.ts'
import type { HistoryStore } from './oddsApi.ts'
import type { FighterProvider } from './providers.ts'
import type { CardService } from './service.ts'

export interface EventServiceDeps {
  eventPath: string
  cards: Pick<CardService, 'getOdds'>
  loadFighters: FighterProvider
  history: HistoryStore
  /** Backtested results-only model; omitted in tests that do not need it */
  resultsModel?: (inputs: { id: string; a: string; b: string; date: number; rounds: number; weightClass: string }[]) => ResultsModel
  now?: () => number
}

/** Builds the event payload. The event file is re-read each call so edits apply without a restart. */
export function createEventService(deps: EventServiceDeps): { getEvent: () => Promise<EventPayload> } {
  const now = deps.now ?? Date.now
  return {
    async getEvent() {
      const file = parseEventFile(JSON.parse(readFileSync(deps.eventPath, 'utf8')))
      const snapshot = latestSnapshot(file)
      const names = snapshot.bouts.flatMap((b) => [b.a.name, b.b.name])

      const odds = await deps.cards.getOdds().then(
        (snap) => ({ ok: true as const, snap }),
        (err: unknown) => ({ ok: false as const, reason: err instanceof Error ? err.message : 'Odds unavailable' }),
      )
      const stats = await deps.loadFighters(names).catch(() => ({ fighters: [], warnings: ['Fighter stats provider failed.'] }))

      const fights = buildEventFights({
        file,
        snapshot,
        fighters: stats.fighters,
        odds: odds.ok ? odds.snap.events : null,
        history: deps.history,
      })
      const missing = [
        ...new Set(fights.flatMap((f) => [!f.bout?.statsA ? f.a.name : null, !f.bout?.statsB ? f.b.name : null]).filter((n): n is string => n !== null)),
      ]
      const total = new Set(names).size
      const eventDate = Date.parse(file.event.mainCardStart)
      const resultsModel: ResultsModel = deps.resultsModel
        ? (() => {
            try {
              return deps.resultsModel(fights.map((f) => ({ id: f.id, a: f.a.name, b: f.b.name, date: eventDate, rounds: f.rounds, weightClass: f.weightClass })))
            } catch {
              return { status: 'unavailable' as const, reason: 'The results model failed to run; see the server log.', version: 'octa-results-lr-0.1', bouts: {} }
            }
          })()
        : { status: 'unavailable', reason: 'Not configured.', version: 'octa-results-lr-0.1', bouts: {} }
      return {
        event: file.event,
        snapshot: {
          version: snapshot.version,
          capturedAt: snapshot.capturedAt,
          source: snapshot.source,
          corroboration: snapshot.corroboration,
          recordsSource: snapshot.recordsSource,
          unlisted: snapshot.unlisted,
          verification: snapshot.verification,
        },
        fights,
        changes: allChanges(file),
        odds: odds.ok
          ? { status: 'live', fetchedAt: odds.snap.fetchedAt, quotaRemaining: odds.snap.quotaRemaining, stale: odds.snap.stale }
          : { status: 'unavailable', reason: odds.reason },
        stats: {
          status: missing.length === 0 ? 'available' : missing.length >= total ? 'none' : 'partial',
          missing,
          warnings: stats.warnings,
        },
        resultsModel,
        generatedAt: new Date(now()).toISOString(),
      }
    },
  }
}

export interface CatalogDeps extends Omit<EventServiceDeps, 'eventPath'> {
  /** Folder of event JSON files */
  dir: string
}

export interface EventFileInfo {
  path: string
  id: string
}

/** Event files in a folder, read fresh each call so adding a file needs no restart. Bad files are skipped and reported. */
export function listEventFiles(dir: string): { files: EventFileInfo[]; errors: string[] } {
  const files: EventFileInfo[] = []
  const errors: string[] = []
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const path = join(dir, name)
    try {
      files.push({ path, id: parseEventFile(JSON.parse(readFileSync(path, 'utf8'))).event.id })
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : 'invalid'}`)
    }
  }
  return { files, errors }
}

export function buildEventIndex(dir: string, now: number): EventIndex & { errors: string[] } {
  const { files, errors } = listEventFiles(dir)
  const events = files.map((f) => summarizeEvent(parseEventFile(JSON.parse(readFileSync(f.path, 'utf8')))))
  if (events.length === 0) throw new Error('No valid event files found')
  return { defaultId: pickDefaultEvent(events, now), events, errors }
}

/** Serves every event in a folder: an index, and a payload for any one id (default: the next event). */
export function createEventCatalog(deps: CatalogDeps): {
  getIndex: () => EventIndex & { errors: string[] }
  getEvent: (id?: string) => Promise<EventPayload>
} {
  const now = deps.now ?? Date.now
  return {
    getIndex: () => buildEventIndex(deps.dir, now()),
    async getEvent(id) {
      const index = buildEventIndex(deps.dir, now())
      const wanted = id ?? index.defaultId
      const file = listEventFiles(deps.dir).files.find((f) => f.id === wanted)
      if (!file) throw new Error(`Unknown event: ${wanted}`)
      return createEventService({ ...deps, eventPath: file.path }).getEvent()
    },
  }
}
