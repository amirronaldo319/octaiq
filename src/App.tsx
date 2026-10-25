import { useEffect, useMemo, useState } from 'react'
import { BankrollView } from './components/BankrollView'
import { EventHeader } from './components/EventHeader'
import { FightDetail } from './components/FightDetail'
import { Leaderboards } from './components/Leaderboards'
import { ModelHealth } from './components/ModelHealth'
import { ParlayView, type ParlayEntry } from './components/ParlayView'
import { ProbBar } from './components/ProbBar'
import { ValueView } from './components/ValueView'
import { CARD_TITLE } from './data/card'
import {
  analyzeCard, buildLeaderboards, findValue, SORT_LABELS, sortAnalyses, type SideAnalysis, type SortKey,
} from './lib/analysis'
import { loadBets, saveBets, type Bet, type BetStatus } from './lib/bets'
import { fmtOdds, fmtSignedPct } from './lib/format'
import { useCard } from './lib/useCard'

type Tab = 'card' | 'value' | 'parlay' | 'bankroll' | 'health'

function DataBanner({ card }: { card: ReturnType<typeof useCard> }) {
  if (card.loading) return <div className="banner" role="status">Loading data…</div>
  if (card.source === 'event') return null
  if (card.source === 'demo') {
    return (
      <div className="banner demo" role="status">
        <span>Demo data (fictional fighters). {card.notice ?? ''}</span>
        <button className="btn small" onClick={card.reload}>Retry live</button>
      </div>
    )
  }
  const meta = card.meta
  if (!meta) return null
  return (
    <div className="banner live" role="status">
      <span>
        Live odds · updated {new Date(meta.fetchedAt).toLocaleTimeString()}
        {meta.stale ? ' (stale: upstream failed)' : ''}
        {meta.quotaRemaining ? ` · ${meta.quotaRemaining} API credits left` : ''}
        {meta.missingStats.length > 0 ? ` · no stats for ${meta.missingStats.length} fighter(s)` : ''}
      </span>
      <button className="btn small" onClick={card.reload}>Refresh</button>
      {meta.warnings.map((w) => <small key={w} className="block warn-text">{w}</small>)}
    </div>
  )
}

