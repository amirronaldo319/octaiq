import { useCallback, useState } from 'react'
import { decimalToAmerican } from '../engine/odds'
import { fmtOdds } from './format'

export type OddsFormat = 'american' | 'decimal'

/** A fair price (no margin) for a probability, in the chosen format. */
export function fairPrice(p: number, format: OddsFormat): string {
  const clamped = Math.min(0.999, Math.max(0.001, p))
  const decimal = 1 / clamped
  return format === 'decimal' ? decimal.toFixed(2) : fmtOdds(decimalToAmerican(decimal))
}

/** A bookmaker's American price, shown in the chosen format. */
export function showPrice(american: number, format: OddsFormat): string {
  if (format === 'american') return fmtOdds(american)
  return (american > 0 ? 1 + american / 100 : 1 + 100 / -american).toFixed(2)
}

const KEY = 'octaiq.oddsFormat'
export function useOddsFormat(): [OddsFormat, (f: OddsFormat) => void] {
  const [format, setFormat] = useState<OddsFormat>(() => {
    try {
      return localStorage.getItem(KEY) === 'decimal' ? 'decimal' : 'american'
    } catch {
      return 'american'
    }
  })
  const set = useCallback((f: OddsFormat) => {
    setFormat(f)
    try {
      localStorage.setItem(KEY, f)
    } catch {
      /* Not remembered. */
    }
  }, [])
  return [format, set]
}
