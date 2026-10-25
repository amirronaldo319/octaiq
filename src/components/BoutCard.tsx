import type { FightAnalysis } from '../lib/analysis'
import { leanOf, trustFor, type PrimaryView } from '../lib/primary'
import type { ResultsModelBout } from '../engine/eventTypes'
import { Avatar } from './Avatar'
import { TugBar } from './TugBar'

interface BoutCardProps {
  analysis: FightAnalysis
  view: PrimaryView
  results?: ResultsModelBout
  featured?: boolean
  onOpen: (id: string) => void
}

function Corner({ name, record, prob, corner, leading, hasModel, big }: {
  name: string
  record: string
  prob: number
  corner: 'a' | 'b'
  leading: boolean
  hasModel: boolean
  big: boolean
}) {
  return (
    <div className={`corner ${corner} ${leading ? 'leading' : ''}`}>
      <Avatar name={name} corner={corner} size={big ? 'lg' : 'md'} />
      <div className="corner-id">
        <span className="corner-name">{name}</span>
        <span className="corner-rec">{record}</span>
      </div>
      <span className="corner-pct" aria-hidden={!hasModel}>{hasModel ? `${Math.round(prob * 100)}%` : '–'}</span>
    </div>
  )
}

export function BoutCard({ analysis, view, results, featured = false, onOpen }: BoutCardProps) {
  const { fight } = analysis
  const hasModel = view.source !== 'none'
  const lean = leanOf(view.probA)
  const favored = lean.side === 'a' ? fight.a.name : fight.b.name
  const trust = trustFor(results)
  const notes = fight.bout?.notes.length ?? 0

  return (
    <button
      type="button"
      className={`bout ${featured ? 'featured' : ''}`}
      onClick={() => onOpen(fight.id)}
      aria-label={`${fight.a.name} versus ${fight.b.name}, ${fight.weightClass}. ${hasModel ? `${lean.label}: ${favored}.` : 'No prediction.'} Open details.`}
    >
      <span className="bout-meta">
        {featured ? <strong className="main-event">Main event</strong> : <span>Bout {fight.bout?.order ?? ''}</span>}
        <span>{fight.weightClass}</span>
        <span>{fight.rounds} rounds</span>
        <span>{fight.bout?.card === 'main' ? 'Main card' : 'Prelims'}</span>
      </span>

      <span className="corners">
        <Corner name={fight.a.name} record={fight.a.record} prob={view.probA} corner="a" leading={hasModel && lean.side === 'a'} hasModel={hasModel} big={featured} />
        <Corner name={fight.b.name} record={fight.b.record} prob={view.probB} corner="b" leading={hasModel && lean.side === 'b'} hasModel={hasModel} big={featured} />
      </span>

      {hasModel && <TugBar nameA={fight.a.name} nameB={fight.b.name} probA={view.probA} size={featured ? 'lg' : 'sm'} />}

      <span className="bout-foot">
        {hasModel ? (
          <>
            <span className="lean">
              <strong>{lean.label}</strong>
              {lean.label === 'Toss-up' ? '' : `: ${favored}`}
            </span>
            {view.source === 'baseline' && <span className="tag warn">Untested estimate</span>}
            {trust.level === 'Low' && <span className="tag">Thin data</span>}
          </>
        ) : (
          <span className="lean muted">No prediction yet</span>
        )}
        {notes > 0 && <span className="tag note">{notes} note{notes > 1 ? 's' : ''}</span>}
      </span>
    </button>
  )
}
