import type { ResultsModelBout } from '../engine/eventTypes'
import type { FightAnalysis } from '../lib/analysis'
import type { MarketBout } from '../lib/market'
import { leanOf, type PrimaryView } from '../lib/primary'
import { pctPair } from '../lib/rounding'
import { dataQuality, noteTags } from '../lib/tags'
import { Avatar } from './Avatar'
import { TugBar } from './TugBar'

export interface CompactItem {
  an: FightAnalysis
  view: PrimaryView
  r?: ResultsModelBout
  m?: MarketBout
}

/** The first group of factors behind the pick, without the long list. */
export function mainFactor(r: ResultsModelBout | undefined): string {
  const top = r?.why?.for[0]
  if (!top) return '–'
  const [group, detail] = top.text.split(': ')
  return detail ? `${group}: ${detail}` : group
}

/** One line per bout so a whole card fits on screen. Probability and data quality are shown separately. */
export function CompactList({ items, onOpen, label = 'Fights, compact view' }: { items: CompactItem[]; onOpen: (id: string) => void; label?: string }) {
  return (
    <div className="compact" role="region" aria-label={label}>
      <table className="tbl compact-table">
        <thead>
          <tr><th scope="col">Fighters</th><th scope="col">Win chance</th><th scope="col">Data quality</th><th scope="col">Main factor</th><th scope="col"><span className="sr-only">Open</span></th></tr>
        </thead>
        <tbody>
          {items.map(({ an, view, r }) => {
            const f = an.fight
            const hasModel = view.source !== 'none'
            const [pa, pb] = pctPair(view.probA)
            const lean = leanOf(view.probA)
            const tags = noteTags(f.bout?.notes ?? [])
            const quality = dataQuality({ a: f.a.name, b: f.b.name }, r, tags)
            return (
              <tr key={f.id} className={f.mainEvent ? 'main-event-row' : ''}>
                <th scope="row" className="c-fighters">
                  <span className="c-names">
                    <Avatar name={f.a.name} corner="a" size="sm" /><span className={hasModel && lean.side === 'a' ? 'picked' : ''}>{f.a.name}</span>
                    <em>vs</em>
                    <Avatar name={f.b.name} corner="b" size="sm" /><span className={hasModel && lean.side === 'b' ? 'picked' : ''}>{f.b.name}</span>
                  </span>
                  <span className="muted small">
                    {f.mainEvent ? <strong className="main-event">Main event</strong> : `Bout ${f.bout?.order ?? ''}`} · {f.weightClass} · {f.rounds} rounds · {f.bout?.card === 'main' ? 'Main card' : 'Prelims'}
                    {tags.slice(0, 2).map((t) => <span key={t.label} className={`tag ${t.tone === 'warn' ? 'warn' : 'note'}`}>{t.label}</span>)}
                  </span>
                </th>
                <td className="c-prob">
                  {hasModel ? (
                    <>
                      <span className="c-pcts"><strong className="a">{pa}%</strong><strong className="b">{pb}%</strong></span>
                      <TugBar nameA={f.a.name} nameB={f.b.name} probA={view.probA} />
                    </>
                  ) : '–'}
                </td>
                <td className="c-quality"><span className={`tag q-${quality.level.toLowerCase()}`} title={quality.reasons.join(' ')}>{quality.level}</span></td>
                <td className="c-factor muted small">{mainFactor(r)}</td>
                <td className="c-open"><button type="button" className="btn small" onClick={() => onOpen(f.id)}>Analysis<span className="sr-only"> of {f.a.name} versus {f.b.name}</span></button></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
