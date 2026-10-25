interface LineChartProps {
  values: readonly number[]
  height?: number
  /** Accessible description of the series */
  label: string
  formatValue?: (v: number) => string
  /** Draw a zero baseline (for profit curves) */
  baseline?: boolean
}

const W = 320

export function LineChart({ values, height = 90, label, formatValue = String, baseline = false }: LineChartProps) {
  if (values.length < 2) {
    return <div className="chart-empty">Not enough data yet</div>
  }
  const pad = 8
  const lo = Math.min(...values, baseline ? 0 : Infinity)
  const hi = Math.max(...values, baseline ? 0 : -Infinity)
  const span = hi - lo || 1
  const x = (i: number): number => pad + (i / (values.length - 1)) * (W - pad * 2)
  const y = (v: number): number => height - pad - ((v - lo) / span) * (height - pad * 2)
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const last = values[values.length - 1]
  const trendClass = last >= values[0] ? 'up' : 'down'

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label} preserveAspectRatio="none">
        {baseline && <line className="chart-base" x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} />}
        <polyline className={`chart-line ${trendClass}`} points={points} fill="none" />
        <circle className={`chart-dot ${trendClass}`} cx={x(values.length - 1)} cy={y(last)} r="3.5" />
      </svg>
      <figcaption className="chart-cap">
        <span>{formatValue(values[0])}</span>
        <span>{formatValue(last)}</span>
      </figcaption>
    </figure>
  )
}
