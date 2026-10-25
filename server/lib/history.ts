import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { HistoryStore } from './oddsApi.ts'

const MAX_POINTS = 60

/** Line history persisted as JSON so movement charts survive restarts. */
export function createFileHistory(path: string): HistoryStore {
  let data: Record<string, number[]> = {}
  try {
    if (existsSync(path)) data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, number[]>
  } catch {
    data = {}
  }
  return {
    record(eventId, line) {
      const series = data[eventId] ?? []
      if (series[series.length - 1] !== line) series.push(line)
      data[eventId] = series.slice(-MAX_POINTS)
      try {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, JSON.stringify(data))
      } catch {
        // Read-only filesystem: keep history in memory only.
      }
      return data[eventId]
    },
  }
}

export function createMemoryHistory(): HistoryStore {
  const data = new Map<string, number[]>()
  return {
    record(eventId, line) {
      const series = data.get(eventId) ?? []
      if (series[series.length - 1] !== line) series.push(line)
      data.set(eventId, series.slice(-MAX_POINTS))
      return data.get(eventId) as number[]
    },
  }
}
