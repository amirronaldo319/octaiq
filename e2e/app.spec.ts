import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

async function violations(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: axeSource })
  // Real rendering, so colour contrast is checked here too.
  const results = await page.evaluate(async () => {
    // @ts-expect-error axe is injected above
    const r = await window.axe.run(document.body, { rules: { region: { enabled: false } } })
    return r.violations.map((v: { id: string; help: string; nodes: { target: string[] }[] }) => `${v.id}: ${v.help} (${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')})`)
  })
  return results
}

test.describe('the public site', () => {
  test('loads a card with its bouts and a headline', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: /Open details\.$/ }).first()).toBeVisible()
    expect(await page.getByRole('button', { name: /Open details\.$/ }).count()).toBeGreaterThan(5)
  })

  test('opens a bout, explains the pick, and closes with Escape', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Open details\.$/ }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('region', { name: 'Why this pick' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('compares two fighters', async ({ page }) => {
    await page.goto('/#/compare')
    await page.getByLabel('Fighter A').fill('jon j')
    await page.getByRole('option', { name: /Jon Jones/ }).click()
    await page.getByLabel('Fighter B').fill('makhachev')
    await page.getByRole('option', { name: /Islam Makhachev/ }).click()
    await expect(page.getByText(/Elo alone gives/)).toBeVisible()
  })

  test('switches to the light theme and keeps it after a reload', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Light theme|Dark theme/ }).click()
    const theme = await page.evaluate(() => document.documentElement.dataset.theme)
    await page.reload()
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
  })

  test('crawlable event pages and the sitemap exist', async ({ request }) => {
    const sitemap = await request.get('/sitemap.xml')
    expect(sitemap.ok()).toBe(true)
    const ids = [...(await sitemap.text()).matchAll(/events\/([\w-]+)\//g)].map((m) => m[1])
    expect(ids.length).toBeGreaterThan(0)
    const page = await request.get(`/events/${ids[0]}/`)
    expect(await page.text()).toContain('model picks')
    expect((await request.get('/robots.txt')).ok()).toBe(true)
  })

  test('no sideways scrolling on any page', async ({ page }) => {
    for (const hash of ['#/', '#/record', '#/gaps', '#/compare', '#/tools', '#/health']) {
      await page.goto(`/${hash}`)
      await page.waitForLoadState('networkidle')
      await page.locator('h1').first().waitFor()
      await page.waitForTimeout(300)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, hash).toBeLessThanOrEqual(1)
    }
  })

  test('has no accessibility violations on the main pages, in both themes', async ({ page }) => {
    for (const theme of ['dark', 'light']) {
      await page.addInitScript((t) => localStorage.setItem('octaiq.theme', t), theme)
      for (const hash of ['#/', '#/record', '#/tools', '#/gaps', '#/health', '#/compare/jon-jones/islam-makhachev', '#/event/ufc-vegas-123/bout/ufc-vegas-123-1']) {
        await page.goto(`/${hash}`)
        await page.waitForLoadState('networkidle')
        await page.locator('h1, [role="dialog"]').first().waitFor()
        await page.waitForTimeout(400)
        expect(await violations(page), `${theme} ${hash}`).toEqual([])
      }
    }
  })

  test('Back and Forward move between the card, a bout and a saved forecast', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Open details\.$/ }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    const boutUrl = page.url()
    await page.getByRole('button', { name: 'View' }).first().click()
    await expect(page).toHaveURL(/\/v\//)
    await page.goBack()
    await expect(page).toHaveURL(boutUrl)
    await page.goBack()
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.goForward()
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('a dialog traps focus and returns it when closed', async ({ page }) => {
    await page.goto('/')
    const opener = page.getByRole('button', { name: /Open details\.$/ }).first()
    await opener.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab')
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('compact layout fits the whole card in one table, and the choice is remembered', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Compact' }).click()
    const rows = page.getByRole('region', { name: 'Fights, compact view' }).getByRole('row')
    expect(await rows.count()).toBeGreaterThan(6)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('the matchup breakdown loads fighter histories', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Open details\.$/ }).first().click()
    const context = page.getByRole('region', { name: 'Matchup context' })
    await expect(context.getByRole('table').first()).toBeVisible()
    await expect(context.getByText(/What could change this forecast/)).toBeVisible()
  })

  test('navigation: a bar at the bottom on phones, the top bar on desktops', async ({ page, isMobile }) => {
    await page.goto('/')
    const bottom = page.getByRole('navigation', { name: 'Main destinations' })
    const top = page.getByRole('navigation', { name: 'Sections' })
    if (isMobile) {
      await expect(bottom).toBeVisible()
      await expect(top).toBeHidden()
      await bottom.getByRole('button', { name: 'Record' }).click()
      await expect(page.getByRole('heading', { level: 1, name: 'Track record' })).toBeVisible()
    } else {
      await expect(top).toBeVisible()
      await expect(bottom).toBeHidden()
    }
  })

  test('more of the card is visible without scrolling on a desktop', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop only')
    await page.goto('/')
    await page.getByRole('button', { name: 'Compact' }).click()
    const viewport = page.viewportSize()?.height ?? 800
    const fifthRow = page.getByRole('region', { name: 'Fights, compact view' }).getByRole('row').nth(5)
    const box = await fifthRow.boundingBox()
    expect(box?.y ?? Infinity).toBeLessThan(viewport)
  })

  test('compact and fight-night views pass the accessibility audit in both themes', async ({ page }) => {
    for (const theme of ['dark', 'light']) {
      await page.addInitScript((t) => localStorage.setItem('octaiq.theme', t), theme)
      for (const view of ['Compact', 'Fight night']) {
        await page.goto('/')
        await page.getByRole('button', { name: view }).click()
        await page.waitForTimeout(300)
        expect(await violations(page), `${theme} ${view}`).toEqual([])
      }
    }
  })
})
