// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import type { EventPayload } from './engine/eventTypes'

/** Frozen copies of the published files, so a real card change or the passing of time cannot break these tests. */
const DATA = resolve(import.meta.dirname, 'test/fixtures/data')
const NOW = new Date('2026-10-26T12:00:00Z')
const read = (name: string): string => readFileSync(resolve(DATA, name), 'utf8')
const vegas = JSON.parse(read('event-ufc-vegas-123.json')) as EventPayload

/** Serves the published snapshot files and answers everything else (the live API) with a 404, like static hosting. */
function stubFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    const m = /data\/([\w.-]+\.json)$/.exec(url)
    if (m) {
      try {
        return new Response(read(m[1]), { status: 200, headers: { 'content-type': 'application/json' } })
      } catch {
        return new Response('<html>not found</html>', { status: 404 })
      }
    }
    return new Response('<html>not found</html>', { status: 404 })
  }))
}

/** A plain in-memory Storage. Node 26 defines its own experimental localStorage that hides jsdom's. */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  stubFetch()
  vi.stubGlobal('localStorage', memoryStorage())
  window.location.hash = ''
  // jsdom has no layout engine: give elements a parent as their offsetParent and stub scrolling.
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return this.parentNode } })
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const headline = async (): Promise<HTMLElement> => screen.findByRole('heading', { level: 1 })

