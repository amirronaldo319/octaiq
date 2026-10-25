import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { EventPayload } from '../../src/engine/eventTypes.ts'
import { createResultsModelService } from '../backtest/resultsModel.ts'
import { createEventService } from './eventService.ts'
import { createMemoryHistory } from './history.ts'

export const STATIC_ODDS_REASON =
  'Public snapshot: live odds are not included. Run OctaIQ locally with your own API keys to see prices.'

/**
 * Builds the event payload for the public website. It deliberately uses no API keys and no licensed
 * statistics: odds are marked unavailable and fighter stats are empty, so only the card itself and the
 * backtested model (computed from an open dataset) appear.
 */
export async function buildStaticEvent(root: string, eventFile = 'data/events/ufc-vegas-123.json'): Promise<EventPayload> {
  const results = createResultsModelService(root)
  const service = createEventService({
    eventPath: resolve(root, eventFile),
    cards: { getOdds: async () => { throw new Error(STATIC_ODDS_REASON) } },
    loadFighters: async () => ({ fighters: [], warnings: [] }),
    history: createMemoryHistory(),
    resultsModel: (inputs) => results.predict(inputs),
  })
  return { ...(await service.getEvent()), static: true }
}

/** The saved backtest report, or null when it has not been generated. Refuses files with local paths. */
export function readBacktestForPublishing(root: string): string | null {
  const path = resolve(root, 'data/reports/backtest-latest.json')
  if (!existsSync(path)) return null
  const text = readFileSync(path, 'utf8')
  if (/\/Users\/|C:\\\\Users|\/home\//.test(text)) throw new Error('Backtest report contains a local file path; refusing to publish it.')
  return text
}
