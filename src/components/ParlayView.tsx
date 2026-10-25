import { priceParlay, type ParlayLeg } from '../engine/parlay'
import { fmtOdds, fmtPct, fmtSignedPct } from '../lib/format'

export interface ParlayEntry extends ParlayLeg {
  fightId: string
}

interface ParlayViewProps {
  legs: readonly ParlayEntry[]
  onRemove: (index: number) => void
  onClear: () => void
  stake: number
  onStake: (v: number) => void
}

export function ParlayView({ legs, onRemove, onClear, stake, onStake }: ParlayViewProps) {
  const result = priceParlay(legs)
  return (
    <section aria-label="Parlay builder" className="panel">
      <h2>Parlay builder</h2>
      {legs.length === 0 ? (
        <p className="empty">Add legs from any fight breakdown. One leg per fight keeps the independence assumption fair.</p>
      ) : (
        <>
          <ul className="legs">
            {legs.map((l, i) => (
              <li key={`${l.fightId}-${l.label}`}>
                <span>{l.label}</span>
                <span>{fmtOdds(l.american)} · model {fmtPct(l.modelProb, 0)}</span>
                <button className="btn small" onClick={() => onRemove(i)} aria-label={`Remove ${l.label}`}>Remove</button>
              </li>
            ))}
          </ul>
          {result && (
            <dl className="summary">
              <dt>Combined price</dt><dd>{fmtOdds(result.american)}</dd>
              <dt>Model hit chance</dt><dd>{fmtPct(result.modelProb)}</dd>
              <dt>Expected value</dt><dd className={result.ev >= 0 ? 'pos' : 'neg'}>{fmtSignedPct(result.ev)}</dd>
              <dt>Payout on stake</dt>
              <dd>
                <label className="inline">
                  $<input type="number" min={1} value={stake} onChange={(e) => onStake(Math.max(1, Number(e.target.value) || 1))} />
                </label>
                {' → '}${(stake * result.decimal).toFixed(2)}
              </dd>
            </dl>
          )}
          {new Set(legs.map((l) => l.fightId)).size < legs.length && (
            <p className="warn" role="alert">Two legs share a fight. They are correlated, so the combined odds shown are unreliable.</p>
          )}
          <button className="btn" onClick={onClear}>Clear parlay</button>
        </>
      )}
    </section>
  )
}
