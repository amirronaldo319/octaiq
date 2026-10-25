import type { Leaderboard } from '../lib/analysis'

interface LeaderboardsProps {
  boards: readonly Leaderboard[]
  onSelect: (fightId: string) => void
}

export function Leaderboards({ boards, onSelect }: LeaderboardsProps) {
  const hasRows = boards.some((b) => b.rows.length > 0)
  return (
    <section className="panel" aria-label="Prediction leaderboards">
      <h3>Card leaderboards</h3>
      {!hasRows ? (
        <p className="empty">Rankings appear once fighter stats are loaded. Fights without stats are never ranked.</p>
      ) : (
        <div className="boards">
          {boards.map((b) => (
            <div key={b.title} className="board">
              <h4>{b.title}</h4>
              <p className="muted small">{b.explain}</p>
              <ol>
                {b.rows.map((r) => (
                  <li key={r.id}>
                    <button className="linklike" onClick={() => onSelect(r.id)}>{r.label}</button>
                    <span className="board-val">{r.value}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