export function App() {
  const [tab, setTab] = useState<Tab>('card')
  const card = useCard()
  const [selectedId, setSelectedId] = useState<string>('')
  const [sortKey, setSortKey] = useState<SortKey>('order')
  const [bets, setBets] = useState<Bet[]>(() => loadBets())
  const [legs, setLegs] = useState<ParlayEntry[]>([])
  const [parlayStake, setParlayStake] = useState(10)
  const [bankroll, setBankroll] = useState(1000)
  const [minEdge, setMinEdge] = useState(0.03)
  const [kellyScale, setKellyScale] = useState(0.25)
  const [toast, setToast] = useState<string | null>(null)

  const analyses = useMemo(() => analyzeCard(card.fights, kellyScale), [card.fights, kellyScale])
  const sorted = useMemo(() => sortAnalyses(analyses, sortKey), [analyses, sortKey])
  const boards = useMemo(() => buildLeaderboards(analyses), [analyses])
  const opportunities = useMemo(() => findValue(analyses, minEdge), [analyses, minEdge])
  const selected = analyses.find((a) => a.fight.id === selectedId) ?? sorted[0]
  const isEvent = card.source === 'event' && card.event !== null

  const tabs: { id: Tab; label: string }[] = [
    { id: 'card', label: isEvent ? 'Event' : 'Fight card' },
    { id: 'value', label: 'Value board' },
    { id: 'parlay', label: 'Parlay' },
    { id: 'bankroll', label: 'Bankroll' },
    { id: 'health', label: 'Model health' },
  ]

  useEffect(() => saveBets(bets), [bets])
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(id)
  }, [toast])

  const logBet = (side: SideAnalysis, fightLabel: string): void => {
    if (side.bestOdds === null) return
    const stake = Math.max(1, Math.round(side.kelly * bankroll * 100) / 100)
    const bet: Bet = {
      id: crypto.randomUUID(),
      placedAt: Date.now(),
      fightLabel,
      pick: side.fighter.name,
      american: side.bestOdds,
      stake,
      modelProb: side.modelProb,
      status: 'open',
    }
    setBets((prev) => [...prev, bet])
    setToast(`Logged $${stake.toFixed(2)} on ${side.fighter.name} at ${fmtOdds(side.bestOdds)}`)
  }

  const addLeg = (side: SideAnalysis, fightLabel: string): void => {
    if (side.bestOdds === null) return
    const american = side.bestOdds
    const fightId = analyses.find((a) => `${a.fight.a.name} vs ${a.fight.b.name}` === fightLabel)?.fight.id ?? fightLabel
    if (legs.some((l) => l.fightId === fightId && l.label === side.fighter.name)) return
    setLegs((prev) => [...prev, { fightId, label: side.fighter.name, american, modelProb: side.modelProb }])
    setToast(`Added ${side.fighter.name} to parlay`)
  }

  const settleBet = (id: string, status: BetStatus): void => {
    setBets((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b
        const match = analyses.find((a) => a.fight.a.name === b.pick || a.fight.b.name === b.pick)
        const fair = match ? (match.fight.a.name === b.pick ? match.a.fairProb : match.b.fairProb) : null
        return { ...b, status, closeFairProb: fair ?? undefined }
      }),
    )
  }

  const deleteBet = (id: string): void => setBets((prev) => prev.filter((b) => b.id !== id))

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">◈</span>
          <div>
            <h1>OctaIQ</h1>
            <p>
              {isEvent ? 'Intelligence Before the Bell' : card.source === 'live' ? 'Live odds' : `${CARD_TITLE} · demo data`}
            </p>
          </div>
        </div>
        <nav aria-label="Sections">
          {tabs.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'parlay' && legs.length > 0 && <span className="badge">{legs.length}</span>}
              {t.id === 'value' && <span className="badge">{opportunities.length}</span>}
            </button>
          ))}
        </nav>
      </header>

      <DataBanner card={card} />

      <main>
        {tab === 'card' && (
          <>
            {isEvent && card.event && (
              <>
                <EventHeader payload={card.event} />
                <Leaderboards boards={boards} onSelect={setSelectedId} />
              </>
            )}
            <div className="card-layout">
              <aside className="fight-list" aria-label="Fights">
                <label className="sort">
                  <span>Sort by</span>
                  <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                    {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
                  </select>
                </label>
                {sorted.map((an) => {
                  const top = an.a.ev > an.b.ev ? an.a : an.b
                  return (
                    <button key={an.fight.id}
                      className={`fight-item ${an.fight.id === selected.fight.id ? 'active' : ''}`}
                      onClick={() => setSelectedId(an.fight.id)}>
                      <span className="fi-meta">
                        {an.fight.bout ? `#${an.fight.bout.order} · ${an.fight.bout.card === 'main' ? 'Main card' : 'Prelims'} · ` : ''}
                        {an.fight.weightClass}{an.fight.mainEvent ? ' · Main event' : ''}
                      </span>
                      <span className="fi-names">{an.fight.a.name} <em>vs</em> {an.fight.b.name}</span>
                      {an.modelValid ? (
                        <ProbBar nameA={an.fight.a.name} nameB={an.fight.b.name} probA={an.prediction.probA} />
                      ) : (
                        <span className="fi-nostats">No stats on file · baseline off</span>
                      )}
                      {!an.modelValid && card.event?.resultsModel.bouts[an.fight.id] && (
                        <>
                          <ProbBar nameA={an.fight.a.name} nameB={an.fight.b.name} probA={card.event.resultsModel.bouts[an.fight.id].probA} />
                          <span className="fi-meta">Validated model (backtested)</span>
                        </>
                      )}
                      {an.modelValid && top.ev > 0 && top.bestOdds !== null && (
                        <span className="fi-value">Value: {top.fighter.name} {fmtSignedPct(top.ev)} EV</span>
                      )}
                      {an.fight.bout && an.fight.bout.notes.length > 0 && (
                        <span className="fi-flag">⚑ {an.fight.bout.notes.length} verification note{an.fight.bout.notes.length > 1 ? 's' : ''}</span>
                      )}
                    </button>
                  )
                })}
              </aside>
              <FightDetail analysis={selected} onBet={logBet} onAddLeg={addLeg}
                results={card.event?.resultsModel.bouts[selected.fight.id]} resultsMeta={card.event?.resultsModel} />
            </div>
          </>
        )}

        {tab === 'value' && (
          <ValueView opportunities={opportunities} minEdge={minEdge} onMinEdge={setMinEdge}
            kellyScale={kellyScale} onKellyScale={setKellyScale} bankroll={bankroll} onBet={logBet} />
        )}

        {tab === 'parlay' && (
          <ParlayView legs={legs} onRemove={(i) => setLegs((p) => p.filter((_, j) => j !== i))}
            onClear={() => setLegs([])} stake={parlayStake} onStake={setParlayStake} />
        )}

        {tab === 'health' && <ModelHealth />}

        {tab === 'bankroll' && (
          <BankrollView bets={bets} startingBankroll={bankroll} onStartingBankroll={setBankroll}
            onSettle={settleBet} onDelete={deleteBet} />
        )}
      </main>

      <footer className="foot">
        {isEvent
          ? 'Predictions are baseline research estimates, not validated forecasts or betting advice. Quotes are never invented. Gamble responsibly.'
          : 'Fighters and odds shown without a live feed are fictional demo data. Models are illustrative, not betting advice. Gamble responsibly.'}
      </footer>
      <div className="toast" role="status" aria-live="polite">{toast}</div>
    </div>
  )
}
