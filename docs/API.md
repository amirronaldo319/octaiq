# Data and API contracts

OctaIQ's site is static (GitHub Pages). Most "endpoints" are published JSON files, rebuilt by the refresh workflow; only prices have an optional live service. This page lists what exists, what was deliberately not built, and why.

## Published files (static, versioned by the deploy)

| Path | Contents | Freshness |
| --- | --- | --- |
| `data/events.json` | Events the site tracks, with verification status | Each refresh |
| `data/event-<id>.json` | The card, forecasts with ranges, method odds, reasons, shadow-model note | Each refresh |
| `data/ledger.json` | Every saved forecast version (ID, supersedes, model, data version, horizon, reason), graded results, results by horizon | Each refresh |
| `data/backtest.json` | The walk-forward evaluation, promotion gates, reproducibility record | Each refresh |
| `data/market.json` | Margin-removed bookmaker consensus per bout; no per-bookmaker quotes | Each refresh when `ODDS_API_KEY` is set |
| `data/prices.json` | Consensus history per event | Same |
| `data/monitor.json` | Published-forecast results, input checks, drift, shadow comparison, price freshness, alerts | Each refresh |
| `data/fighters.json`, `data/fighter-index.json` | Career timelines; searchable fighter list | Each refresh |

Every file carries a generation time. The site shows how old prices are and refuses to call them live.

## Prices service (optional, `server/worker/`, API version 1)

`GET /api/market[?event=<id>]` — consensus per bout plus `freshness { fetchedAt, ageHours, stale, lastError }`.
`GET /api/prices[?event=<id>]` — consensus history.
`GET /api/system/health` — `{ apiVersion, status: ok | degraded | no-data, lastSuccessAt, lastAttemptAt, lastError, marketAgeHours, quota }`.

All errors are `{ "error": "<message>" }` with a 4xx or 5xx status. Only `GET` and `OPTIONS`; unknown query parameters are rejected; one allowed browser origin; 60 requests per client per minute. The shapes are defined in `server/worker/contracts.ts` and every response is checked against them in `server/worker/handler.test.ts`.

## Not built, on purpose

The brief suggested a FastAPI and PostgreSQL stack with per-fight forecast, odds, history and comparison endpoints. Not built because:

- there is no hosting, database or budget behind this project, and a static site plus scheduled jobs already serves every page the site has;
- immutable forecast records live in git (versioned and inspectable, though not tamper-proof), and price history in `data/prices/`;
- the unreplaceable constraints are the provider's terms (no raw per-bookmaker feed) and the absence of a validated in-play feed, neither of which a bigger backend changes.

If traffic or per-user features ever justify it, the typed shapes above are the contract to carry across.
