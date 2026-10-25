import type { Highlight } from '../lib/primary'

export function Highlights({ items, onOpen }: { items: readonly Highlight[]; onOpen: (id: string) => void }) {
  if (items.length === 0) return null
  return (
    <section className="highlights" aria-label="Card highlights">
      {items.map((h) => (
        <button key={h.key} type="button" className="highlight" onClick={() => onOpen(h.fightId)}>
          <span className="hl-title">{h.title}</span>
          <span className="hl-value">{h.value}</span>
          <span className="hl-detail">{h.detail}</span>
        </button>
      ))}
    </section>
  )
}
