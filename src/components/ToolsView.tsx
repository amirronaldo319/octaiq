import { useMemo, useState } from 'react'
import type { PublishedLedger } from '../../server/lib/snapshot'
import { withBase } from '../lib/fetchJson'
import { parseOdds, removeMargin, type OddsFormat } from '../lib/oddsMath'
import { score, type MyPick } from '../lib/picks'
import { useJson } from '../lib/useJson'

const FORMATS: { id: OddsFormat; label: string; placeholder: string }[] = [
  { id: 'american', label: 'American', placeholder: '-150' },
  { id: 'decimal', label: 'Decimal', placeholder: '1.67' },
  { id: 'fractional', label: 'Fractional', placeholder: '2/3' },
]

const pct = (n: number, d = 1): string => `${(n * 100).toFixed(d)}%`

function OddsCalculator() {
  const [format, setFormat] = useState<OddsFormat>('american')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const pa = parseOdds(a, format)
  const pb = parseOdds(b, format)
  const both = pa && pb ? removeMargin(pa, pb) : null
  const ph = FORMATS.find((f) => f.id === format)?.placeholder ?? ''
  return (
    <section className="panel tool" aria-label="Odds calculator">
      <h2>Odds calculator</h2>
      <p className="muted small">Turns a bookmaker’s odds into the chance they imply. Enter both fighters to see the bookmaker’s margin and the fair chances without it.</p>
      <div className="chips" role="group" aria-label="Odds format">
        {FORMATS.map((f) => (
          <button key={f.id} type="button" className={`chip ${format === f.id ? 'on' : ''}`} aria-pressed={format === f.id} onClick={() => setFormat(f.id)}>{f.label}</button>
        ))}
      </div>
      <div className="calc-row">
        <label>Fighter A odds<input value={a} onChange={(e) => setA(e.target.value)} placeholder={ph} inputMode="text" aria-invalid={a !== '' && !pa} /></label>
        <label>Fighter B odds (optional)<input value={b} onChange={(e) => setB(e.target.value)} placeholder="" inputMode="text" aria-invalid={b !== '' && !pb} /></label>
      </div>
      {(a !== '' && !pa) || (b !== '' && !pb) ? <p className="neg small" role="alert">That is not a valid {format} price.</p> : null}
      <dl className="calc-out">
        {pa && (<><dt>A implied chance</dt><dd>{pct(pa.implied)} <small>(decimal {pa.decimal.toFixed(2)}, American {pa.american > 0 ? '+' : ''}{pa.american})</small></dd></>)}
        {pb && (<><dt>B implied chance</dt><dd>{pct(pb.implied)} <small>(decimal {pb.decimal.toFixed(2)}, American {pb.american > 0 ? '+' : ''}{pb.american})</small></dd></>)}
        {both && (
          <>
            <dt>Bookmaker margin</dt><dd>{pct(both.margin)}</dd>
            <dt>Fair chances</dt><dd>A {pct(both.fairA)} · B {pct(both.fairB)}</dd>
          </>
        )}
      </dl>
    </section>
  )
}

const isLedger = (b: unknown): boolean => typeof b === 'object' && b !== null && Array.isArray((b as PublishedLedger).events)

function MyPicks({ picks, onRemove }: { picks: Record<string, MyPick>; onRemove: (boutId: string) => void }) {
  const ledger = useJson<PublishedLedger>([withBase('data/ledger.json')], isLedger)
  const list = Object.values(picks).sort((x, y) => y.at - x.at)
  const winners = useMemo(() => {
    const out: Record<string, 'a' | 'b'> = {}
    if (ledger.status === 'ready') {
      for (const e of ledger.data.events) for (const bout of e.bouts) if (bout.result === 'a' || bout.result === 'b') out[bout.id] = bout.result
    }
    return out
  }, [ledger])
  const card = score(picks, winners)
  return (
    <section className="panel tool" aria-label="My picks">
      <h2>My picks</h2>
      <p className="muted small">Pick a winner in any bout’s detail view. Your picks stay in this browser only, and are scored here once the fights are in the results data.</p>
      {list.length === 0 ? (
        <p className="empty">No picks yet. Open a bout and choose a fighter under “Your pick”.</p>
      ) : (
        <>
          {card.graded > 0 && (
            <p className="scorecard">
              <strong>You: {card.yours} of {card.graded}.</strong> The model: {card.model} of {card.graded}.
              {card.marketGraded > 0 && <> The market: {card.market} of {card.marketGraded}.</>} A small sample, so don’t read much into it.
            </p>
          )}
          <ul className="my-picks">
            {list.map((p) => {
              const w = winners[p.boutId]
              const chosen = p.side === 'a' ? p.a : p.b
              return (
                <li key={p.boutId}>
                  <span><strong>{chosen}</strong> <small className="muted">in {p.a} vs {p.b} ({p.eventTitle})</small></span>
                  <span className="mp-side">
                    {w ? <span className={w === p.side ? 'ok' : 'miss'}>{w === p.side ? 'Correct' : 'Missed'}</span> : <span className="muted">Pending</span>}
                    {p.modelProbA !== undefined && <small className="muted"> · model {pct(p.side === 'a' ? p.modelProbA : 1 - p.modelProbA, 0)}</small>}
                    {p.marketProbA !== undefined && <small className="muted"> · market {pct(p.side === 'a' ? p.marketProbA : 1 - p.marketProbA, 0)}</small>}
                  </span>
                  <button type="button" className="btn small" onClick={() => onRemove(p.boutId)} aria-label={`Remove your pick of ${chosen}`}>Remove</button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}

export function ToolsView({ picks, onRemovePick }: { picks: Record<string, MyPick>; onRemovePick: (boutId: string) => void }) {
  return (
    <div className="tools">
      <header className="health-head"><h1>Tools</h1></header>
      <MyPicks picks={picks} onRemove={onRemovePick} />
      <OddsCalculator />
    </div>
  )
}
