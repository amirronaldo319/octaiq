import type { BacktestOutput } from '../../server/backtest/types'
import { withBase } from '../lib/fetchJson'
import { useJson } from '../lib/useJson'

const isBacktest = (b: unknown): boolean => typeof b === 'object' && b !== null && 'report' in b

/** The bucket of past picks with the same confidence as this one, and how often those picks won. */
export function bucketFor(
  confidence: number,
  reliability: readonly { lo: number; hi: number; n: number; observed: number }[],
): { lo: number; hi: number; n: number; observed: number } | undefined {
  return reliability.find((b) => confidence >= b.lo && (confidence < b.hi || b.hi >= 1))
}

/** "Picks this confident won X% of the time": how this pick's confidence has played out in the backtest. */
export function HitRate({ pickProb }: { pickProb: number }) {
  const bt = useJson<BacktestOutput>([withBase('api/backtest'), withBase('data/backtest.json')], isBacktest)
  if (bt.status !== 'ready') return null
  const model = bt.data.report.models.find((m) => m.id === bt.data.report.primary)
  const bucket = model ? bucketFor(pickProb, model.metrics.reliability) : undefined
  if (!bucket || bucket.n < 30) return null
  return (
    <p className="hitrate">
      <strong>{Math.round(bucket.lo * 100)}–{Math.round(bucket.hi * 100)}% picks have won {Math.round(bucket.observed * 100)}% of the time.</strong>{' '}
      <span className="muted small">That is the model’s record on {bucket.n.toLocaleString()} past fights where its favourite had about this much confidence.</span>
    </p>
  )
}
