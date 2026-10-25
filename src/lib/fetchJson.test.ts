import { describe, expect, it } from 'vitest'
import { getFirstJson, getJson, withBase } from './fetchJson'

const res = (body: unknown, status = 200, raw = false): Response =>
  new Response(raw ? String(body) : JSON.stringify(body), { status })

const fakeFetch = (routes: Record<string, () => Response>): typeof fetch =>
  (async (url: string | URL | Request) => {
    const h = routes[String(url)]
    if (!h) throw new Error(`unexpected ${String(url)}`)
    return h()
  }) as typeof fetch

describe('getJson', () => {
  it('returns parsed JSON and status without throwing on errors or non-JSON bodies', async () => {
    const f = fakeFetch({ ok: () => res({ a: 1 }), nf: () => res('<html>404</html>', 404, true), bad: () => res('nope', 200, true) })
    expect(await getJson('ok', undefined, f)).toEqual({ ok: true, status: 200, body: { a: 1 } })
    expect(await getJson('nf', undefined, f)).toEqual({ ok: false, status: 404, body: null })
    expect((await getJson('bad', undefined, f)).body).toBeNull()
  })
})

describe('getFirstJson', () => {
  const accept = (b: unknown): boolean => typeof b === 'object' && b !== null && 'fights' in b

  it('prefers the first source that succeeds and passes validation', async () => {
    const f = fakeFetch({ live: () => res({ fights: [1] }), snap: () => res({ fights: [2] }) })
    const r = await getFirstJson(['live', 'snap'], accept, undefined, f)
    expect(r?.url).toBe('live')
  })

  it('falls back to the static snapshot when the API is missing (static hosting returns an HTML 404)', async () => {
    const f = fakeFetch({ live: () => res('<html>Not found</html>', 404, true), snap: () => res({ fights: [2] }) })
    expect((await getFirstJson(['live', 'snap'], accept, undefined, f))?.url).toBe('snap')
  })

  it('skips a source that answers 200 but with the wrong shape, and survives network errors', async () => {
    const f = fakeFetch({ wrong: () => res({ error: 'x' }), snap: () => res({ fights: [] }) })
    expect((await getFirstJson(['down', 'wrong', 'snap'], accept, undefined, f))?.url).toBe('snap')
  })

  it('returns null when nothing works', async () => {
    const f = fakeFetch({ a: () => res('x', 500, true) })
    expect(await getFirstJson(['a'], accept, undefined, f)).toBeNull()
  })

  it('rethrows an abort so callers can ignore stale loads', async () => {
    const f = (async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) }) as typeof fetch
    await expect(getFirstJson(['a'], accept, undefined, f)).rejects.toThrow('aborted')
  })
})

describe('withBase', () => {
  it('joins paths without doubling slashes', () => {
    const p = withBase('data/event.json')
    expect(p.endsWith('data/event.json')).toBe(true)
    expect(p).not.toMatch(/[^:]\/\//)
  })
})
