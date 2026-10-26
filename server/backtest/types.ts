import type { IngestStats } from './dataset.ts'
import type { Manifest } from './fetchDataset.ts'
import type { MarketReport } from './market.ts'
import type { RecentEvent } from './recent.ts'
import type { OddsManifest } from './oddsData.ts'
import type { BacktestReport } from './walkForward.ts'

/** Shape of data/reports/backtest-latest.json */
export interface BacktestOutput {
  generatedAt: string
  dataset: Manifest
  ingest: IngestStats
  report: BacktestReport
  predictionCount: number
  /** Same walk-forward run with different feature sets, to show where the signal comes from */
  ablations: Ablation[]
  /** Model versus betting-market prices on matched bouts; null when the odds dataset is unavailable */
  market: MarketReport | null
  oddsDataset: OddsManifest | null
  /** The last few test events with each pick and its result (retrospective, from the walk-forward) */
  recentEvents: RecentEvent[]
  /** Why the market comparison is missing, when it is */
  marketNote?: string
  /** What is needed to reproduce this report exactly */
  reproducibility?: Reproducibility
}

export interface Reproducibility {
  /** First 12 hex characters of the SHA-256 over the downloaded results files' own checksums */
  dataVersion: string
  oddsDataVersion: string | null
  featurePipeline: string
  codeCommit: string | null
  /** True when the working tree had uncommitted changes, so the commit alone does not reproduce the run */
  codeDirty?: boolean
  node: string
  seed: number
  /** Options that shaped the run, for the record */
  options: { firstTestYear: number; validationYears: number; ridge: number; bootstrap: number; eloK: number; statsDecay: number | null; excludedFeatures: string[] }
  command: string
}

export interface Ablation {
  label: string
  excluded: string[]
  n: number
  logLoss: number
  accuracy: number
  brier: number
  note: string
}
