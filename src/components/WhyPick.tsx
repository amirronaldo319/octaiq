import type { ResultsModelBout } from '../engine/eventTypes'

interface WhyPickProps {
  why: NonNullable<ResultsModelBout['why']>
  nameA: string
  nameB: string
}

/** Largest push on the forecast we draw at full width, in log-odds. */
const FULL_BAR = 1

function Factors({ title, items, tone }: { title: string; items: { text: string; strength: number }[]; tone: 'for' | 'against' }) {
  return (
    <div className={`why-col ${tone}`}>
      <h4>{title}</h4>
      {items.length === 0 ? (
        <p className="muted small">Nothing large enough to list.</p>
      ) : (
        <ul>
          {items.map((r) => (
            <li key={r.text}>
              <span>{r.text}</span>
              <span className="why-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (r.strength / FULL_BAR) * 100)}%` }} /></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Plain-language reasons behind a forecast: what pushes it toward the pick and what pushes against. */
export function WhyPick({ why, nameA, nameB }: WhyPickProps) {
  if (why.for.length === 0 && why.against.length === 0) return null
  const pick = why.pick === 'a' ? nameA : nameB
  return (
    <section className="why" aria-label="Why this pick">
      <h3>Why {pick}</h3>
      <div className="why-cols">
        <Factors title={`Pushing toward ${pick}`} items={why.for} tone="for" />
        <Factors title="Pushing the other way" items={why.against} tone="against" />
      </div>
      <p className="muted small">
        Bar length is how hard each group of factors pushes the forecast. These are patterns the model found in past results, not proven causes.
        Related factors are added together because they overlap: a fighter with a high Elo usually has a good record and tougher past opponents too,
        so their separate weights can even point in odd directions.
      </p>
      {why.details && why.details.length > 0 && (
        <details className="fold inline-fold">
          <summary>Every factor behind these groups</summary>
          <table className="tbl">
            <thead><tr><th>Factor</th><th>Group</th><th>Push on the pick</th></tr></thead>
            <tbody>
              {why.details.map((d) => (
                <tr key={d.text}><td>{d.text}</td><td>{d.family}</td><td className={d.strength >= 0 ? 'pos' : 'neg'}>{d.strength >= 0 ? 'For' : 'Against'} ({Math.abs(d.strength).toFixed(2)})</td></tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">A factor that seems to contradict another (for example “less UFC experience” helping while “weaker past opposition” hurts) is the model sorting out overlapping inputs. Only the group totals above are reliable.</p>
        </details>
      )}
    </section>
  )
}
