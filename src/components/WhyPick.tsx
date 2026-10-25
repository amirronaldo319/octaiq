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
        Bar length is how hard each factor pushes the forecast. The factors overlap (a fighter with a high Elo usually has a good record too), so read
        this as a rough guide to the model, not a recipe.
      </p>
    </section>
  )
}
