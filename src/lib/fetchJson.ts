export interface JsonResult {
  ok: boolean
  status: number
  body: unknown
}

/** GET a URL and parse JSON without throwing on HTTP errors or non-JSON bodies (e.g. a host's 404 page). */
export async function getJson(url: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<JsonResult> {
  const res = await fetchImpl(url, { signal })
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) }
}

/**
 * Tries each URL in order and returns the first successful JSON response that passes `accept`.
 * Used to prefer the live API and fall back to a static snapshot on static hosting.
 */
export async function getFirstJson(
  urls: readonly string[],
  accept: (body: unknown) => boolean,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<{ url: string; result: JsonResult } | null> {
  for (const url of urls) {
    try {
      const result = await getJson(url, signal, fetchImpl)
      if (result.ok && accept(result.body)) return { url, result }
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err
    }
  }
  return null
}

/** Resolves a path against Vite's base so the app works at a domain root or under /repo-name/. */
export const withBase = (path: string): string => `${import.meta.env.BASE_URL}${path}`.replace(/([^:]\/)\/+/g, '$1')
