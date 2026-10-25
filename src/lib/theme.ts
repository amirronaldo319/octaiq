import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'
const KEY = 'octaiq.theme'

/** The saved choice, else the system preference, else dark. Storage can be blocked, so every access is guarded. */
export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* storage unavailable */
  }
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', theme === 'light' ? '#f5f7fb' : '#0a0e14')
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => initialTheme())
  useEffect(() => applyTheme(theme), [theme])
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(KEY, next)
      } catch {
        /* storage unavailable: the choice lasts for this visit */
      }
      return next
    })
  }, [])
  return [theme, toggle]
}
