import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/** Runs public/sw.js against fakes so its caching rules are tested without a browser. */
function load() {
  const code = readFileSync(resolve(import.meta.dirname, '../../public/sw.js'), 'utf8')
  const handlers: Record<string, (e: unknown) => void> = {}
  const store = new Map<string, Response>()
  const caches = {
    keys: async () => ['old', 'octaiq-v1'],
    delete: vi.fn(async () => true),
    open: async () => ({ put: async (req: { url: string }, res: Response) => void store.set(req.url, res) }),
    match: async (req: { url: string } | string) => store.get(typeof req === 'string' ? req : req.url),
  }
  const claim = vi.fn()
  const self = {
    location: { origin: 'https://site.test' },
    registration: { scope: 'https://site.test/octaiq/' },
    clients: { claim },
    skipWaiting: vi.fn(),
    addEventListener: (type: string, fn: (e: unknown) => void) => { handlers[type] = fn },
  }
  const fetchMock = vi.fn<(r: unknown) => Promise<Response>>()
  new Function('self', 'caches', 'fetch', 'URL', 'Response', code)(self, caches, fetchMock, URL, Response)
  const run = async (req: { url: string; method?: string; mode?: string }): Promise<{ handled: boolean; response?: Response }> => {
    let responded: Promise<Response> | undefined
    handlers.fetch({ request: { method: 'GET', mode: 'cors', ...req }, respondWith: (p: Promise<Response>) => { responded = p } })
    return responded ? { handled: true, response: await responded } : { handled: false }
  }
  return { handlers, caches, store, fetchMock, run, self, claim }
}

describe('service worker', () => {
  it('prefers the network and keeps a copy of good responses', async () => {
    const w = load()
    w.fetchMock.mockResolvedValue(new Response('fresh'))
    const out = await w.run({ url: 'https://site.test/octaiq/data/event.json' })
    expect(await out.response?.text()).toBe('fresh')
    expect(w.store.has('https://site.test/octaiq/data/event.json')).toBe(true)
  })

  it('falls back to the last good copy when offline, and to the app shell for page loads', async () => {
    const w = load()
    w.fetchMock.mockResolvedValueOnce(new Response('cached copy'))
    await w.run({ url: 'https://site.test/octaiq/data/event.json' })
    w.fetchMock.mockRejectedValue(new Error('offline'))
    expect(await (await w.run({ url: 'https://site.test/octaiq/data/event.json' })).response?.text()).toBe('cached copy')

    w.store.set('https://site.test/octaiq/', new Response('shell'))
    const nav = await w.run({ url: 'https://site.test/octaiq/#/record', mode: 'navigate' })
    expect(await nav.response?.text()).toBe('shell')
  })

  it('does not cache failures and returns an error when there is nothing to fall back on', async () => {
    const w = load()
    w.fetchMock.mockResolvedValue(new Response('nope', { status: 500 }))
    await w.run({ url: 'https://site.test/octaiq/x.json' })
    expect(w.store.size).toBe(0)
    w.fetchMock.mockRejectedValue(new Error('offline'))
    expect((await w.run({ url: 'https://site.test/octaiq/never-seen.json' })).response?.type).toBe('error')
  })

  it('leaves the live API, other origins and non-GET requests alone', async () => {
    const w = load()
    expect((await w.run({ url: 'https://site.test/api/card' })).handled).toBe(false)
    expect((await w.run({ url: 'https://elsewhere.test/a.js' })).handled).toBe(false)
    expect((await w.run({ url: 'https://site.test/octaiq/x', method: 'POST' })).handled).toBe(false)
  })

  it('removes old caches and takes over open pages on activate', async () => {
    const w = load()
    let done: Promise<unknown> | undefined
    w.handlers.activate({ waitUntil: (p: Promise<unknown>) => { done = p } })
    await done
    expect(w.caches.delete).toHaveBeenCalledWith('old')
    expect(w.caches.delete).not.toHaveBeenCalledWith('octaiq-v1')
    expect(w.claim).toHaveBeenCalled()
    w.handlers.install({})
    expect(w.self.skipWaiting).toHaveBeenCalled()
  })
})
