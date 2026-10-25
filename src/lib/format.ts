export const fmtOdds = (american: number): string => (american > 0 ? `+${american}` : `${american}`)

export const fmtPct = (p: number, digits = 1): string => `${(p * 100).toFixed(digits)}%`

export const fmtSignedPct = (p: number, digits = 1): string => `${p >= 0 ? '+' : ''}${(p * 100).toFixed(digits)}%`

export const fmtMoney = (n: number): string => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`

export const fmtSignedMoney = (n: number): string => `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`
