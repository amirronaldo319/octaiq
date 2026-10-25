import { useMemo, useState } from 'react'
import type { FighterIndex, FighterIndexRow } from '../../server/lib/snapshot'
import { withBase } from '../lib/fetchJson'
import { useJson } from '../lib/useJson'

const isIndex = (b: unknown): boolean => typeof b === 'object' && b !== null && Array.isArray((b as FighterIndex).rows)

const [NAME, SLUG, WINS, LOSSES, DRAWS, ELO, LAST, CLASS, KO, SUB] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const

/** Elo's own win chance for A; weaker than the full model, but it works for any two fighters. */
export const eloChance = (a: number, b: number): number => 1 / (1 + 10 ** ((b - a) / 400))

function Picker({ label, rows, value, onChange }: { label: string; rows: FighterIndexRow[]; value?: string; onChange: (slug: string | undefined) => void }) {
  const [text, setText] = useState('')
  const chosen = rows.find((r) => r[SLUG] === value)
  const matches = useMemo(() => {
    const q = text.trim().toLowerCase()
    return q.length < 2 ? [] : rows.filter((r) => r[NAME].toLowerCase().includes(q)).slice(0, 8)
  }, [rows, text])
  return (
    <div className="picker">
      <label>
        {label}
        <input value={chosen && text === '' ? chosen[NAME] : text} onChange={(e) => { setText(e.target.value); if (value) onChange(undefined) }} placeholder="Search a fighter" autoComplete="off" />
      </label>
      {matches.length > 0 && (
        <ul className="picker-list" role="listbox" aria-label={`${label} matches`}>
          {matches.map((r) => (
            <li key={r[SLUG]}>
              <button type="button" role="option" aria-selected={false} onClick={() => { onChange(r[SLUG]); setText('') }}>
                {r[NAME]} <small className="muted">{r[WINS]}-{r[LOSSES]}-{r[DRAWS]} · {r[CLASS]}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Bar({ label, a, b, fmt = String }: { label: string; a: number; b: number; fmt?: (n: number) => string }) {
  const total = a + b || 1
  return (
    <div className="vs-row">
      <span className="vs-v a">{fmt(a)}</span>
      <span className="vs-mid">
        <span className="vs-label">{label}</span>
        <span className="vs-track" aria-hidden="true"><span className="vs-a" style={{ width: `${(a / total) * 100}%` }} /><span className="vs-b" style={{ width: `${(b / total) * 100}%` }} /></span>
      </span>
      <span className="vs-v b">{fmt(b)}</span>
    </div>
  )
}

interface CompareViewProps {
  a?: string
  b?: string
  onChange: (a: string | undefined, b: string | undefined) => void
}

/** Search any recently active UFC fighter and compare two side by side. */
export function CompareView({ a, b, onChange }: CompareViewProps) {
  const index = useJson<FighterIndex>([withBase('data/fighter-index.json')], isIndex)
  if (index.status === 'missing') return <p className="empty">The fighter list is not available right now.</p>
  if (index.status !== 'ready') return <p className="muted">Loading fighters…</p>
  const rows = index.data.rows
  const fa = rows.find((r) => r[SLUG] === a)
  const fb = rows.find((r) => r[SLUG] === b)
  return (
    <section className="compare" aria-label="Compare fighters">
      <header className="health-head">
        <h1>Compare fighters</h1>
        <p className="lead">Any of the {rows.length.toLocaleString()} fighters with a UFC fight since {index.data.activeSince}. Ratings are Elo, a score built from past UFC results.</p>
      </header>
      <div className="compare-pickers">
        <Picker label="Fighter A" rows={rows} value={a} onChange={(s) => onChange(s, b)} />
        <Picker label="Fighter B" rows={rows} value={b} onChange={(s) => onChange(a, s)} />
      </div>
      {fa && fb ? (
        <div className="vs panel">
          <div className="vs-head"><strong className="a">{fa[NAME]}</strong><strong className="b">{fb[NAME]}</strong></div>
          <p className="vs-chance">
            Elo alone gives <strong>{fa[NAME]} {Math.round(eloChance(fa[ELO], fb[ELO]) * 100)}%</strong> and <strong>{fb[NAME]} {Math.round((1 - eloChance(fa[ELO], fb[ELO])) * 100)}%</strong>.
            <span className="muted small"> That ignores everything else the full model uses, and the betting market is more accurate than either.</span>
          </p>
          <Bar label="Elo rating" a={fa[ELO]} b={fb[ELO]} fmt={(n) => String(Math.round(n))} />
          <Bar label="UFC wins" a={fa[WINS]} b={fb[WINS]} />
          <Bar label="UFC losses" a={fa[LOSSES]} b={fb[LOSSES]} />
          <Bar label="Wins by KO or TKO" a={fa[KO]} b={fb[KO]} />
          <Bar label="Wins by submission" a={fa[SUB]} b={fb[SUB]} />
          <div className="vs-row facts-row"><span className="vs-v a">{fa[CLASS]}<br /><small className="muted">last fought {fa[LAST]}</small></span><span className="vs-mid" /><span className="vs-v b">{fb[CLASS]}<br /><small className="muted">last fought {fb[LAST]}</small></span></div>
        </div>
      ) : (
        <p className="empty">Choose two fighters to compare them.</p>
      )}
    </section>
  )
}
