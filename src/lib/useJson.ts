import { useEffect, useState } from 'react'
import { getFirstJson } from './fetchJson'

export type JsonState<T> = { status: 'idle' | 'loading' } | { status: 'ready'; data: T } | { status: 'missing' }

/** Loads the first URL that returns acceptable JSON. Pass `null` to stay idle until the data is needed. */
export function useJson<T>(urls: readonly string[] | null, accept: (body: unknown) => boolean): JsonState<T> {
  const [state, setState] = useState<JsonState<T>>({ status: urls ? 'loading' : 'idle' })
  const key = urls?.join('|') ?? ''

  useEffect(() => {
    if (!urls) {
      setState({ status: 'idle' })
      return
    }
    const controller = new AbortController()
    setState({ status: 'loading' })
    getFirstJson(urls, accept, controller.signal)
      .then((found) => setState(found ? { status: 'ready', data: found.result.body as T } : { status: 'missing' }))
      .catch((err: unknown) => {
        if ((err as Error).name !== 'AbortError') setState({ status: 'missing' })
      })
    return () => controller.abort()
    // `accept` is a stable module-level predicate at every call site; the URL list identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state
}
