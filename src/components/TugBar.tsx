interface TugBarProps {
  nameA: string
  nameB: string
  probA: number
  size?: 'sm' | 'lg'
}

/** Two corners pulling against each other: the split point is the model's probability. */
export function TugBar({ nameA, nameB, probA, size = 'sm' }: TugBarProps) {
  const a = Math.round(probA * 100)
  return (
    <div
      className={`tug ${size}`}
      role="img"
      aria-label={`${nameA} ${a} percent, ${nameB} ${100 - a} percent`}
    >
      <span className="tug-a" style={{ width: `${probA * 100}%` }} />
      <span className="tug-b" style={{ width: `${(1 - probA) * 100}%` }} />
      <span className="tug-mid" aria-hidden="true" />
    </div>
  )
}
