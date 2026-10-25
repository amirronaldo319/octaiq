import { fmtPct } from '../lib/format'

interface ProbBarProps {
  nameA: string
  nameB: string
  probA: number
}

export function ProbBar({ nameA, nameB, probA }: ProbBarProps) {
  return (
    <div className="probbar" role="img" aria-label={`${nameA} ${fmtPct(probA)}, ${nameB} ${fmtPct(1 - probA)}`}>
      <div className="probbar-a" style={{ width: `${probA * 100}%` }}>
        {fmtPct(probA, 0)}
      </div>
      <div className="probbar-b" style={{ width: `${(1 - probA) * 100}%` }}>
        {fmtPct(1 - probA, 0)}
      </div>
    </div>
  )
}
