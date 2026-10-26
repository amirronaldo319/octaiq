import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { scanDirectory, scanText } from './bundleScan.ts'

const dirs: string[] = []
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

describe('scanText', () => {
  it('flags key-shaped text and exact secret values', () => {
    expect(scanText('a.js', 'fetch("https://x/odds?apiKey=abcdef1234567890abcd")').map((f) => f.rule)).toContain('apiKey query value')
    expect(scanText('a.js', 'const ODDS_API_KEY = "abcdef1234567890"').length).toBe(1)
    expect(scanText('a.js', 'hello SUPERSECRETVALUE1234 world', ['SUPERSECRETVALUE1234']).map((f) => f.rule)).toEqual(['exact value of a secret from the environment'])
  })
  it('does not flag the harmless words the app really contains', () => {
    expect(scanText('a.js', 'Add your ODDS_API_KEY as a secret. regions=us&apiKey=')).toEqual([])
    expect(scanText('a.js', 'process.env.ODDS_API_KEY', ['short'])).toEqual([])
  })
})

describe('scanDirectory', () => {
  it('walks nested folders, scans text assets only and tolerates a missing folder', () => {
    const d = mkdtempSync(join(tmpdir(), 'octaiq-scan-'))
    dirs.push(d)
    mkdirSync(join(d, 'assets'))
    writeFileSync(join(d, 'assets', 'app.js'), 'x?apiKey=ABCDEFGHIJKLMNOP1234')
    writeFileSync(join(d, 'font.woff'), 'apiKey=ABCDEFGHIJKLMNOP1234')
    writeFileSync(join(d, 'index.html'), '<p>clean</p>')
    const found = scanDirectory(d)
    expect(found).toHaveLength(1)
    expect(found[0].file).toContain('app.js')
    expect(scanDirectory(join(d, 'nope'))).toEqual([])
  })
})
