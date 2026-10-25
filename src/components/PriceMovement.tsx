import type { PublishedPrices } from '../../server/lib/priceHistory'
import { withBase } from '../lib/fetchJson'
import { useJson } from '../lib/useJson'
import { LineChart } from './LineChart'

const isPrices = (b: unknown): boolean => typeof b === 'object' && b !== null && typeof (b as PublishedPrices).events === 'object'

/** How the betting-market consensus for fighter A has moved since this site first saw prices. Hidden until there are two looks. */
export function PriceMovement({ eventId, fightId, nameA }: { eventId: string; fightId: string; nameA: string }) {
  const prices = useJson<PublishedPrices>([withBase('data/prices.json')], isPrices)
  if (prices.status !== 'ready') return null
  const points = (prices.data.events[eventId] ?? []).filter((p) => p.bouts[fightId])
  if (points.length < 2) return null
  const values = points.map((p) => p.bouts[fightId].pA * 100)
  const move = values[values.length - 1] - values[0]
  return (
    <section className="movement" aria-label="Price movement">
      <h3>How the market has moved</h3>
      <LineChart values={values} label={`Betting-market chance for ${nameA} over ${values.length} looks`} formatValue={(v) => `${v.toFixed(0)}%`} />
      <p className="muted small">
        {nameA}: {values[0].toFixed(1)}% when first seen, {values[values.length - 1].toFixed(1)}% now ({move >= 0 ? '+' : ''}{move.toFixed(1)} points over {values.length} looks).
        Consensus of the bookmakers with their margin removed.
      </p>
    </section>
  )
}
