export interface GapRow {
  id: string
  order: number
  nameA: string
  nameB: string
  modelProbA: number
  marketProbA: number
  books: number
}

const pct = (n: number): string => `${Math.round(n * 100)}%`

/** Where the model and the betting market disagree most on this card. */
export function GapsView({ rows, hasMarket, onOpen }: { rows: GapRow[]; hasMarket: boolean; onOpen: (id: string) => void }) {
  const sorted = [...rows].sort((x, y) => Math.abs(y.modelProbA - y.marketProbA) - Math.abs(x.modelProbA - x.marketProbA))
  return (
    <section className="gaps" aria-label="Model versus market">
      <header className="health-head">
        <h1>Model versus market</h1>
        <p className="lead">
          Where this model and the betting market disagree most on the selected card. In past tests the market was the more accurate of the two, so a big gap
          is more often the model missing something than the market being wrong. It is a place to look, not a bet.
        </p>
      </header>
      {!hasMarket || sorted.length === 0 ? (
        <p className="empty">Betting prices are not published for this card yet. They appear after the next scheduled price check.</p>
      ) : (
        <table className="tbl gap-table">
          <thead><tr><th>Bout</th><th>Model says</th><th>Market says</th><th>Gap</th></tr></thead>
          <tbody>
            {sorted.map((r) => {
              const gap = (r.modelProbA - r.marketProbA) * 100
              const likes = gap >= 0 ? r.nameA : r.nameB
              return (
                <tr key={r.id}>
                  <td><button type="button" className="linklike" onClick={() => onOpen(r.id)}>{r.nameA} vs {r.nameB}</button></td>
                  <td>{r.nameA} {pct(r.modelProbA)}</td>
                  <td>{r.nameA} {pct(r.marketProbA)} <small className="muted">({r.books} books)</small></td>
                  <td className={Math.abs(gap) >= 8 ? 'neg' : ''}>{Math.abs(gap) < 1 ? 'Agree' : `${Math.abs(gap).toFixed(0)} pts more on ${likes}`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
