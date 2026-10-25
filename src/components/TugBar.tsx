interface TugBarProps {
  nameA: string
  nameB: string
  probA: number
  size?: 'sm' | 'lg'
  /** 90% range for probA; drawn as a lighter band over the split point */
  lo?: number
  hi?: number
}

/** Two corners pulling against each other: the split point is the model's probability. */
export function TugBar({ nameA, nameB, probA, size = 'sm', lo, hi }: TugBarProps) {
  const a = Math.round(probA * 100)
  const range = lo !== undefined && hi !== undefined
  return (
    <div
      className={`tug ${size}`}
      role="img"
      aria-label={`${nameA} ${a} percent, ${nameB} ${100 - a} percent${range ? `. Likely range for ${nameA}: ${Math.round(lo * 100)} to ${Math.round(hi * 100)} percent` : ''}`}
    >
      <span className="tug-a" style={{ width: `${probA * 100}%` }} />
      <span className="tug-b" style={{ width: `${(1 - probA) * 100}%` }} />
      {range && <span className="tug-range" style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%` }} aria-hidden="true" />}
      <span className="tug-mid" aria-hidden="true" />
    </div>
  )
}
