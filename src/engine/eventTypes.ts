import type { Fight } from './types'

export interface EventMeta {
  id: string
  title: string
  alias?: string
  venue: string
  city: string
  prelimsStart: string
  mainCardStart: string
  timesNote?: string
  officialUrl?: string
}

export interface SnapshotBout {
  order: number
  card: 'main' | 'prelim'
  weightClass: string
  rounds: 3 | 5
  a: { name: string; record: string }
  b: { name: string; record: string }
  notes: string[]
}

export interface Snapshot {
  version: number
  capturedAt: string
  source: string
  corroboration?: string
  recordsSource?: string
  bouts: SnapshotBout[]
  unlisted: string[]
}

export interface EventFile {
  event: EventMeta
  snapshots: Snapshot[]
}

export interface CardChange {
  kind: 'added' | 'removed' | 'opponent-changed'
  description: string
  fromVersion: number
  toVersion: number
}

export interface ResultsModelBout {
  probA: number
  probB: number
  priorA: number
  priorB: number
  /** Elo rating gap, A minus B */
  eloDiff: number
}

/** The backtested, results-only model. Distinct from the hand-weighted baseline that uses striking stats. */
export interface ResultsModel {
  status: 'available' | 'unavailable'
  reason?: string
  version: string
  /** Which feature set the model uses; stats features are used only if the backtest adopted them */
  features?: 'results' | 'results+stats'
  trainedThrough?: string
  trainedOn?: number
  backtest?: {
    period: string
    n: number
    logLoss: number
    logLossLo: number
    logLossHi: number
    coinLogLoss: number
    eloLogLoss: number
    /** Results-only model, for comparison when the stats model is primary */
    resultsOnlyLogLoss: number
    accuracy: number
    datasetRetrieved: string
    generatedAt: string
    /** Comparison with betting-market prices on matched past bouts, when available */
    market?: {
      period: string
      n: number
      marketLogLoss: number
      modelLogLoss: number
      /** Model minus market log loss with 95% interval; positive means worse than the market */
      gap: number
      gapLo: number
      gapHi: number
      blendGain?: { estimate: number; lo: number; hi: number }
    }
  }
  bouts: Record<string, ResultsModelBout>
}

export interface EventPayload {
  event: EventMeta
  snapshot: Pick<Snapshot, 'version' | 'capturedAt' | 'source' | 'corroboration' | 'recordsSource' | 'unlisted'>
  fights: Fight[]
  changes: CardChange[]
  odds: { status: 'live' | 'unavailable'; reason?: string; fetchedAt?: string; quotaRemaining?: string; stale?: boolean }
  stats: { status: 'available' | 'partial' | 'none'; missing: string[]; warnings: string[] }
  resultsModel: ResultsModel
  /** True for the public website snapshot: no live odds or licensed stats */
  static?: boolean
  generatedAt: string
}
