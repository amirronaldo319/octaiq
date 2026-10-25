import { useEffect, useMemo, useState } from 'react'
import type { Career } from '../server/backtest/careers'
import { AboutData, Hero } from './components/Hero'
import { BankrollView } from './components/BankrollView'
import { BoutCard } from './components/BoutCard'
import { BoutModal } from './components/BoutModal'
import { CompareView } from './components/CompareView'
import { GapsView } from './components/GapsView'
import { ToolsView } from './components/ToolsView'
import { EventPicker } from './components/EventPicker'
import { FightDetail } from './components/FightDetail'
import { FighterPanel } from './components/FighterPanel'
import { Highlights } from './components/Highlights'
import { ModelHealth } from './components/ModelHealth'
import { ParlayView, type ParlayEntry } from './components/ParlayView'
import { TrackRecord } from './components/TrackRecord'
import { ValueView } from './components/ValueView'
import { analyzeCard, findValue, type FightAnalysis, type SideAnalysis } from './lib/analysis'
import { loadBets, saveBets, type Bet, type BetStatus } from './lib/bets'
import { withBase } from './lib/fetchJson'
import { fmtOdds } from './lib/format'
import { loadPicks, savePicks, togglePick, type MyPick } from './lib/picks'
import { makePickCard } from './lib/shareCard'
import { probToAmerican } from './engine/odds'
import { isMarketFile, marketFor, type MarketFile } from './lib/market'
import { buildHighlights, primaryView, SORT_LABELS, sortRows, type SortKey, type ViewMode } from './lib/primary'
import { shareUrl, useRoute, type Tab } from './lib/route'
import { slugify } from './lib/slug'
import { useTheme } from './lib/theme'
import { useCard } from './lib/useCard'
import { useJson } from './lib/useJson'

type Filter = 'all' | 'main' | 'prelim'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All bouts' },
  { id: 'main', label: 'Main card' },
  { id: 'prelim', label: 'Prelims' },
]

