# Betting prices: provider, architecture, setup and cost

Everything below about providers was read from their public pages on **2026-10-26**. Prices and terms change; re-read the linked pages before spending money.

## Provider decision

**Chosen: The Odds API** (https://the-odds-api.com), v4 REST.

| Question | What the provider's pages say (read 2026-10-26) |
| --- | --- |
| UFC/MMA | Sport key `mma_mixed_martial_arts`. No separate UFC key. |
| Markets for MMA | Generic markets are listed (`h2h`, `spreads`, `totals`), but **no page states which of them MMA gets**, and no MMA method-of-victory or round markets are listed. OctaIQ therefore reads **moneyline (`h2h`) only**. The MMA-specific page `/sports/mma-ufc-odds.html` was linked but not read; check it before adding any market. |
| Bookmakers | Region keys `us`, `us2`, `uk`, `eu`, `au` (plus others). For example `us` lists draftkings, fanduel, betmgm, betrivers, bovada, betonlineag, mybookieag, lowvig, betus (Caesars `williamhill_us` and `fanatics` are paid-plan only); `eu` includes pinnacle. The page says some books "may not list for less popular sports"; MMA coverage per book is not stated. |
| Cost | "Each specified market costs 1 against the usage quota, for each region." OctaIQ's default three regions cost 3 credits per request. |
| Refresh | Pre-match featured markets update about every 60 seconds, faster near the start. In-play `h2h` 40 seconds. Whether MMA has in-play odds is **not stated**. |
| Provider timestamp | Market-level `last_update` is the last time the provider saw odds for that market from the bookmaker. OctaIQ stores it separately from the time it fetched. |
| Historical | Paid plans only; 10 credits per region per market; 10-minute snapshots from 2020-06-06 (5-minute from Sept 2022); `mma_mixed_martial_arts` is in the earliest-timestamps table. OctaIQ does not buy this; it records its own history going forward. |
| Plans | Starter free, 500 credits/month; 20K $30/month; 100K $59/month; 5M $119/month; 15M $249/month. |
| Terms (last updated 31 Aug 2026) | Allowed: storing data indefinitely, displaying it in a website or app (including commercially), calculating and displaying derived values, training models. **Prohibited: reselling or redistributing the data as a standalone product, or offering it through your own API, data feed or downloadable files as a source of raw data for others.** Attribution is not required. |

What the terms mean for this project: OctaIQ may display prices and values derived from them, but must not publish bookmaker-by-bookmaker quotes as a feed or file. So the public site and the public API return a **margin-removed consensus probability and a bookmaker count only**. Per-bookmaker quotes appear only when someone runs OctaIQ locally with their own key.

**Not chosen: OpticOdds** (https://opticodds.com, docs at https://developer.opticodds.com). It lists UFC as `ufc` (that detail came from a summary of a long page, so it is not verbatim-confirmed) and offers REST and Server-Sent Events streaming, but: pricing is quote-only (no public price list), UFC/MMA markets and per-book coverage are not stated anywhere I could read, and its terms of service (last updated 09/01/2023) say the service may not be used "for any revenue-generating endeavor or commercial enterprise", with no caching or redistribution clauses found in the part I read. Ask OpticOdds for written terms and a UFC market list before considering it. Streaming is only worth that effort if in-fight prices become a goal (see below).

## Architecture

```
The Odds API ──► ingestion (scheduled) ──► validated store ──► public read-only API ──► site
                  retries, timeout,         market:latest        GET /api/market
                  quota headers,            prices:<event>       GET /api/prices
                  adaptive polling          raw snapshots (private)
```

There are two supported ways to run the ingestion; both use the same code.

1. **GitHub Actions only (default, no extra service).** `refresh.yml` runs every six hours and runs `npm run prices`. It writes `data/prices/<event>.json` (the consensus history), `public/data/market.json` and `public/data/prices.json`, then the site redeploys. No visitor ever causes a provider call. Freshness is a few hours, and the site says so.
2. **A small protected service (`server/worker/`, Cloudflare Workers).** For fresher prices without redeploying the site. It holds the key as a secret, polls on a schedule that adapts to the time left before the event (`server/odds/plan.ts`: every 12 h a week out down to every 10 minutes in the last hour, none after the start), stores a validated consensus in KV, and serves `GET /api/market` and `GET /api/prices` with CORS limited to the site, a per-client rate limit, cache headers and a staleness flag. Raw provider responses are kept privately for 30 days and never served. **This repository ships and tests the code but does not deploy it.**

The browser never sees the key: it is read from environment variables or Worker secrets only, and `npm run check:bundle` fails the build if the built site contains a key-shaped string or the exact value of a key in the environment.

### How prices become a probability

For each bookmaker, take its own two moneyline prices for the same market, convert to decimal, invert (`q = 1/decimal`), and divide each by `qA + qB` (proportional margin removal). This assumes the bookmaker spreads its margin in proportion to the probabilities, which is only approximately true; it is a market-implied estimate, not a true probability. A pair is dropped if its provider timestamp is more than 12 hours old, or its margin is below 0 or above 30%. The same bookmaker returned by two regions counts once (newest timestamp), related feeds (for example several `hardrockbet_*` keys) count once, at most ten bookmakers are used (Pinnacle, DraftKings, FanDuel, BetMGM, Caesars, Bovada, BetOnline, BetRivers, ESPN Bet, Fanatics first), and the consensus is the equal-weight mean. Best prices from different books are never combined. Quotes after the scheduled start are in-play and are ignored.

### What is shown, and what is not

Shown: the independent OctaIQ forecast, the market consensus, the disagreement between them (labelled as disagreement, not as an edge), when the prices were collected and how old that is, and the consensus history. **A combined model is not offered**, because in the matched 2014–2020 history blending the model with the price did not improve on the price recalibrated on the same earlier years (see `docs/REPORT.md`).

### In-fight prices and forecasts: not built

Once the scheduled start passes, the site shows the last pre-fight prices labelled as such. It shows no in-play prices and no live model forecast: the provider does not state in-play MMA support, and there is no reliable timestamped fight-state feed (round, clock, actions) to validate a live model against. The frozen pre-fight forecast is never presented as a live estimate.

## Setup

Environment variable names (never commit values):

| Name | Where | Purpose |
| --- | --- | --- |
| `ODDS_API_KEY` | GitHub Actions secret, local `.env`, Worker secret | The Odds API key. |
| `ODDS_REGIONS` | Optional repository variable | Comma-separated regions. The refresh workflow defaults to `us` (about 296 credits a month, inside the free 500); the code's own default is `us,us2,eu`. |
| `UFCALENDAR_API_KEY` | Optional, local only | Licensed fighter statistics; never published. |
| `ALLOWED_ORIGIN`, `SITE_BASE` | Worker `[vars]` in `server/worker/wrangler.toml` | The one origin allowed to read the API, and where event files are published. |
| `VITE_MARKET_API_URL` | Site build (public, not secret) | Base URL of the deployed service. When unset the site reads the static `data/market.json`. |

GitHub Actions: Settings → Secrets and variables → Actions → add `ODDS_API_KEY`. The next refresh run picks it up.

Worker (optional):

```bash
npx wrangler kv namespace create MARKET        # paste the id into server/worker/wrangler.toml
npx wrangler secret put ODDS_API_KEY
npx wrangler deploy --config server/worker/wrangler.toml
# then rebuild the site with VITE_MARKET_API_URL set to the Worker URL
```

Add a platform rate-limiting rule in front of the Worker as well; the in-code limit is approximate.

## Cost assumptions (the plans above, 2026-10-26)

`server/odds/plan.ts` simulates polling for four weekly cards in a 30-day month (`npm test` checks it): about **296 requests**, so

- one region (`ODDS_REGIONS=us`): about **296 credits**, inside the free 500;
- three regions (default): about **888 credits**, which needs the **$30/month 20K plan**, and leaves most of its 20,000 credits for faster polling.

The six-hourly GitHub Actions schedule asks at most 4 times a day (about 360 credits a month with three regions, 120 with one), and `npm run prices` skips the call when no event is within two weeks or when prices are newer than the interval for the time left (`--force` overrides). Check `x-requests-remaining` in the Worker's stored `meta` or in the provider dashboard; the ingestion records the quota headers after every call.

## Status

- Verified with real provider calls: **nothing**. No `ODDS_API_KEY` is available in this environment. The adapter, normalisation, consensus, caching, service and tests use clearly labelled fixtures and a mocked `fetch`; none of it is shown as live data.
- Needed to go live: an `ODDS_API_KEY` secret (free tier works with `ODDS_REGIONS=us`), and optionally the Worker deployment above.
