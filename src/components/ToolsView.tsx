import { useMemo, useState } from 'react'
import type { PublishedLedger } from '../../server/lib/snapshot'
import { withBase } from '../lib/fetchJson'
import { parseOdds, removeMargin, type OddsFormat } from '../lib/oddsMath'
import { score, type MyPick } from '../lib/picks'
import { nextBouts, type Follows } from '../lib/follows'
import { slugify } from '../lib/slug'
import { useAllEvents } from '../lib/useAllEvents'
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

interface FollowingProps {
  follows: Follows
  onUnfollow: (slug: string) => void
  onRemoveBout: (boutId: string) => void
  onOpenBout: (eventId: string, boutId: string) => void
}

const whenLocal = (iso: string): string => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Fighters and bouts the visitor follows, with each fighter's next bout across every card on the site. */
function Following({ follows, onUnfollow, onRemoveBout, onOpenBout }: FollowingProps) {
  const fighters = Object.entries(follows.fighters)
  const saved = Object.values(follows.bouts)
  const all = useAllEvents(fighters.length > 0)
  const upcoming = all.status === 'ready' ? nextBouts(follows, all.events, slugify, Date.now()) : []
  return (
    <section className="panel tool" aria-label="Following">
      <h2>Following</h2>
      {fighters.length === 0 && saved.length === 0 ? (
        <p className="empty">Nothing followed yet. Open a bout and choose “Follow” on a fighter or “Save this bout”. This stays in your browser only.</p>
      ) : (
        <>
          {fighters.length > 0 && (
            <ul className="my-picks">
              {fighters.map(([slug, f]) => {
                const next = upcoming.find((u) => slugify(u.fighter) === slug)
                return (
                  <li key={slug}>
                    <span>
                      <strong>{f.name}</strong>{' '}
                      {all.status === 'loading' ? <small className="muted">checking the cards…</small> : next ? (
                        <small className="muted">next: vs {next.opponent}, {whenLocal(next.start)} ({next.eventTitle})</small>
                      ) : all.status === 'ready' ? <small className="muted">not on a card on this site right now</small> : null}
                    </span>
                    <span>{next && <button type="button" className="btn small" onClick={() => onOpenBout(next.eventId, next.boutId)}>Open bout</button>}</span>
                    <button type="button" className="btn small" onClick={() => onUnfollow(slug)} aria-label={`Unfollow ${f.name}`}>Unfollow</button>
                  </li>
                )
              })}
            </ul>
          )}
          {saved.length > 0 && (
            <>
              <h3>Saved bouts</h3>
              <ul className="my-picks">
                {saved.sort((x, y) => y.at - x.at).map((b) => (
                  <li key={b.boutId}>
                    <span><strong>{b.a} vs {b.b}</strong> <small className="muted">{b.eventTitle}</small></span>
                    <span><button type="button" className="btn small" onClick={() => onOpenBout(b.eventId, b.boutId)}>Open bout</button></span>
                    <button type="button" className="btn small" onClick={() => onRemoveBout(b.boutId)} aria-label={`Remove saved bout ${b.a} vs ${b.b}`}>Remove</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  )
}

export interface MoreLink {
  id: string
  label: string
  note: string
}

export function ToolsView({ picks, onRemovePick, more, onGo, following }: { picks: Record<string, MyPick>; onRemovePick: (boutId: string) => void; more?: MoreLink[]; onGo?: (id: string) => void; following?: FollowingProps }) {
  return (
    <div className="tools">
      <header className="health-head"><h1>Tools</h1></header>
      {following && <Following {...following} />}
      <MyPicks picks={picks} onRemove={onRemovePick} />
      <OddsCalculator />
      {more && more.length > 0 && onGo && (
        <section className="panel tool" aria-label="More pages">
          <h2>More pages</h2>
          <ul className="more-links">
            {more.map((m) => (
              <li key={m.id}><button type="button" className="btn" onClick={() => onGo(m.id)}>{m.label}</button> <span className="muted small">{m.note}</span></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
