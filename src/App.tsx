import { useEffect, useMemo, useState } from 'react'
import { AboutData, Hero } from './components/Hero'
import { BankrollView } from './components/BankrollView'
import { BoutCard } from './components/BoutCard'
import { BoutModal } from './components/BoutModal'
import { FightDetail } from './components/FightDetail'
import { Highlights } from './components/Highlights'
import { ModelHealth } from './components/ModelHealth'
import { ParlayView, type ParlayEntry } from './components/ParlayView'
import { ValueView } from './components/ValueView'
import { analyzeCard, findValue, type FightAnalysis, type SideAnalysis } from './lib/analysis'
import { loadBets, saveBets, type Bet, type BetStatus } from './lib/bets'
import { fmtOdds } from './lib/format'
import { buildHighlights, primaryView, SORT_LABELS, sortRows, type SortKey } from './lib/primary'
import { useCard } from './lib/useCard'

type Tab = 'event' | 'health' | 'value' | 'parlay' | 'bankroll'
type Filter = 'all' | 'main' | 'prelim'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All bouts' },
  { id: 'main', label: 'Main card' },
  { id: 'prelim', label: 'Prelims' },
]

function DataBanner({ card }: { card: ReturnType<typeof useCard> }) {
  if (card.loading) return null
  if (card.source === 'demo') {
    return (
      <div className="banner demo" role="status">
        <span>Showing made-up demo fighters. {card.notice ?? ''}</span>
        <button className="btn small" onClick={card.reload}>Retry</button>
      </div>
    )
  }
  const meta = card.meta
  if (card.source !== 'live' || !meta) return null
  return (
    <div className="banner live" role="status">
      <span>
        Live odds, updated {new Date(meta.fetchedAt).toLocaleTimeString()}
        {meta.stale ? ' (stale: the latest refresh failed)' : ''}
        {meta.quotaRemaining ? `. ${meta.quotaRemaining} API credits left` : ''}
      </span>
      <button className="btn small" onClick={card.reload}>Refresh</button>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading the fight card">
      <div className="sk sk-hero" />
      <div className="sk-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="sk sk-card" />)}</div>
    </div>
  )
}

