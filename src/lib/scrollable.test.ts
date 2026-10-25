// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { markScrollable } from './scrollable'

function table(scroll: number, client: number): HTMLElement {
  const el = document.createElement('table')
  el.className = 'tbl'
  Object.defineProperty(el, 'scrollWidth', { value: scroll, configurable: true })
  Object.defineProperty(el, 'clientWidth', { value: client, configurable: true })
  document.body.appendChild(el)
  return el
}

describe('markScrollable', () => {
  it('makes only the tables that overflow focusable, and undoes it when they fit again', () => {
    const wide = table(600, 300)
    const narrow = table(300, 300)
    markScrollable()
    expect(wide.getAttribute('tabindex')).toBe('0')
    expect(narrow.hasAttribute('tabindex')).toBe(false)
    Object.defineProperty(wide, 'scrollWidth', { value: 300, configurable: true })
    markScrollable()
    expect(wide.hasAttribute('tabindex')).toBe(false)
  })
})
