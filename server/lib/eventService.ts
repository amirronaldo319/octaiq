import { readFileSync } from 'node:fs'
import type { EventPayload, ResultsModel } from '../../src/engine/eventTypes.ts'
import { allChanges, buildEventFights, latestSnapshot, parseEventFile } from './event.ts'
import type { HistoryStore } from './oddsApi.ts'
import type { FighterProvider } from './providers.ts'
import type { CardService } from './service.ts'

export interface EventServiceDeps {
  eventPath: string
  cards: Pick<CardService, 'getOdds'>
  loadFighters: FighterProvider
  history: HistoryStore
  /** Backtested results-only model; omitted in tests that do not need it */
  resultsModel?: (inputs: { id: string; a: string; b: string; date: number }[]) => ResultsModel
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
              return deps.resultsModel(fights.map((f) => ({ id: f.id, a: f.a.name, b: f.b.name, date: eventDate })))
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
