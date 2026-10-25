# OctaIQ

UFC predictions you can check. For each upcoming card it shows win probabilities with a likely range, how each fight could end, and how the model compares with the betting market. Every pick is saved before the event and graded in public.

**Live site:** https://amirronaldo319.github.io/octaiq/

The public site is a snapshot: no API keys, no live bookmaker quotes. Run it yourself with your own keys for the full version (below).

## What it does

| Area | What you get |
|---|---|
| Event pages | Four official cards (checked against ufc.com), a countdown in venue time with Eastern alongside, one card per bout, filters and sorting |
| Bout detail | Model pick with a 90% range, a trust meter, accuracy against a coin flip and the market, goes-the-distance and method odds, verification notes, a shareable link per bout |
| Fighter pages | UFC record, an Elo rating chart, recent-form statistics and the full fight history |
| Betting market | A consensus probability with the margin removed, and a market/model toggle. Per-bookmaker quotes are never published |
| Track record | An append-only ledger of predictions saved before each event, graded automatically once results appear, plus a replay of the last six events |
| Model health | Backtest results with confidence intervals, calibration, the comparison with betting prices, and the leak I found and fixed |
| Local-only tools | Value board, parlay builder and bankroll tracker (they need live prices, so they are hidden on the public site) |

Also: a light theme, offline support, link previews, deep links, keyboard and screen-reader support, and a phone layout.

## Why the numbers deserve some trust (and where they don't)

- **Walk-forward testing.** Each year from 2014 is predicted by a model trained only on earlier years. Intervals are 95% event-level bootstrap.
- **No leakage.** Features use only fights dated before the event; a bout's own result and statistics never reach its own features. Tests inject a deliberate leak to confirm they would catch it, and a noise-only world must score like a coin flip.
- **Fixed adoption rule.** The rolling fight-statistics features are used only if their paired gain over the results-only model has a 95% interval entirely below zero.
- **Honest comparison with the market.** On 2,735 past fights with betting prices, the market was more accurate than the model (log loss 0.618 against 0.664). Blending the model into the price added nothing demonstrable. Treat the model as context, not a betting edge.
- **Public ledger.** `data/ledger/` holds what the model said before each event. Entries are never edited, nothing is recorded once an event starts, and the GitHub commit history is the timestamp.

What it cannot see: styles, injuries, weigh-ins, camp news, and anything outside UFC results and per-minute fight statistics. The method model assumes winner and method are independent given the features. The ranges reflect how much the answer depends on which past fights were used, not everything the model cannot see.

## Run it locally

```bash
npm install
npm run dev            # demo data, no server needed
```

For real data and keys:

```bash
cp .env.example .env   # add ODDS_API_KEY and, optionally, UFCALENDAR_API_KEY
npm run check-keys     # verifies both keys against the real APIs; never prints them
npm start              # builds, then serves the app and API at http://127.0.0.1:8787
```

Keys stay on the server and are never sent to the browser. Odds come from [The Odds API](https://the-odds-api.com); fighter statistics from [UFCalendar](https://www.ufcalendar.com) or your own `data/fighters.csv` (see `data/README.md`).

## Commands

| Command | Does |
|---|---|
| `npm run backtest` | Downloads the open datasets, runs the walk-forward evaluation, ablations, outcome models and market comparison |
| `npm run ledger` | Appends new predictions to `data/ledger/` if they changed and the event has not started |
| `npm run snapshot` | Rebuilds `public/data/` (events, fighters, ledger, backtest). Rewrites a file only when its content changed |
| `npm run refresh` | `backtest`, then `ledger`, then `snapshot` |
| `npm run market` | After a build, writes `dist/data/market.json` from live odds (needs `ODDS_API_KEY`; skips cleanly without it) |
| `npm run check-keys` | Checks API keys without printing them (`-- --no-odds` skips the one credit it costs) |
| `npm test` | 270+ tests, including a browser-simulated app and accessibility scans |

## Keeping the card current

Cards live in `data/events/*.json` as versioned snapshots. To record a change (a replaced opponent, a new bout), add a snapshot with a higher `version`; the app lists what changed between versions. Each snapshot carries its source and a `verification` block. To add an event, add a file; it appears in the picker. Re-check against ufc.com in fight week: the official page is the authority, and an automated read is not a person checking.

## Automation

Three GitHub Actions workflows run on this repository:

- **Deploy** (`pages.yml`): on every push and every six hours. Typechecks, tests, builds, adds market prices if a key is set, and deploys.
- **Refresh** (`refresh.yml`): every six hours. Re-runs the backtest, records new predictions, refreshes the snapshot, commits only if something changed, and triggers a deploy.
- **Checks** (`ci.yml`): typecheck, tests and build on pull requests.

To show live prices on the public site, add your Odds API key as a repository secret named `ODDS_API_KEY` (Settings, Secrets and variables, Actions). Without it the site simply shows model probabilities. The consensus (the default view) averages up to ten bookmakers (Pinnacle, DraftKings, FanDuel, BetMGM, Caesars, Bovada, BetOnline, BetRivers, ESPN Bet, Fanatics and so on, in that order of preference). Each fetch costs 3 credits (three regions), so the six-hourly deploy uses about 360 of the free tier's 500 monthly credits; pushes cost 3 each.

## Data and licenses

OctaIQ's own code is MIT licensed ([LICENSE](LICENSE)). Data keeps its own terms, and none of it is bundled in the source:

- **Results and statistics:** [Greco1899/scrape_ufc_stats](https://github.com/Greco1899/scrape_ufc_stats), declared GPL-3.0, scraped from ufcstats.com. Downloaded at run time into `data/raw/` (git-ignored). I could not review ufcstats.com's own terms for the underlying data, so check them before commercial or redistributed use. The published `public/data/fighters.json` holds career timelines for the fighters on the cards, derived from it.
- **Historical prices:** [UFC Fights (2010-2020) with Betting Odds, OpenML 43464](https://www.openml.org/d/43464), labelled CC BY 4.0 (original uploader not named by OpenML). Used only to measure the model against the market; the file does not say which bookmaker or whether prices are closing lines.
- **Live prices:** [The Odds API](https://the-odds-api.com). Its terms allow storing data, displaying values derived from it, and training models, and forbid reselling it as a raw feed. The site publishes consensus probabilities only.
- **Fighter statistics API:** [UFCalendar](https://www.ufcalendar.com). Its terms forbid redistributing its data and using it for regulated betting operations, so it is used only locally and never published.
- **Card information:** the official UFC event pages, read by an automated fetch, plus ESPN Deportes for records.
- **Fonts:** Barlow and Barlow Condensed (SIL Open Font License), self-hosted.

## Not done, on purpose

- **Fighter photos.** Matching the right person to a licensed image, with correct attribution, is a risk I did not want to take with a guess.
- **Live fight tracking and news monitoring.** They need a verified low-latency feed that is not available here.
- **Betting execution.** Nothing here places or suggests a wager.

OctaIQ is a research project, not betting advice. Please gamble responsibly.
