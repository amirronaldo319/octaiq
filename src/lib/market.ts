import type { MarketBout, MarketFile } from '../../server/lib/marketSnapshot'

export type { MarketBout, MarketFile }

export const isMarketFile = (v: unknown): v is MarketFile =>
  typeof v === 'object' && v !== null && typeof (v as MarketFile).events === 'object' && (v as MarketFile).events !== null

/** Consensus for one bout, or undefined when nobody has priced it. */
export function marketFor(file: MarketFile | undefined, eventId: string | null, fightId: string): MarketBout | undefined {
  return eventId ? file?.events[eventId]?.[fightId] : undefined
}

/** How far the model sits from the market for fighter A, in percentage points (positive: model likes A more). */
export const gapPoints = (modelProbA: number, market: MarketBout): number => (modelProbA - market.pA) * 100
