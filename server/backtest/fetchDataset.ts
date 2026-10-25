import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const SOURCE = {
  repo: 'https://github.com/Greco1899/scrape_ufc_stats',
  rawBase: 'https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main',
  license: 'GPL-3.0 (repository LICENSE file)',
  upstream: 'ufcstats.com (scraped by the repository author)',
  files: ['ufc_event_details.csv', 'ufc_fight_results.csv', 'ufc_fighter_tott.csv', 'ufc_fight_stats.csv', 'LICENSE'],
} as const

export interface ManifestFile { name: string; url: string; bytes: number; sha256: string }
export interface Manifest {
  source: typeof SOURCE.repo
  license: string
  upstream: string
  retrievedAt: string
  files: ManifestFile[]
}

export async function download(url: string, attempts = 3): Promise<string> {
  let lastStatus = 0
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
      if (res.ok) return await res.text()
      lastStatus = res.status
    } catch {
      lastStatus = 0
    }
  }
  throw new Error(`Failed to download ${url} (last status ${lastStatus || 'network error'})`)
}

/** Downloads the dataset into `dir` and writes a manifest with checksums so every report is traceable. */
export async function fetchDataset(dir: string, fetchText: (url: string) => Promise<string> = download): Promise<Manifest> {
  mkdirSync(dir, { recursive: true })
  const files: ManifestFile[] = []
  for (const name of SOURCE.files) {
    const url = `${SOURCE.rawBase}/${name}`
    const text = await fetchText(url)
    if (text.trim().length === 0) throw new Error(`${name} was empty`)
    writeFileSync(join(dir, name), text)
    files.push({ name, url, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') })
  }
  const manifest: Manifest = {
    source: SOURCE.repo, license: SOURCE.license, upstream: SOURCE.upstream, retrievedAt: new Date().toISOString(), files,
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return manifest
}
