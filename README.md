# OctaIQ

UFC betting analysis: odds comparison, a fight model with Monte Carlo simulation, value finder, parlay builder, bankroll tracker.

## Run with demo data
```
npm install
npm run dev
```

## Run with live odds
1. Get a free key at https://the-odds-api.com and copy `.env.example` to `.env`, setting `ODDS_API_KEY`.
2. Fighter stats, either or both:
   - **API (recommended):** set `UFCALENDAR_API_KEY` (see below). Stats are fetched only for fighters on the odds card and cached for 7 days.
   - **CSV:** copy `data/fighters.example.csv` to `data/fighters.csv` (see `data/README.md`). CSV rows always override the API.
3. `npm start` and open http://127.0.0.1:8787 (or run `npm run server` plus `npm run dev` for hot reload).

The key stays on the server and is never sent to the browser. Odds are cached for 5 minutes (one API credit per refresh).
Fights whose fighters are missing from the stats file are shown for price comparison only and excluded from the value board.

`npm run check-keys` verifies both keys against the real APIs and prints a short report (keys are never printed). It spends 1 Odds API credit and about 4-6 stats requests; add `-- --no-odds` to skip the odds credit.

`npm test` runs the unit tests.

## Stats API: UFCalendar

Keys come from https://www.ufcalendar.com/account/api and are sent as `Authorization: Bearer <key>` from the server only.
The free trial (1 day, 100 requests) is non-commercial evaluation; the paid plans start at $19/month for 30,000 requests.
Check the provider terms before relying on it: redistribution of the raw data is not allowed, and the terms say the API may not be used as an official-data feed for regulated betting operations.

Per fighter the adapter makes 2 requests (profile, history), plus 1 search request if the name-based lookup misses. A 12-fighter card costs roughly 24-36 requests the first time and nothing for the next 7 days.

Derived values: finish rate and chin come from career history (finishes per win; knockout losses), shrunk toward neutral for small samples. Cardio has no source and defaults to 0.75; set it in the CSV if you have a view.

## Event dashboard (UFC Vegas 123, Oct 31 2026)

The app opens on the event view when the server is running. The card lives in `data/events/ufc-vegas-123.json` as versioned snapshots:
to record a card change, append a new snapshot with a higher `version`; the app diffs versions and lists added, removed and replaced bouts.
Every bout can carry verification notes, and `unlisted` records bouts reported elsewhere but not on the card.

What is and is not verified:
- The card is the list supplied by the project owner (an Oct 25 snapshot of the official page). ufc.com could not be fetched from the build environment, so it is **not independently verified**. ESPN Deportes corroborates the pairings; conflicts between sources are shown in the app.
- Records come from ESPN Deportes (secondary) and are unchecked against UFC.com or UFCStats.
- No fighter statistics are bundled. Without `UFCALENDAR_API_KEY` or a CSV row, a bout shows records only and **no model output**. Odds need `ODDS_API_KEY`; without it prices show as unavailable, never estimated.
- Predictions are an **unvalidated baseline** (hand-weighted factors plus a seeded Monte Carlo simulation). There is no historical dataset, backtest or calibration in this repo yet, and the app says so on every prediction.

## Historical data and backtest

`npm run backtest` downloads results data (first run only; `npm run fetch-data` refreshes it), builds strictly pre-fight features, and runs a walk-forward evaluation. Output: a table in the terminal, `data/reports/backtest-latest.json`, and the **Model health** tab.

