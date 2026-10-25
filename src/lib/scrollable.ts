import { useEffect } from 'react'

const SELECTOR = '.tbl'

/** Makes any table that scrolls sideways reachable by keyboard, and leaves tables that fit alone. */
export function markScrollable(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
    const scrolls = el.scrollWidth > el.clientWidth + 1
    if (scrolls && !el.hasAttribute('tabindex')) {
      el.setAttribute('tabindex', '0')
      el.dataset.autoFocusable = 'true'
    } else if (!scrolls && el.dataset.autoFocusable === 'true') {
      el.removeAttribute('tabindex')
      delete el.dataset.autoFocusable
    }
  })
}

/** Keeps tables keyboard-scrollable as content loads and the window changes size. */
export function useScrollableTables(): void {
  useEffect(() => {
    let frame = 0
    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => markScrollable())
    }
    schedule()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [])
}
