import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, initialTheme } from './theme'

function stubBrowser(opts: { saved?: string | null; prefersLight?: boolean; storageThrows?: boolean }): void {
  const store = {
    getItem: (): string | null => {
      if (opts.storageThrows) throw new Error('blocked')
      return opts.saved ?? null
    },
  }
  vi.stubGlobal('localStorage', store)
  vi.stubGlobal('window', { matchMedia: () => ({ matches: Boolean(opts.prefersLight) }) })
}

describe('initialTheme', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('uses the saved choice over the system setting', () => {
    stubBrowser({ saved: 'dark', prefersLight: true })
    expect(initialTheme()).toBe('dark')
    stubBrowser({ saved: 'light', prefersLight: false })
    expect(initialTheme()).toBe('light')
  })

  it('follows the system when nothing is saved, and defaults to dark', () => {
    stubBrowser({ saved: null, prefersLight: true })
    expect(initialTheme()).toBe('light')
    stubBrowser({ saved: null, prefersLight: false })
    expect(initialTheme()).toBe('dark')
  })

  it('ignores junk in storage and survives blocked storage', () => {
    stubBrowser({ saved: 'purple', prefersLight: false })
    expect(initialTheme()).toBe('dark')
    stubBrowser({ storageThrows: true, prefersLight: true })
    expect(initialTheme()).toBe('light')
  })

  it('applies the theme to the document and the browser chrome colour', () => {
    const attrs: Record<string, string> = {}
    vi.stubGlobal('document', {
      documentElement: { dataset: attrs },
      querySelector: () => ({ setAttribute: (k: string, v: string) => { attrs[k] = v } }),
    })
    applyTheme('light')
    expect(attrs.theme).toBe('light')
    expect(attrs.content).toBe('#f5f7fb')
    applyTheme('dark')
    expect(attrs.content).toBe('#0a0e14')
  })
})