- **Dataset:** [Greco1899/scrape_ufc_stats](https://github.com/Greco1899/scrape_ufc_stats), which declares GPL-3.0 in its repository. The files are downloaded to `data/raw/ufc/` at run time with a checksum manifest and are git-ignored, not redistributed here. That data is scraped from ufcstats.com; I could not review the site's terms for the underlying data, so check them before any commercial or redistributed use.
- **Not used:** jansen88/ufc-data (no license file) and the Kaggle datasets (license pages could not be read).
- **Protocol:** each test year (2014 onward) is scored by a model trained only on earlier years. The Elo K-factor is chosen on 2008-2013 only. Intervals are 95% event-level bootstrap.
- **Leakage controls:** features use only bouts dated before the event (same-day results are applied after the day is featurised); fighter order is randomised because the raw file lists winners first far more often than chance; "missing profile" flags are excluded because they leak career length. Tests include a noise-only run that must not beat a coin flip.
- **Event page:** the "Validated results-only model" panel uses this model. Spelling differences between sources go in `data/aliases.json` (verified pairs only); unmatched fighters are shown as newcomers with a warning.

### Rolling fight statistics (added after the first backtest)

`ufc_fight_stats.csv` (per-round striking, takedown, control, submission and knockdown totals) feeds a second model. For each fighter it keeps decayed running totals of **earlier** fights only, turns them into per-minute rates shrunk toward the league average, and uses the differences between the two fighters. Fight length comes from the results file.

- The stats model is used for event predictions **only if** its paired log-loss gain over the results-only model has a 95% interval entirely below zero. That rule was fixed before the test results were read. Current outcome is on the Model health tab.
- A bout's own statistics are applied only after its date has been featurised. Tests include: altering a bout's own stats leaves its features unchanged; altering later fights' stats leaves earlier features unchanged; a run where outcomes are random but each fight's stats reveal its winner must still score like a coin flip. I confirmed the last two fail if a leak is injected into the feature builder.
- Statistics are not adjusted for opponent quality.

### Market baseline (historical prices)

`npm run backtest` also downloads **UFC Fights (2010-2020) with Betting Odds** ([OpenML 43464](https://www.openml.org/d/43464), labelled CC BY 4.0) to `data/raw/odds/`, verifies its published MD5, and compares the walk-forward predictions with the de-vigged prices on bouts that match by date and fighter names.

- **Attribution (CC BY 4.0):** UFC Fights (2010-2020) with Betting Odds, OpenML dataset 43464. The original uploader is not named in OpenML's metadata, and the license label is the uploader's; I could not verify the data's own upstream terms.
- **What it is not:** the file does not say which bookmaker, or whether prices are opening, closing or best-available, so it is an as-recorded market price rather than a verified closing line. Coverage ends March 2020.
- **Method:** prices are joined only after predictions exist and never enter features. Intervals are 95% event-level bootstrap. A walk-forward blend (fit on earlier years only) tests whether the model adds information beyond the price.
- **Other sources I checked:** The Odds API sells historical snapshots from June 2020 (paid; its terms allow storing the data and using it to train models), but MMA historical coverage is not documented, so it is not wired in. UFCalendar exposes closing consensus lines per settled bout with no documented history depth, and its terms forbid use for regulated betting operations. jansen88/ufc-data has odds but no license, so it is not used.

## License and third-party terms

OctaIQ's own code is released under the [MIT License](LICENSE).

That license covers this repository only. Data the app downloads or calls keeps its own terms, and none of it is bundled here:

- **Stats data** from [Greco1899/scrape_ufc_stats](https://github.com/Greco1899/scrape_ufc_stats) is downloaded at run time (the repository declares GPL-3.0; its data is scraped from ufcstats.com, whose terms I could not review).
- **Historical odds** from [OpenML 43464](https://www.openml.org/d/43464) are CC BY 4.0: attribution is given in the section above.
- **The Odds API** and **UFCalendar** are used with your own keys and are subject to their terms (for example, UFCalendar forbids redistributing its data and forbids use for regulated betting operations).

OctaIQ is a research tool, not betting advice. See the Model health tab: on past fights the bundled models were less accurate than betting prices.

## Public website

A static snapshot is published to GitHub Pages by `.github/workflows/pages.yml` on every push to `main`: https://amirronaldo319.github.io/octaiq/

The snapshot has the event card, the backtested model's predictions and the Model health tab. It has **no live odds and no licensed fighter statistics**, and no API keys are involved. To refresh it after changing the card or re-running the backtest: `npm run backtest && npm run snapshot`, then commit `public/data/`. For prices and the full model, run the app locally with your own keys.