export function App() {
  const [tab, setTab] = useState<Tab>('event')
  const card = useCard()
  const [openId, setOpenId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('order')
  const [aboutOpen, setAboutOpen] = useState(false)
  const [bets, setBets] = useState<Bet[]>(() => loadBets())
  const [legs, setLegs] = useState<ParlayEntry[]>([])
  const [parlayStake, setParlayStake] = useState(10)
  const [bankroll, setBankroll] = useState(1000)
  const [minEdge, setMinEdge] = useState(0.03)
  const [kellyScale, setKellyScale] = useState(0.25)
  const [toast, setToast] = useState<string | null>(null)

  const event = card.source === 'event' ? card.event : null
  const isStatic = event?.static === true
  const results = event?.resultsModel

  const analyses = useMemo(() => analyzeCard(card.fights, kellyScale), [card.fights, kellyScale])
  const rows = useMemo(
    () => analyses.map((an) => {
      const r = results?.bouts[an.fight.id]
      const view = primaryView(an, r)
      return {
        an, view, r,
        order: an.fight.bout?.order ?? analyses.indexOf(an) + 1,
        hasModel: view.source !== 'none',
        probA: view.probA,
        thinnest: r ? Math.min(r.priorA, r.priorB) : null,
      }
    }),
    [analyses, results],
  )
  const featured = rows.find((x) => x.an.fight.mainEvent) ?? null
  const visible = useMemo(() => {
    const byCard = rows.filter((x) => x !== featured && (filter === 'all' || x.an.fight.bout?.card === filter || (!x.an.fight.bout && filter === 'main')))
    return sortRows(byCard, sortKey)
  }, [rows, featured, filter, sortKey])
  const highlights = useMemo(
    () => buildHighlights(rows.filter((x) => x.r).map((x) => ({
      id: x.an.fight.id, nameA: x.an.fight.a.name, nameB: x.an.fight.b.name, probA: x.view.probA, priorA: x.r?.priorA ?? 0, priorB: x.r?.priorB ?? 0,
    }))),
    [rows],
  )
  const opportunities = useMemo(() => findValue(analyses, minEdge), [analyses, minEdge])
  const opened: FightAnalysis | undefined = analyses.find((a) => a.fight.id === openId)
  const openedRow = rows.find((x) => x.an.fight.id === openId)

  const tabs: { id: Tab; label: string }[] = [
    { id: 'event', label: event ? 'Event' : 'Fight card' },
    ...(isStatic ? [] : [
      { id: 'value' as const, label: `Value board${opportunities.length ? ` (${opportunities.length})` : ''}` },
      { id: 'parlay' as const, label: `Parlay${legs.length ? ` (${legs.length})` : ''}` },
      { id: 'bankroll' as const, label: 'Bankroll' },
    ]),
    { id: 'health', label: 'Model health' },
  ]

  useEffect(() => saveBets(bets), [bets])
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(id)
  }, [toast])

  const goAbout = (): void => {
    setAboutOpen(true)
    requestAnimationFrame(() => document.getElementById('about')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const logBet = (side: SideAnalysis, fightLabel: string): void => {
    if (side.bestOdds === null) return
    const stake = Math.max(1, Math.round(side.kelly * bankroll * 100) / 100)
    const bet: Bet = {
      id: crypto.randomUUID(), placedAt: Date.now(), fightLabel, pick: side.fighter.name,
      american: side.bestOdds, stake, modelProb: side.modelProb, status: 'open',
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
    setToast(`Added ${side.fighter.name} to the parlay`)
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
        <a className="brand" href="./" aria-label="OctaIQ home">
          <span className="logo" aria-hidden="true" />
          <span className="brand-name">OctaIQ</span>
        </a>
        <nav aria-label="Sections">
          {tabs.map((t) => (
            <button key={t.id} type="button" className={`tab ${tab === t.id ? 'active' : ''}`} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <a className="gh" href="https://github.com/amirronaldo319/octaiq" target="_blank" rel="noopener noreferrer">Source on GitHub</a>
      </header>

      <DataBanner card={card} />

      <main>
        {tab === 'event' && (
          card.loading ? <Skeleton /> : (
            <>
              {event && <Hero payload={event} onAbout={goAbout} />}
              {event && <AboutData payload={event} open={aboutOpen} onToggle={setAboutOpen} />}
              {!event && <h1 className="plain-title">{card.source === 'demo' ? 'Demo fight card' : 'Live fight card'}</h1>}

              {event && <Highlights items={highlights} onOpen={setOpenId} />}

              {featured && filter !== 'prelim' && (
                <BoutCard analysis={featured.an} view={featured.view} results={featured.r} featured onOpen={setOpenId} />
              )}

              <div className="toolbar">
                <div className="chips" role="group" aria-label="Filter bouts">
                  {FILTERS.map((f) => (
                    <button key={f.id} type="button" className={`chip ${filter === f.id ? 'on' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                      {f.label}
                    </button>
                  ))}
                </div>
                <label className="sort">
                  <span>Sort</span>
                  <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                    {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
                  </select>
                </label>
              </div>

              {visible.length === 0 ? (
                <p className="empty">No bouts match this filter.</p>
              ) : (
                <div className="grid">
                  {visible.map((x) => <BoutCard key={x.an.fight.id} analysis={x.an} view={x.view} results={x.r} onOpen={setOpenId} />)}
                </div>
              )}
            </>
          )
        )}

        {tab === 'health' && <ModelHealth />}

        {tab === 'value' && (
          <ValueView opportunities={opportunities} minEdge={minEdge} onMinEdge={setMinEdge}
            kellyScale={kellyScale} onKellyScale={setKellyScale} bankroll={bankroll} onBet={logBet} />
        )}
        {tab === 'parlay' && (
          <ParlayView legs={legs} onRemove={(i) => setLegs((p) => p.filter((_, j) => j !== i))}
            onClear={() => setLegs([])} stake={parlayStake} onStake={setParlayStake} />
        )}
        {tab === 'bankroll' && (
          <BankrollView bets={bets} startingBankroll={bankroll} onStartingBankroll={setBankroll} onSettle={settleBet} onDelete={deleteBet} />
        )}
      </main>

      <footer className="foot">
        <p>OctaIQ is a research project, not betting advice. In past tests, betting prices were more accurate than this model. Please gamble responsibly.</p>
      </footer>

      {opened && openedRow && (
        <BoutModal title={`${opened.fight.a.name} versus ${opened.fight.b.name}`} onClose={() => setOpenId(null)}>
          <FightDetail analysis={opened} view={openedRow.view} results={openedRow.r} resultsMeta={results} isStatic={isStatic} onBet={logBet} onAddLeg={addLeg} />
        </BoutModal>
      )}
      <div className="toast" role="status" aria-live="polite">{toast}</div>
    </div>
  )
}
