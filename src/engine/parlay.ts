import { americanToDecimal, decimalToAmerican } from './odds'

export interface ParlayLeg {
  label: string
  american: number
  modelProb: number
}

export interface ParlayResult {
  decimal: number
  american: number
  modelProb: number
  ev: number
}

/**
 * Independent-leg parlay. Legs from the same fight are correlated; callers
 * should not combine them and expect the product to be accurate.
 */
export function priceParlay(legs: readonly ParlayLeg[]): ParlayResult | null {
  if (legs.length === 0) return null
  const decimal = legs.reduce((acc, l) => acc * americanToDecimal(l.american), 1)
  const modelProb = legs.reduce((acc, l) => acc * l.modelProb, 1)
  return {
    decimal,
    american: decimalToAmerican(decimal),
    modelProb,
    ev: modelProb * (decimal - 1) - (1 - modelProb),
  }
}