describe('event page', () => {
  it('shows the headline, the picker, highlights and every bout on the card', async () => {
    render(<App />)
    expect((await headline()).textContent).toBe('Moicano vs. Nolan')
    expect(screen.getByRole('navigation', { name: 'Choose an event' })).toBeTruthy()
    expect(within(screen.getByRole('navigation', { name: 'Choose an event' })).getAllByRole('button')).toHaveLength(4)
    expect(screen.getByRole('region', { name: 'Card highlights' })).toBeTruthy()
    const cards = screen.getAllByRole('button', { name: /Open details\.$/ })
    expect(cards).toHaveLength(vegas.fights.length)
  })

  it('says plainly what it does not have, and reports the card as checked because the data says so', async () => {
    render(<App />)
    await headline()
    expect(screen.getByRole('button', { name: /No live odds/ })).toBeTruthy()
    expect(screen.getByText(/Public snapshot/, { selector: 'button' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Checked against ufc\.com, Oct 25/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /not verified/ })).toBeNull()
  })

  it('flags a card that has not been checked, so the label cannot be hard-coded', async () => {
    const unverified = JSON.parse(read('event-ufc-vegas-123.json')) as EventPayload
    unverified.snapshot.verification = { status: 'unverified', note: 'Supplied by hand.' }
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (/event-ufc-vegas-123\.json$/.test(url)) return new Response(JSON.stringify(unverified), { status: 200 })
      const m = /data\/([\w.-]+\.json)$/.exec(url)
      return m ? new Response(read(m[1]), { status: 200 }) : new Response('nf', { status: 404 })
    }))
    render(<App />)
    await headline()
    expect(screen.getByRole('button', { name: /Card not verified against ufc\.com/ })).toBeTruthy()
  })

  it('filters to prelims and back', async () => {
    const user = userEvent.setup()
    render(<App />)
    await headline()
    const prelims = vegas.fights.filter((f) => f.bout?.card === 'prelim').length
    await user.click(screen.getByRole('button', { name: 'Prelims' }))
    expect(screen.getAllByRole('button', { name: /Open details\.$/ })).toHaveLength(prelims)
    expect(screen.queryByText('Main event')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'All bouts' }))
    expect(screen.getAllByRole('button', { name: /Open details\.$/ })).toHaveLength(vegas.fights.length)
  })

  it('sorts the grid by the closest call', async () => {
    const user = userEvent.setup()
    render(<App />)
    await headline()
    await user.selectOptions(screen.getByLabelText('Sort'), 'close')
    const first = screen.getAllByRole('button', { name: /Open details\.$/ })[1]
    expect(first.textContent).toMatch(/Toss-up|Slight lean/)
  })

  it('switches events from the picker and puts the event in the URL', async () => {
    const user = userEvent.setup()
    render(<App />)
    await headline()
    await user.click(screen.getByRole('button', { name: /Bonfim vs\. Brady/ }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Bonfim vs. Brady'))
    expect(window.location.hash).toBe('#/event/ufc-fight-night-bonfim-brady')
    expect(screen.getAllByRole('button', { name: /Open details\.$/ })).toHaveLength(13)
  })

  it('toggles the theme and remembers it', async () => {
    const user = userEvent.setup()
    render(<App />)
    await headline()
    await user.click(screen.getByRole('button', { name: 'Light theme' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('octaiq.theme')).toBe('light')
    await user.click(screen.getByRole('button', { name: 'Dark theme' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

describe('bout detail', () => {
  it('opens from a click, reflects the bout in the URL and closes with Escape', async () => {
    const user = userEvent.setup()
    render(<App />)
    await headline()
    await user.click(screen.getByRole('button', { name: /Renato Moicano versus Tom Nolan/ }))
    const dialog = await screen.findByRole('dialog', { name: /Renato Moicano versus Tom Nolan/ })
    expect(window.location.hash).toBe('#/event/ufc-vegas-123/bout/ufc-vegas-123-1')
    expect(within(dialog).getByRole('region', { name: 'Prediction' })).toBeTruthy()
    expect(within(dialog).getByText(/How far to trust this/)).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.location.hash).toBe('#/event/ufc-vegas-123')
  })

  it('opens straight from a shared link', async () => {
    window.location.hash = '#/event/ufc-vegas-123/bout/ufc-vegas-123-2'
    render(<App />)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('Randy Brown versus Jacobe Smith')
  })

  it('shows the likely range, the method odds, and the verification notes', async () => {
    window.location.hash = '#/event/ufc-vegas-123/bout/ufc-vegas-123-9'
    render(<App />)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Likely range for/)).toBeTruthy()
    expect(within(dialog).getByRole('region', { name: 'How it could end' })).toBeTruthy()
    expect(within(dialog).getByRole('region', { name: 'Worth checking' }).textContent).toMatch(/Erosa/)
  })

  it('keeps Tab inside the dialog, wrapping from last to first and back', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/event/ufc-vegas-123/bout/ufc-vegas-123-1'
    render(<App />)
    const dialog = await screen.findByRole('dialog')
    const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), summary')]
    const [first, last] = [focusable[0], focusable[focusable.length - 1]]
    last.focus()
    await user.tab()
    expect(document.activeElement).toBe(first)
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(last)
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('opens a fighter page, then returns to the bout', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/event/ufc-vegas-123/bout/ufc-vegas-123-1'
    render(<App />)
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: /Tom Nolan: career and rating history/ }))
    expect(window.location.hash).toBe('#/event/ufc-vegas-123/bout/ufc-vegas-123-1/fighter/tom-nolan')
    const fighter = await screen.findByRole('article', { name: /Tom Nolan: career and rating history/ })
    await waitFor(() => expect(within(fighter).getByRole('region', { name: 'Fight history' })).toBeTruthy())
    expect(within(fighter).getByRole('region', { name: 'Rating history' })).toBeTruthy()
    await user.click(within(fighter).getByRole('button', { name: 'Back to the bout' }))
    await waitFor(() => expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Renato Moicano versus Tom Nolan'))
  })

  it('explains a fighter with no UFC history instead of showing an empty page', async () => {
    window.location.hash = '#/event/ufc-vegas-123/fighter/lucia-szabova'
    render(<App />)
    expect(await screen.findByText(/No UFC fights were found for “Lucia Szabova”/)).toBeTruthy()
  })
})

describe('track record and model health', () => {
  it('shows saved picks and says nothing has been graded yet', async () => {
    window.location.hash = '#/record'
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Track record', level: 1 })).toBeTruthy()
    await waitFor(() => expect(screen.getByText('None yet')).toBeTruthy())
    expect(screen.getAllByRole('region', { name: /UFC/ }).length).toBeGreaterThanOrEqual(4)
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(20)
  })

  it('expands a replayed event to show each pick and its result', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/record'
    render(<App />)
    const heads = await screen.findAllByRole('button', { expanded: false })
    const replay = heads.find((b) => /Buckley vs\. Malott/.test(b.textContent ?? ''))
    expect(replay).toBeTruthy()
    await user.click(replay as HTMLElement)
    expect(replay?.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByText(/Correct|Missed/).length).toBeGreaterThan(5)
  })

  it('shows the market result honestly on the Model health page', async () => {
    window.location.hash = '#/health'
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Model health', level: 1 })).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/Gap to betting prices/)).toBeTruthy())
    expect(screen.getByText(/the market was more accurate/i)).toBeTruthy()
  })

  it('hides the betting tools on the public snapshot', async () => {
    render(<App />)
    await headline()
    for (const name of [/Value board/, /Parlay/, /Bankroll/]) expect(screen.queryByRole('button', { name })).toBeNull()
  })
})

describe('accessibility', () => {
  const scan = async (node: Element): Promise<string[]> => {
    const result = await axe.run(node as HTMLElement, {
      // Contrast and landmark layout need a real rendering engine; the browser audit covers them.
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    })
    return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')})`)
  }

  it('the event page has no detectable violations', async () => {
    render(<App />)
    await headline()
    expect(await scan(document.body)).toEqual([])
  })

  it('an open bout dialog has no detectable violations', async () => {
    window.location.hash = '#/event/ufc-vegas-123/bout/ufc-vegas-123-1'
    render(<App />)
    await screen.findByRole('dialog')
    expect(await scan(document.body)).toEqual([])
  })

  it('the track record and model health pages have no detectable violations', async () => {
    window.location.hash = '#/record'
    const { unmount } = render(<App />)
    await waitFor(() => expect(screen.getByText('None yet')).toBeTruthy())
    expect(await scan(document.body)).toEqual([])
    unmount()
    window.location.hash = '#/health'
    render(<App />)
    await waitFor(() => expect(screen.getByText(/Gap to betting prices/)).toBeTruthy())
    expect(await scan(document.body)).toEqual([])
  })

  it('gives every image-like chart an accessible name', async () => {
    window.location.hash = '#/event/ufc-vegas-123/bout/ufc-vegas-123-1'
    render(<App />)
    const dialog = await screen.findByRole('dialog')
    for (const img of within(dialog).getAllByRole('img')) expect(img.getAttribute('aria-label')).toBeTruthy()
  })
})

/** Static hosting plus extra published files, such as market prices. */
function stubFetchWith(extra: Record<string, unknown>): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    const m = /data\/([\w.-]+\.json)$/.exec(url)
    if (m && extra[m[1]] !== undefined) return new Response(JSON.stringify(extra[m[1]]), { status: 200 })
    if (m) {
      try {
        return new Response(read(m[1]), { status: 200 })
      } catch {
        return new Response('<html>nf</html>', { status: 404 })
      }
    }
    return new Response('<html>nf</html>', { status: 404 })
  }))
}

