import type { Fight } from './types'

export interface EventMeta {
  id: string
  title: string
  alias?: string
  venue: string
  city: string
  prelimsStart: string
  mainCardStart: string
  /** IANA zone of the venue, used to show start times where the fight happens */
  timeZone?: string
  timesNote?: string
  officialUrl?: string
}

export interface SnapshotBout {
  order: number
  card: 'main' | 'prelim'
  weightClass: string
  rounds: 3 | 5
  a: { name: string; record: string; rank?: number }
  b: { name: string; record: string; rank?: number }
  notes: string[]
}

export interface Verification {
  /** 'official' means the card was compared with the UFC's own event page */
  status: 'official' | 'unverified'
  checkedAt?: string
  url?: string
  note?: string
}

export interface Snapshot {
  version: number
  verification?: Verification
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
  kind: 'added' | 'removed' | 'opponent-changed' | 'placement-changed'
  description: string
  fromVersion: number
  toVersion: number
}

export interface JointOutcome {
  aKo: number
  aSub: number
  aDec: number
  bKo: number
  bSub: number
  bDec: number
}

/** A check of one outcome model against the simplest baseline, on past fights. */
export interface OutcomeCheck {
  n: number
  logLoss: number
  baselineLogLoss: number
  /** Model minus baseline log loss, with a 95% interval; negative means the model is better */
  gain: number
  gainLo: number
  gainHi: number
  accuracy: number
  baselineAccuracy: number
}

export interface ResultsModelBout {
  probA: number
  probB: number
  /** 90% range for probA from re-fitting on resampled history */
  probLo?: number
  probHi?: number
  /** Probability the fight goes the distance, and each (winner, method) outcome */
  distance?: number
  joint?: JointOutcome
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
      /** Share of winners called correctly, on the same priced bouts */
      marketAccuracy?: number
      modelAccuracy?: number
      /** Model minus market log loss with 95% interval; positive means worse than the market */
      gap: number
      gapLo: number
      gapHi: number
      blendGain?: { estimate: number; lo: number; hi: number }
    }
  }
  /** How well the goes-the-distance and method models did on past fights */
  outcomes?: { period: string; distance: OutcomeCheck; koShare: OutcomeCheck; joint: OutcomeCheck; note: string }
  bouts: Record<string, ResultsModelBout>
}

export interface EventPayload {
  event: EventMeta
  snapshot: Pick<Snapshot, 'version' | 'capturedAt' | 'source' | 'corroboration' | 'recordsSource' | 'unlisted' | 'verification'>
  fights: Fight[]
  changes: CardChange[]
  odds: { status: 'live' | 'unavailable'; reason?: string; fetchedAt?: string; quotaRemaining?: string; stale?: boolean }
  stats: { status: 'available' | 'partial' | 'none'; missing: string[]; warnings: string[] }
  resultsModel: ResultsModel
  /** True for the public website snapshot: no live odds or licensed stats */
  static?: boolean
  generatedAt: string
}

/** One row of the event picker. */
export interface EventSummary {
  id: string
  title: string
  alias?: string
  venue: string
  city: string
  mainCardStart: string
  /** IANA zone of the venue */
  timeZone?: string
  bouts: number
  verification: 'official' | 'unverified'
}

export interface EventIndex {
  defaultId: string
  events: EventSummary[]
}
