export interface PickCardInput {
  title: string
  nameA: string
  nameB: string
  probA: number
  source: string
}

const W = 1200
const H = 630

/** Draws a shareable pick image. Returns null where canvas is unavailable. */
export async function makePickCard(input: PickCardInput): Promise<Blob | null> {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = '#0d1117'
  ctx.fillRect(0, 0, W, H)
  const pA = Math.max(0, Math.min(1, input.probA))
  const font = (px: number, weight = 700): string => `${weight} ${px}px "Barlow Condensed", "Arial Narrow", sans-serif`

  ctx.fillStyle = '#8b949e'
  ctx.font = font(34, 600)
  ctx.fillText(input.title.toUpperCase(), 60, 80)

  const pick = pA >= 0.5 ? 'a' : 'b'
  const name = pick === 'a' ? input.nameA : input.nameB
  ctx.fillStyle = '#f0f6fc'
  ctx.font = font(104, 800)
  ctx.fillText(name, 60, 230, W - 120)
  ctx.fillStyle = '#e8c15a'
  ctx.font = font(64, 700)
  ctx.fillText(`${Math.round((pick === 'a' ? pA : 1 - pA) * 100)}% to win`, 60, 310)

  const barY = 380
  const barW = W - 120
  ctx.fillStyle = '#e5484d'
  ctx.fillRect(60, barY, barW * pA, 46)
  ctx.fillStyle = '#3b82f6'
  ctx.fillRect(60 + barW * pA, barY, barW * (1 - pA), 46)
  ctx.fillStyle = '#f0f6fc'
  ctx.font = font(40, 600)
  ctx.fillText(`${input.nameA} ${Math.round(pA * 100)}%`, 60, barY + 100, barW / 2 - 10)
  ctx.textAlign = 'right'
  ctx.fillText(`${Math.round((1 - pA) * 100)}% ${input.nameB}`, W - 60, barY + 100, barW / 2 - 10)
  ctx.textAlign = 'left'

  ctx.fillStyle = '#8b949e'
  ctx.font = font(30, 500)
  ctx.fillText(input.source, 60, 560, W - 120)
  ctx.fillText('OctaIQ · amirronaldo319.github.io/octaiq · not betting advice', 60, 600, W - 120)

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
}