const marketFor = (pA: number) => ({
  generatedAt: '2026-10-26T06:00:00Z', source: 'The Odds API', attribution: 'Prices: The Odds API.',
  events: { 'ufc-vegas-123': Object.fromEntries(vegas.fights.map((f, i) => [f.id, { pA: i === 0 ? pA : 0.5, pLo: 0.4, pHi: 0.6, books: 9 }])) },
})

describe('bout detail extras', () => {
  it('explains the pick in plain words and lets you choose your own', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/event/ufc-vegas-123/bout/ufc-vegas-123-1'
    render(<App />)
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('region', { name: 'Why this pick' })).toBeTruthy()
    expect(within(dialog).getByText('Younger')).toBeTruthy()
    const group = within(dialog).getByRole('group', { name: 'Your pick' })
    const first = within(group).getAllByRole('button')[0]
    await user.click(first)
    expect(first.getAttribute('aria-pressed')).toBe('true')
    await user.click(first)
    expect(first.getAttribute('aria-pressed')).toBe('false')
  })

  it('shows how often picks this confident have won, from the backtest', async () => {
    window.location.hash = '#/event/ufc-vegas-123/bout/ufc-vegas-123-1'
    render(<App />)
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByText(/picks have won \d+% of the time/)).toBeTruthy())
  })

  it('draws the market movement once there are two looks, and offers a fair-price parlay leg', async () => {
    const user = userEvent.setup()
    const id = vegas.fights[0].id
    stubFetchWith({
      'market.json': marketFor(0.55),
      'prices.json': { generatedAt: 'x', events: { 'ufc-vegas-123': [
        { t: '2026-10-25T00:00:00Z', bouts: { [id]: { pA: 0.5, books: 8 } } },
        { t: '2026-10-26T00:00:00Z', bouts: { [id]: { pA: 0.55, books: 9 } } },
      ] } },
    })
    window.location.hash = `#/event/ufc-vegas-123/bout/${id}`
    render(<App />)
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('region', { name: 'Price movement' })).toBeTruthy()
    await user.click(within(dialog).getAllByRole('button', { name: /to parlay at the fair price/ })[0])
    await waitFor(() => expect(screen.getByRole('button', { name: /Parlay \(1\)/ })).toBeTruthy())
  })
})

