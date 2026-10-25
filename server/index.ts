import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { parseFighterCsv } from './lib/csv.ts'
import { createResultsModelService } from './backtest/resultsModel.ts'
import { createEventService } from './lib/eventService.ts'
import { createFileCache } from './lib/fighterCache.ts'
import { createFileHistory } from './lib/history.ts'
import { combineProviders, type FighterProvider } from './lib/providers.ts'
import { createCardService, ServiceError } from './lib/service.ts'
import { createUfcalendarProvider } from './lib/ufcalendar.ts'

const ROOT = resolve(import.meta.dirname, '..')
const PORT = Number(process.env.PORT ?? 8787)
const STATS_PATH = resolve(ROOT, process.env.FIGHTER_STATS_CSV ?? 'data/fighters.csv')
const DIST = resolve(ROOT, 'dist')
const TTL_MS = Math.max(60, Number(process.env.ODDS_CACHE_SECONDS ?? 300)) * 1000

const UFCALENDAR_KEY = process.env.UFCALENDAR_API_KEY?.trim() || undefined

/** Hand-curated CSV; always wins over the API for the fighters it lists. */
const csvProvider: FighterProvider = async () => {
  if (!existsSync(STATS_PATH)) {
    // The CSV is optional once an API key is configured.
    return { fighters: [], warnings: UFCALENDAR_KEY ? [] : [`No fighter stats file at ${STATS_PATH}. See data/README.md.`] }
  }
  return parseFighterCsv(readFileSync(STATS_PATH, 'utf8'))
}

const apiProvider: FighterProvider | null = UFCALENDAR_KEY
  ? createUfcalendarProvider({
      apiKey: UFCALENDAR_KEY,
      fetchImpl: fetch,
      cache: createFileCache(resolve(ROOT, 'data/fighter-cache.json')),
    })
  : null

const history = createFileHistory(resolve(ROOT, 'data/odds-history.json'))
const loadFighters = combineProviders(csvProvider, apiProvider)

const service = createCardService({
  apiKey: process.env.ODDS_API_KEY?.trim() || undefined,
  fetchImpl: fetch,
  ttlMs: TTL_MS,
  history,
  loadFighters,
})

const resultsModel = createResultsModelService(ROOT)
const events = createEventService({
  eventPath: resolve(ROOT, process.env.EVENT_FILE ?? 'data/events/ufc-vegas-123.json'),
  cards: service,
  loadFighters,
  history,
  resultsModel: (inputs) => resultsModel.predict(inputs),
})

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png',
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function serveStatic(urlPath: string, res: ServerResponse): void {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    res.writeHead(400).end('Bad request')
    return
  }
  const rel = normalize(decoded).replace(/^([/\\])+/, '')
  let file = resolve(DIST, rel || 'index.html')
  // Block path traversal out of dist/.
  if (file !== DIST && !file.startsWith(DIST + sep)) {
    res.writeHead(403).end('Forbidden')
    return
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html')
  if (!existsSync(file)) {
    res.writeHead(404).end('Run `npm run build` first, or use `npm run dev`.')
    return
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (req.method !== 'GET') {
    res.writeHead(405).end()
    return
  }
  if (url.pathname === '/api/card') {
    service.getCard().then(
      (payload) => sendJson(res, 200, payload),
      (err: unknown) => {
        const status = err instanceof ServiceError ? err.status : 500
        sendJson(res, status, { error: err instanceof ServiceError ? err.message : 'Internal error' })
      },
    )
    return
  }
  if (url.pathname === '/api/event') {
    events.getEvent().then(
      (payload) => sendJson(res, 200, payload),
      () => sendJson(res, 500, { error: 'Event file is missing or invalid. Check data/events/ and the server log.' }),
    )
    return
  }
  if (url.pathname === '/api/backtest') {
    const path = resolve(ROOT, 'data/reports/backtest-latest.json')
    if (!existsSync(path)) {
      sendJson(res, 404, { error: 'No backtest report yet. Run `npm run backtest`.' })
      return
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(readFileSync(path))
    return
  }
  if (url.pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'Not found' })
    return
  }
  serveStatic(url.pathname, res)
}).listen(PORT, '127.0.0.1', () => {
  console.info(
    `OctaIQ API on http://127.0.0.1:${PORT} (odds key ${process.env.ODDS_API_KEY ? 'set' : 'NOT set'}, ` +
      `stats API key ${UFCALENDAR_KEY ? 'set' : 'NOT set'})`,
  )
})
