import type { IngestStats } from './dataset.ts'
import type { Manifest } from './fetchDataset.ts'
import type { MarketReport } from './market.ts'
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
  /** Why the market comparison is missing, when it is */
  marketNote?: string
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