describe('new pages', () => {
  it('compares two fighters from the searchable list', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/compare'
    render(<App />)
    expect((await screen.findByRole('heading', { level: 1, name: 'Compare fighters' }))).toBeTruthy()
    await user.type(screen.getByLabelText('Fighter A'), 'jon j')
    await user.click(await screen.findByRole('option', { name: /Jon Jones/ }))
    await user.type(screen.getByLabelText('Fighter B'), 'aspin')
    await user.click(await screen.findByRole('option', { name: /Tom Aspinall/ }))
    expect(window.location.hash).toBe('#/compare/jon-jones/tom-aspinall')
    expect(await screen.findByText(/Elo alone gives/)).toBeTruthy()
    expect(screen.getByText('Wins by KO or TKO')).toBeTruthy()
  })

  it('opens a comparison straight from a shared link', async () => {
    window.location.hash = '#/compare/islam-makhachev/jon-jones'
    render(<App />)
    expect(await screen.findByText(/Elo alone gives/)).toBeTruthy()
  })

  it('model versus market: explains the missing prices, then ranks the disagreements', async () => {
    window.location.hash = '#/gaps'
    const { unmount } = render(<App />)
    expect(await screen.findByText(/Betting prices are not published for this card yet/)).toBeTruthy()
    unmount()
    stubFetchWith({ 'market.json': marketFor(0.9) })
    window.location.hash = '#/gaps'
    render(<App />)
    const table = await screen.findByRole('table')
    const first = within(table).getAllByRole('row')[1]
    expect(within(first).getByText(/pts more on/)).toBeTruthy()
  })

  it('odds calculator: converts formats and strips the margin', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/tools'
    render(<App />)
    await user.type(await screen.findByLabelText('Fighter A odds'), '-150')
    await user.type(screen.getByLabelText('Fighter B odds (optional)'), '+130')
    expect(screen.getByText(/60\.0%/)).toBeTruthy()
    expect(screen.getByText(/Bookmaker margin/)).toBeTruthy()
    await user.clear(screen.getByLabelText('Fighter A odds'))
    await user.type(screen.getByLabelText('Fighter A odds'), 'abc')
    expect(screen.getByRole('alert').textContent).toMatch(/not a valid american price/)
  })

  it('keeps your picks on the Tools page, only in this browser', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/event/ufc-vegas-123/bout/ufc-vegas-123-1'
    const { unmount } = render(<App />)
    const dialog = await screen.findByRole('dialog')
    await user.click(within(within(dialog).getByRole('group', { name: 'Your pick' })).getAllByRole('button')[1])
    unmount()
    window.location.hash = '#/tools'
    render(<App />)
    expect(await screen.findByRole('region', { name: 'My picks' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Remove your pick of/ })).toHaveLength(1)
  })

  it('the new pages have no detectable violations', async () => {
    for (const hash of ['#/compare/jon-jones/tom-aspinall', '#/gaps', '#/tools']) {
      window.location.hash = hash
      const { unmount } = render(<App />)
      await waitFor(() => expect(document.querySelector('h1')).toBeTruthy())
      await waitFor(() => expect(screen.queryByText('Loading fighters…')).toBeNull())
      const result = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })
      expect(result.violations.map((v) => `${hash} ${v.id}: ${v.help}`)).toEqual([])
      unmount()
    }
  })
})
