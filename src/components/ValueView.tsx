import type { Opportunity, SideAnalysis } from '../lib/analysis'
import { fmtOdds, fmtPct, fmtSignedPct } from '../lib/format'

interface ValueViewProps {
  opportunities: readonly Opportunity[]
  minEdge: number
  onMinEdge: (v: number) => void
  kellyScale: number
  onKellyScale: (v: number) => void
  bankroll: number
  onBet: (side: SideAnalysis, fightLabel: string) => void
}

export function ValueView({ opportunities, minEdge, onMinEdge, kellyScale, onKellyScale, bankroll, onBet }: ValueViewProps) {
  return (
    <section aria-label="Value bets">
      <div className="controls panel">
        <label>
          Minimum edge: <strong>{fmtPct(minEdge, 0)}</strong>
          <input type="range" min={0} max={0.15} step={0.01} value={minEdge}
            onChange={(e) => onMinEdge(Number(e.target.value))} />
        </label>
        <label>
          Kelly fraction: <strong>{kellyScale === 1 ? 'Full' : `${kellyScale}x`}</strong>
          <input type="range" min={0.1} max={1} step={0.05} value={kellyScale}
            onChange={(e) => onKellyScale(Number(e.target.value))} />
        </label>
      </div>

      {opportunities.length === 0 ? (
        <p className="empty">No bets clear a {fmtPct(minEdge, 0)} edge. Lower the threshold, or pass on this card.</p>
      ) : (
        <div className="table-wrap">
          <table className="tbl value-tbl">
            <thead>
              <tr>
                <th>Pick</th><th>Price</th><th>Model</th><th>Market</th><th>Edge</th><th>EV</th><th>Stake</th><th></th>
              </tr>
            </thead>
            <tbody>
              {opportunities.map((o) => (
                <tr key={`${o.fightId}-${o.side}`}>
                  <td>
                    <strong>{o.fighter.name}</strong>
                    <small className="block muted">vs {o.opponent} · {o.weightClass}</small>
                  </td>
                  <td>{fmtOdds(o.bestOdds)} <small className="muted">{o.bestBook}</small></td>
                  <td>{fmtPct(o.modelProb)}</td>
                  <td>{fmtPct(o.fairProb)}</td>
                  <td className="pos">{fmtSignedPct(o.edge)}</td>
                  <td className="pos">{fmtSignedPct(o.ev)}</td>
                  <td>${(o.kelly * bankroll).toFixed(2)}</td>
                  <td>
                    <button className="btn primary" onClick={() => onBet(o, `${o.fighter.name} vs ${o.opponent}`)}>
                      Log bet
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        Edge = model probability minus the implied probability of the best price. Stakes use fractional Kelly,
        capped at 5% of bankroll. Treat output as a learning tool: when a backtested model with more information than this baseline was compared with betting prices on past fights, the prices were more accurate (see Model health), so a large “edge” here is more likely model error than value.
      </p>
    </section>
  )
}
