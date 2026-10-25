import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { EventIndex, EventPayload } from '../../src/engine/eventTypes.ts'
import { buildCareers, type Career } from '../backtest/careers.ts'
import { gradeLedger, summarizeLedgers, type GradedEvent, type LedgerSummary } from '../ledger/grade.ts'
import { readAllLedgers } from '../ledger/ledger.ts'
import { createResultsModelService, loadAliases, loadDataset } from '../backtest/resultsModel.ts'
import type { BacktestOutput } from '../backtest/types.ts'
import { buildEventIndex, createEventCatalog, listEventFiles } from './eventService.ts'
import { latestSnapshot, parseEventFile } from './event.ts'
import { createMemoryHistory } from './history.ts'

export const STATIC_ODDS_REASON =
  'Public snapshot: live odds are not included. Run OctaIQ locally with your own API keys to see prices.'

/**
 * Builds every event for the public website. It deliberately uses no API keys and no licensed
 * statistics: odds are marked unavailable and fighter stats are empty, so only the card itself and the
 * backtested model (computed from an open dataset) appear.
 */
export async function buildStaticEvents(
  root: string,
  options: { bootstrap?: number } = {},
): Promise<{ index: EventIndex; payloads: EventPayload[] }> {
  const results = createResultsModelService(root, { bootstrap: options.bootstrap ?? 0 })
  const dir = resolve(root, 'data/events')
  const catalog = createEventCatalog({
    dir,
    cards: { getOdds: async () => { throw new Error(STATIC_ODDS_REASON) } },
    loadFighters: async () => ({ fighters: [], warnings: [] }),
    history: createMemoryHistory(),
    resultsModel: (inputs) => results.predict(inputs),
  })
  const { errors, ...index } = buildEventIndex(dir, Date.now())
  if (errors.length > 0) throw new Error(`Invalid event files: ${errors.join('; ')}`)
  const payloads = await Promise.all(index.events.map(async (e) => ({ ...(await catalog.getEvent(e.id)), static: true })))
  return { index, payloads }
}

/** One event, for tests and quick checks. */
export async function buildStaticEvent(root: string, id?: string): Promise<EventPayload> {
  const { payloads, index } = await buildStaticEvents(root)
  const found = payloads.find((p) => p.event.id === (id ?? index.defaultId))
  if (!found) throw new Error(`Unknown event: ${id}`)
  return found
}

/** The saved backtest report, or null when it has not been generated. Refuses files with local paths. */
export function readBacktestForPublishing(root: string): string | null {
  const path = resolve(root, 'data/reports/backtest-latest.json')
  if (!existsSync(path)) return null
  const text = readFileSync(path, 'utf8')
  if (/\/Users\/|C:\\\\Users|\/home\//.test(text)) throw new Error('Backtest report contains a local file path; refusing to publish it.')
  return text
}

/**
 * Career timelines and Elo curves for every fighter on every event card, from the open results dataset.
 * Returns null when the dataset or the backtest report is missing.
 */
export function buildFighterCareers(root: string, index: EventIndex): Record<string, Career> | null {
  const reportPath = resolve(root, 'data/reports/backtest-latest.json')
  const data = loadDataset(root)
  if (!data || !existsSync(reportPath)) return null
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as BacktestOutput
  const names = new Set<string>()
  for (const f of listEventFiles(resolve(root, 'data/events')).files) {
    if (!index.events.some((e) => e.id === f.id)) continue
    for (const b of latestSnapshot(parseEventFile(JSON.parse(readFileSync(f.path, 'utf8')))).bouts) {
      names.add(b.a.name)
      names.add(b.b.name)
    }
  }
  return buildCareers(data.bouts, [...names], { eloK: report.report.eloK, aliases: loadAliases(root) })
}

/** One row per recently active fighter: [name, slug, wins, losses, draws, elo, lastFightDate, weightClass, koWins, subWins]. */
export type FighterIndexRow = [string, string, number, number, number, number, string, string, number, number]

export interface FighterIndex {
  generatedAt: string
  /** Fighters with a UFC fight on or after this date */
  activeSince: string
  rows: FighterIndexRow[]
}

const ACTIVE_YEARS = 3

/** A compact, searchable list of fighters active in the last few years, for search and comparison. */
export function buildFighterIndex(root: string, now: Date): FighterIndex | null {
  const reportPath = resolve(root, 'data/reports/backtest-latest.json')
  const data = loadDataset(root)
  if (!data || !existsSync(reportPath)) return null
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as BacktestOutput
  const since = Date.UTC(now.getUTCFullYear() - ACTIVE_YEARS, now.getUTCMonth(), now.getUTCDate())
  const names = new Map<string, string>()
  for (const b of data.bouts) {
    if (b.date < since) continue
    names.set(b.a, b.nameA)
    names.set(b.b, b.nameB)
  }
  const careers = buildCareers(data.bouts, [...names.values()], { eloK: report.report.eloK, aliases: loadAliases(root) })
  const rows: FighterIndexRow[] = Object.values(careers)
    .filter((c) => c.matched && c.timeline.length > 0 && c.eloNow !== null)
    .map((c): FighterIndexRow => {
      const last = c.timeline[0]
      return [c.name, c.slug, c.wins, c.losses, c.draws, c.eloNow as number, last.date, last.weightClass.replace(/ Bout$/, ''), c.koWins, c.subWins]
    })
    .sort((x, y) => y[5] - x[5])
  return { generatedAt: now.toISOString(), activeSince: new Date(since).toISOString().slice(0, 10), rows }
}

export interface PublishedLedger extends LedgerSummary {
  /** Where each ledger file's history can be inspected */
  historyUrl: string
}

/** The public track record: every ledger graded against the results data, as of `now`. */
export function buildPublishedLedger(root: string, now: Date, historyUrl: string): PublishedLedger {
  const data = loadDataset(root)
  const events: GradedEvent[] = readAllLedgers(root)
    .sort((a, b) => Date.parse(a.mainCardStart) - Date.parse(b.mainCardStart))
    .map((l) => gradeLedger(l, data?.bouts ?? [], now))
  return { ...summarizeLedgers(events), historyUrl }
}
