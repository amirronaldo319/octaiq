/** Conversions between odds formats and probabilities, for the odds calculator. */

export type OddsFormat = 'american' | 'decimal' | 'fractional'

export interface ParsedOdds {
  /** Implied probability including the bookmaker's margin */
  implied: number
  decimal: number
  american: number
}

const americanToDecimal = (a: number): number => (a > 0 ? 1 + a / 100 : 1 + 100 / -a)

/** Parses one odds value; null when it is not valid for the format. */
export function parseOdds(text: string, format: OddsFormat): ParsedOdds | null {
  const t = text.trim()
  if (!t) return null
  let decimal: number
  if (format === 'american') {
    if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return null
    const a = Number(t)
    if (!Number.isFinite(a) || Math.abs(a) < 100) return null
    decimal = americanToDecimal(a)
  } else if (format === 'decimal') {
    if (!/^\d+(\.\d+)?$/.test(t)) return null
    decimal = Number(t)
    if (!(decimal > 1)) return null
  } else {
    const m = /^(\d+(?:\.\d+)?)\s*[/-]\s*(\d+(?:\.\d+)?)$/.exec(t)
    if (!m || Number(m[2]) === 0 || Number(m[1]) === 0) return null
    decimal = 1 + Number(m[1]) / Number(m[2])
  }
  const american = decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1))
  return { implied: 1 / decimal, decimal, american }
}

export interface TwoWay {
  /** Margin-removed probabilities, proportional */
  fairA: number
  fairB: number
  /** The bookmaker's margin: the two implied probabilities sum to 1 + margin */
  margin: number
}

export function removeMargin(a: ParsedOdds, b: ParsedOdds): TwoWay {
  const total = a.implied + b.implied
  return { fairA: a.implied / total, fairB: b.implied / total, margin: total - 1 }
}