const isCareers = (b: unknown): boolean => typeof b === 'object' && b !== null && !Array.isArray(b)

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
  const [route, go] = useRoute()
  const [theme, toggleTheme] = useTheme()
  const tab: Tab = route.tab
  const card = useCard(route.eventId)
  const [filter, setFilter] = useState<Filter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('order')
  const [mode, setMode] = useState<ViewMode>('market')
  const [aboutOpen, setAboutOpen] = useState(false)
  const [bets, setBets] = useState<Bet[]>(() => loadBets())
  const [legs, setLegs] = useState<ParlayEntry[]>([])
  const [parlayStake, setParlayStake] = useState(10)
  const [bankroll, setBankroll] = useState(1000)
  const [minEdge, setMinEdge] = useState(0.03)
  const [kellyScale, setKellyScale] = useState(0.25)
  const [toast, setToast] = useState<string | null>(null)
  const [picks, setPicks] = useState<Record<string, MyPick>>(() => loadPicks())
  const [installEvent, setInstallEvent] = useState<{ prompt: () => Promise<void> } | null>(null)

  const event = card.source === 'event' ? card.event : null
  const isStatic = event?.static === true
  const results = event?.resultsModel
  const careers = useJson<Record<string, Career>>(route.fighter ? [withBase('data/fighters.json')] : null, isCareers)
  const marketState = useJson<MarketFile>([withBase('data/market.json')], isMarketFile)
  const marketFile = marketState.status === 'ready' ? marketState.data : undefined
  const hasMarket = Boolean(card.eventId && marketFile && Object.keys(marketFile.events[card.eventId] ?? {}).length > 0)

  const analyses = useMemo(() => analyzeCard(card.fights, kellyScale), [card.fights, kellyScale])
  const rows = useMemo(
    () => analyses.map((an) => {
      const r = results?.bouts[an.fight.id]
      const m = marketFor(marketFile, card.eventId, an.fight.id)
      const view = primaryView(an, r, m, mode)
      return {
        an, view, r, m,
        order: an.fight.bout?.order ?? analyses.indexOf(an) + 1,
        hasModel: view.source !== 'none',
        probA: view.probA,
        thinnest: r ? Math.min(r.priorA, r.priorB) : null,
      }
    }),
    [analyses, results, marketFile, card.eventId, mode],
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
  const opened: FightAnalysis | undefined = route.boutId ? analyses.find((a) => a.fight.id === route.boutId) : undefined
  const openedRow = route.boutId ? rows.find((x) => x.an.fight.id === route.boutId) : undefined
  const currentEventId = card.eventId ?? route.eventId

  const tabs: { id: Tab; label: string }[] = [
    { id: 'event', label: event ? 'Event' : 'Fight card' },
    { id: 'record', label: 'Track record' },
    { id: 'gaps', label: 'Model vs market' },
    { id: 'compare', label: 'Compare' },
    ...(isStatic ? (hasMarket ? [{ id: 'parlay' as const, label: `Parlay${legs.length ? ` (${legs.length})` : ''}` }] : []) : [
      { id: 'value' as const, label: `Value board${opportunities.length ? ` (${opportunities.length})` : ''}` },
      { id: 'parlay' as const, label: `Parlay${legs.length ? ` (${legs.length})` : ''}` },
      { id: 'bankroll' as const, label: 'Bankroll' },
    ]),
    { id: 'tools', label: `Tools${Object.keys(picks).length ? ` (${Object.keys(picks).length})` : ''}` },
    { id: 'health', label: 'Model health' },
  ]

  useEffect(() => saveBets(bets), [bets])
  useEffect(() => savePicks(picks), [picks])
  useEffect(() => {
    const onPrompt = (e: Event): void => {
      e.preventDefault()
      setInstallEvent(e as unknown as { prompt: () => Promise<void> })
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(id)
  }, [toast])

  const eventRoute = (extra: { boutId?: string; fighter?: string } = {}) => ({ tab: 'event' as const, eventId: currentEventId ?? undefined, ...extra })
  const openBout = (id: string): void => go(eventRoute({ boutId: id }))
  const closeAll = (): void => go(eventRoute())
  const openFighter = (slug: string): void => go(eventRoute({ boutId: route.boutId, fighter: slug }))
  const closeFighter = (): void => go(eventRoute({ boutId: route.boutId }))

  const goAbout = (): void => {
    setAboutOpen(true)
    requestAnimationFrame(() => document.getElementById('about')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const copyLink = async (): Promise<void> => {
    const url = shareUrl(eventRoute({ boutId: route.boutId }))
    try {
      await navigator.clipboard.writeText(url)
      setToast('Link copied')
    } catch {
      setToast(url)
    }
  }

  const gapRows = useMemo(
    () => rows.flatMap((x) => (x.r && x.m ? [{
      id: x.an.fight.id, order: x.order, nameA: x.an.fight.a.name, nameB: x.an.fight.b.name,
      modelProbA: x.r.probA, marketProbA: x.m.pA, books: x.m.books,
    }] : [])),
    [rows],
  )

  const pickBout = (side: 'a' | 'b'): void => {
    if (!opened || !openedRow) return
    const f = opened.fight
    setPicks((prev) => togglePick(prev, {
      boutId: f.id, side, a: f.a.name, b: f.b.name, eventTitle: event?.event.title ?? 'This card', at: Date.now(),
      modelProbA: openedRow.r?.probA, marketProbA: openedRow.m?.pA,
    }))
  }

  const saveImage = async (): Promise<void> => {
    if (!opened || !openedRow) return
    const f = opened.fight
    const blob = await makePickCard({
      title: event?.event.title ?? 'UFC', nameA: f.a.name, nameB: f.b.name, probA: openedRow.view.probA,
      source: openedRow.view.source === 'market' ? 'Betting-market consensus, margin removed' : 'OctaIQ model, backtested',
    })
    if (!blob) { setToast('Pick images need a browser with canvas support'); return }
    const file = new File([blob], `octaiq-${f.id}.png`, { type: 'image/png' })
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'OctaIQ pick' }); return }
    } catch { /* fall through to a download */ }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
    URL.revokeObjectURL(url)
    setToast('Pick image saved')
  }

  const addFairLeg = (side: 'a' | 'b'): void => {
    if (!opened || !openedRow?.m) return
    const f = opened.fight
    const p = side === 'a' ? openedRow.m.pA : 1 - openedRow.m.pA
    const label = side === 'a' ? f.a.name : f.b.name
    if (legs.some((l) => l.fightId === f.id && l.label === label)) return
    setLegs((prev) => [...prev, { fightId: f.id, label, american: probToAmerican(p), modelProb: openedRow.r ? (side === 'a' ? openedRow.r.probA : openedRow.r.probB) : p }])
    setToast(`Added ${label} to the parlay at the fair price`)
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

  const fighterName = route.fighter
    ? (careers.status === 'ready' ? careers.data[route.fighter]?.name : undefined) ??
      analyses.flatMap((a) => [a.fight.a.name, a.fight.b.name]).find((n) => slugify(n) === route.fighter) ?? route.fighter
    : ''

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <a className="brand" href={withBase('')} onClick={(e) => { e.preventDefault(); go({ tab: 'event' }) }} aria-label="OctaIQ home">
          <span className="logo" aria-hidden="true" />
          <span className="brand-name">OctaIQ</span>
        </a>
        <nav aria-label="Sections">
          {tabs.map((t) => (
            <button key={t.id} type="button" className={`tab ${tab === t.id ? 'active' : ''}`} aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => go(t.id === 'event' ? eventRoute() : { tab: t.id })}>
              {t.label}
            </button>
          ))}
        </nav>
        <button type="button" className="theme-toggle" onClick={toggleTheme} aria-pressed={theme === 'light'}>
          {theme === 'light' ? 'Dark theme' : 'Light theme'}
        </button>
        {installEvent && (
          <button type="button" className="theme-toggle" onClick={() => { void installEvent.prompt(); setInstallEvent(null) }}>Install app</button>
        )}
        <a className="gh" href="https://github.com/amirronaldo319/octaiq" target="_blank" rel="noopener noreferrer">Source on GitHub</a>
      </header>

      <DataBanner card={card} />

      <main id="main">
        {tab === 'event' && (
          card.loading ? <Skeleton /> : (
            <>
              {event && <EventPicker events={card.events} selectedId={card.eventId} onSelect={(id) => go({ tab: 'event', eventId: id })} />}
              {event && <Hero payload={event} onAbout={goAbout} marketUpdated={hasMarket ? marketFile?.generatedAt : undefined} />}
              {event && <AboutData payload={event} open={aboutOpen} onToggle={setAboutOpen} marketAttribution={hasMarket ? marketFile?.attribution : undefined} />}
              {!event && <h1 className="plain-title">{card.source === 'demo' ? 'Demo fight card' : 'Live fight card'}</h1>}

              {event && <Highlights items={highlights} onOpen={openBout} />}

              {featured && filter !== 'prelim' && (
                <BoutCard analysis={featured.an} view={featured.view} results={featured.r} market={featured.m} featured onOpen={openBout} />
              )}

              <div className="toolbar">
                <div className="chips" role="group" aria-label="Filter bouts">
                  {FILTERS.map((f) => (
                    <button key={f.id} type="button" className={`chip ${filter === f.id ? 'on' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                      {f.label}
                    </button>
                  ))}
                </div>
                {hasMarket && (
                  <div className="chips" role="group" aria-label="Headline probabilities">
                    <span className="muted small">Headline numbers</span>
                    {(['market', 'model'] as const).map((m) => (
                      <button key={m} type="button" className={`chip ${mode === m ? 'on' : ''}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
                        {m === 'market' ? 'Betting market' : 'Model'}
                      </button>
                    ))}
                  </div>
                )}
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
                  {visible.map((x) => <BoutCard key={x.an.fight.id} analysis={x.an} view={x.view} results={x.r} market={x.m} onOpen={openBout} />)}
                </div>
              )}
            </>
          )
        )}

        {tab === 'record' && <TrackRecord />}
        {tab === 'gaps' && <GapsView rows={gapRows} hasMarket={hasMarket} onOpen={openBout} />}
        {tab === 'compare' && <CompareView a={route.a} b={route.b} onChange={(a, b) => go({ tab: 'compare', a, b })} />}
        {tab === 'tools' && <ToolsView picks={picks} onRemovePick={(id) => setPicks((prev) => { const next = { ...prev }; delete next[id]; return next })} />}
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
        <p className="muted small">
          If gambling is causing you harm, free help is available in the US at 1-800-GAMBLER or <a href="https://www.ncpgambling.org/help-treatment/" target="_blank" rel="noopener noreferrer">ncpgambling.org</a>.
          Outside the US, see <a href="https://www.begambleaware.org" target="_blank" rel="noopener noreferrer">begambleaware.org</a>.
        </p>
      </footer>

      {tab === 'event' && route.fighter && (
        <BoutModal title={`${fighterName}: career and rating history`} onClose={route.boutId ? closeFighter : closeAll}>
          <FighterPanel
            name={fighterName}
            status={careers.status === 'ready' ? 'ready' : careers.status === 'missing' ? 'missing' : 'loading'}
            career={careers.status === 'ready' ? careers.data[route.fighter] : undefined}
            onBack={route.boutId ? closeFighter : undefined}
            backLabel="Back to the bout"
          />
        </BoutModal>
      )}
      {tab === 'event' && !route.fighter && opened && openedRow && (
        <BoutModal title={`${opened.fight.a.name} versus ${opened.fight.b.name}`} onClose={closeAll}>
          <FightDetail analysis={opened} view={openedRow.view} results={openedRow.r} resultsMeta={results} market={openedRow.m} marketUpdated={marketFile?.generatedAt} isStatic={isStatic}
            onFighter={openFighter} onShare={copyLink} onBet={logBet} onAddLeg={addLeg}
            eventId={card.eventId} myPick={picks[opened.fight.id]?.side} onPick={pickBout} onSaveImage={saveImage} onAddFairLeg={isStatic && openedRow.m ? addFairLeg : undefined} />
        </BoutModal>
      )}
      <div className="toast" role="status" aria-live="polite">{toast}</div>
    </div>
  )
}
