import { impliedProb } from '../engine/odds'
import { computeStats, type Bet, type BetStatus } from '../lib/bets'
import { betProfit } from '../lib/bets'
import { fmtMoney, fmtOdds, fmtPct, fmtSignedMoney, fmtSignedPct } from '../lib/format'
import { LineChart } from './LineChart'

interface BankrollViewProps {
  bets: readonly Bet[]
  startingBankroll: number
  onStartingBankroll: (v: number) => void
  onSettle: (id: string, status: BetStatus) => void
  onDelete: (id: string) => void
}

export function BankrollView({ bets, startingBankroll, onStartingBankroll, onSettle, onDelete }: BankrollViewProps) {
  const stats = computeStats(bets, impliedProb)
  const openRisk = bets.filter((b) => b.status === 'open').reduce((s, b) => s + b.stake, 0)
  const current = startingBankroll + stats.profit

  return (
    <section aria-label="Bankroll and bet tracker">
      <div className="kpis">
        <div className="kpi"><span>Bankroll</span><strong>{fmtMoney(current)}</strong></div>
        <div className="kpi"><span>Profit</span><strong className={stats.profit >= 0 ? 'pos' : 'neg'}>{fmtSignedMoney(stats.profit)}</strong></div>
        <div className="kpi"><span>ROI</span><strong>{fmtSignedPct(stats.roi)}</strong></div>
        <div className="kpi"><span>Hit rate</span><strong>{stats.settled ? fmtPct(stats.hitRate, 0) : '–'}</strong></div>
        <div className="kpi"><span>Avg CLV</span><strong>{stats.avgClv === null ? '–' : fmtSignedPct(stats.avgClv)}</strong></div>
        <div className="kpi"><span>Max drawdown</span><strong>{fmtMoney(stats.maxDrawdown)}</strong></div>
        <div className="kpi"><span>At risk</span><strong>{fmtMoney(openRisk)}</strong></div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h3>Profit curve</h3>
          <LineChart values={[0, ...stats.curve]} label="Cumulative profit" baseline formatValue={fmtSignedMoney} />
        </div>
        <div className="panel">
          <h3>Starting bankroll</h3>
          <label className="inline">
            $<input type="number" min={1} value={startingBankroll}
              onChange={(e) => onStartingBankroll(Math.max(1, Number(e.target.value) || 1))} />
          </label>
          <p className="muted small">
            CLV (closing line value) measures whether you got a better price than the final no-vig market.
            Consistently positive CLV is the best evidence of a real edge.
          </p>
        </div>
      </div>

      <div className="panel">
        <h3>Bet log</h3>
        {bets.length === 0 ? (
          <p className="empty">No bets logged yet. Log one from a fight breakdown or the value board.</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Pick</th><th>Odds</th><th>Stake</th><th>Status</th><th>P/L</th><th></th></tr>
              </thead>
              <tbody>
                {[...bets].reverse().map((b) => (
                  <tr key={b.id}>
                    <td><strong>{b.pick}</strong><small className="block muted">{b.fightLabel}</small></td>
                    <td>{fmtOdds(b.american)}</td>
                    <td>{fmtMoney(b.stake)}</td>
                    <td>{b.status}</td>
                    <td className={betProfit(b) >= 0 ? 'pos' : 'neg'}>{b.status === 'open' ? '–' : fmtSignedMoney(betProfit(b))}</td>
                    <td className="actions">
                      {b.status === 'open' && (
                        <>
                          <button className="btn small" onClick={() => onSettle(b.id, 'won')}>Won</button>
                          <button className="btn small" onClick={() => onSettle(b.id, 'lost')}>Lost</button>
                          <button className="btn small" onClick={() => onSettle(b.id, 'push')}>Push</button>
                        </>
                      )}
                      <button className="btn small danger" onClick={() => onDelete(b.id)} aria-label={`Delete bet on ${b.pick}`}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
