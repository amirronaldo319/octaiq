# OctaIQ evaluation report
Generated 2026-10-26T05:36:03.178Z by `npm run report` from `data/reports/backtest-latest.json`. Every number below comes from that file; none is typed by hand.

## 1. Reproduce this report

- Command: `npm run backtest` after `npm install` (the results data is downloaded on first run).
- Results data version `58ca637e2e2c` (retrieved 2026-10-25); price data version `d03e93106059`.
- Feature pipeline `features-3`; code commit `34554fed1e675339cebd9afa51fa8a3a8eff9b1a` (the working tree had uncommitted changes, so the commit alone does not reproduce this run); v26.7.0; random seed 20261025.
- Elo K 64, statistics decay 0.9, ridge 5, 1000 event-level bootstrap resamples; features excluded by default: ageMissing, reachMissing, southpaw, wcMove, eloWc, agePast, ageClass, sinceLoss, koRecent, cageMin, tdClash, kdClash.
The results data keeps growing, so a later run uses more fights; the data version says which files a report used.

## 2. Data
- Source: https://github.com/Greco1899/scrape_ufc_stats (GPL-3.0 (repository LICENSE file)), scraped from ufcstats.com (scraped by the repository author).
- 8948 bouts from 1994-03-11 to 2026-10-17; 8792 decisive fights are scored and 156 draws or no-contests are excluded.
- Fights with per-fight statistics: 8927.

## 3. Evaluation protocol
- Walk-forward by year: each year from 2014 is forecast by a model trained on earlier events only; every bout from one event stays together; test period 2014-2026, 6288 fights.
- Settings chosen on 2008-2013 only (Elo K, statistics decay). Calibration methods are fitted on earlier years' out-of-sample forecasts.
- Primary metric: out-of-sample log loss. Brier score, winner accuracy and the calibration slope and intercept are reported alongside.
- **There is no untouched final holdout.** Years in the test period have informed development decisions (feature trials, the stats-feature rule, the promotion thresholds were fixed in code but after earlier looks). The only clean out-of-sample evidence is the prospective record in `data/ledger/`, which grows as events are graded.
- Experiments counted in this report: 7 challenger comparisons and 8 ablations, after earlier rounds of feature trials noted in the README. A best-of-many result should be read with that in mind.

## 4. Models on the same fights
Event-level 95% intervals. Calibration slope 1 is ideal; below 1 means forecasts are too extreme.

| Model | n | Log loss [95% CI] | Brier | Accuracy | Calibration slope | Intercept |
| --- | --- | --- | --- | --- | --- | --- |
| Coin flip (0.5) | 6288 | 0.6931 [0.6931, 0.6931] | 0.2500 | 0.500 | – | – |
| Elo only | 6288 | 0.6817 [0.6778, 0.6856] | 0.2444 | 0.558 | 0.88 | -0.02 |
| Logistic regression (results features) | 6288 | 0.6592 [0.6530, 0.6655] | 0.2335 | 0.604 | 1.00 | -0.02 |
| Logistic regression (results + rolling fight stats) | 6288 | 0.6521 [0.6449, 0.6596] | 0.2301 | 0.616 | 0.92 | -0.02 |
| Boosted trees (all features) | 6288 | 0.6565 [0.6501, 0.6628] | 0.2322 | 0.612 | 1.02 | -0.02 |
| Ensemble (logistic + trees) | 6288 | 0.6516 [0.6450, 0.6580] | 0.2299 | 0.617 | 1.04 | -0.02 |

Production model: **lrStats** (log loss 0.6521, accuracy 0.616).

## 5. Promotion gates
Fixed before results were read: paired interval entirely below zero, improvement of at least 0.002, better in at least 60% of yearly folds, calibration slope between 0.8 and 1.2.

| Challenger | Against | Decision | Why |
| --- | --- | --- | --- |
| Rolling fight statistics | results-only model | promote | log loss -0.0071 versus results-only model [-0.0115, -0.0032]; the interval is entirely below zero; the improvement is at least 0.002; better in 11 of 13 yearly folds; calibration slope 0.92 is acceptable |
| Boosted trees | logistic stats model | reject | log loss +0.0044 versus logistic stats model [+0.0005, +0.0081]; the interval includes zero; the improvement is under the 0.002 minimum; better in 4 of 13 yearly folds (needs 60%); calibration slope 1.02 is acceptable |
| Ensemble of logistic and trees | logistic stats model | shadow | log loss -0.0005 versus logistic stats model [-0.0025, +0.0013]; the interval includes zero; the improvement is under the 0.002 minimum; better in 8 of 13 yearly folds; calibration slope 1.04 is acceptable |
| Calibration: temperature | no recalibration | reject | log loss +0.0006 versus no recalibration [-0.0009, +0.0022]; the interval includes zero; the improvement is under the 0.002 minimum; better in 5 of 11 yearly folds (needs 60%) |
| Calibration: platt | no recalibration | reject | log loss +0.0006 versus no recalibration [-0.0009, +0.0022]; the interval includes zero; the improvement is under the 0.002 minimum; better in 5 of 11 yearly folds (needs 60%) |
| Calibration: isotonic | no recalibration | reject | log loss +0.0009 versus no recalibration [-0.0003, +0.0021]; the interval includes zero; the improvement is under the 0.002 minimum; better in 4 of 11 yearly folds (needs 60%) |
| Direct six-outcome method model (hybrid with the win model) | independent winner-and-method joint | shadow | log loss -0.0034 versus independent winner-and-method joint [-0.0101, +0.0030]; the interval includes zero; the improvement is at least 0.002; better in 7 of 13 yearly folds (needs 60%) |

## 6. Against the betting market
The figures the site shows on Model health (winner accuracy 0.597 for the model against 0.644 for the market) are this matched sample.
Period 2014-2020, 2735 fights with matched prices (average margin 0.033).
On 2735 bouts with prices (2014-2020), the model's log loss 0.6639 is worse than the market's 0.6180 (gap +0.0460, 95% CI 0.0326 to 0.0589; positive means worse). Blending the model into the price changed log loss by -0.0007 [-0.0025, 0.0013] versus the raw price, and by -0.0009 [-0.0027, 0.0008] versus the price recalibrated on the same earlier years, so the model does not demonstrably add information beyond the price.

| Model | Log loss [95% CI] | Accuracy | Difference from market |
| --- | --- | --- | --- |
| Betting market (de-vigged price) | 0.6180 [0.6046, 0.6316] | 0.644 | reference |
| Coin flip (0.5) | 0.6931 [0.6931, 0.6931] | 0.500 | +0.0752 [+0.0617, +0.0886] |
| Elo only | 0.6839 [0.6779, 0.6898] | 0.551 | +0.0659 [+0.0527, +0.0785] |
| Model: results features | 0.6688 [0.6594, 0.6778] | 0.587 | +0.0508 [+0.0386, +0.0625] |
| Model: results + rolling fight stats | 0.6639 [0.6516, 0.6753] | 0.597 | +0.0460 [+0.0326, +0.0589] |

**Does the model add information beyond the price?** Blend versus the price recalibrated on the same earlier years: -0.0009 [-0.0027, +0.0008] (negative would mean yes). The interval includes zero, so it is not demonstrated.

The model alone is worse than the market.

Limits:
- The dataset does not say which bookmaker, or whether the price is opening, closing or best-available. Treat it as an as-recorded market price, not a verified closing line.
- Coverage ends March 2020 and only 2014 onward overlaps the model test years, so the comparison does not cover the last six years.
- A model that matches the market on log loss still cannot profit after the margin; beating the market needs a consistent, significant gap in the model’s favour.
- Matching is by date and fighter name; bouts that could not be matched are excluded, which may bias the sample toward well-known fighters.

## 7. Method predictions
Period 2014-2026. The default joint distribution multiplies the win probability by the method model, assuming winner and method are independent given the features. A direct six-outcome model is tested against it each time and used only if it is clearly better.

| Outcome model | n | Log loss | Against the base rate [95% CI] | Accuracy | Base-rate accuracy |
| --- | --- | --- | --- | --- | --- |
| Goes the distance | 6321 | 0.6760 | -0.0236 [-0.0321, -0.0148] | 0.583 | 0.503 |
| KO share of finishes | 3180 | 0.5906 | -0.0619 [-0.0775, -0.0445] | 0.690 | 0.644 |
| Winner and method together | 6273 | 1.6264 | -0.0971 [-0.1100, -0.0832] | 0.317 | 0.242 |

Direct six-outcome model against the independent joint: -0.0023 [-0.0085, +0.0048]; hybrid with the validated win probability: -0.0034 [-0.0101, +0.0030]. In use: **independent**.

## 8. Calibration methods
Each fitted on earlier years only, scored on the next year, on the same fights.

| Method | Log loss | Against none [95% CI] |
| --- | --- | --- |
| none | 0.6492 | reference |
| temperature | 0.6498 | +0.0006 [-0.0009, +0.0022] |
| platt | 0.6498 | +0.0006 [-0.0009, +0.0022] |
| isotonic | 0.6500 | +0.0009 [-0.0003, +0.0021] |

## 9. Where it does better and worse
Groups with at least 100 fights only; small groups are not shown because they cannot support conclusions.

| Group | n | Log loss | Accuracy |
| --- | --- | --- | --- |
| Both fighters have 3+ prior UFC bouts | 3131 | 0.6442 | 0.629 |
| At least one fighter has fewer than 3 prior UFC bouts | 3157 | 0.6599 | 0.604 |
| Five-round bouts | 614 | 0.6457 | 0.621 |
| Women's divisions | 927 | 0.6597 | 0.619 |
| Big favourite (the stats model gives one side 70% or more) | 1263 | 0.5687 | 0.743 |
| Close call (the stats model gives each side between 45% and 55%) | 1526 | 0.6937 | 0.509 |
| Either fighter off for a year or more | 1164 | 0.6531 | 0.619 |
| Both fighters fought within the last year | 5124 | 0.6518 | 0.615 |
| Division: Flyweight | 388 | 0.6412 | 0.624 |
| Division: Bantamweight | 670 | 0.6393 | 0.622 |
| Division: Featherweight | 722 | 0.6595 | 0.604 |
| Division: Lightweight | 945 | 0.6405 | 0.642 |
| Division: Welterweight | 883 | 0.6612 | 0.587 |
| Division: Middleweight | 721 | 0.6567 | 0.627 |
| Division: Light Heavyweight | 452 | 0.6817 | 0.569 |
| Division: Heavyweight | 457 | 0.6202 | 0.667 |

## 10. Ablations
The same walk-forward protocol with different feature sets.

| Variant | Log loss | Accuracy | Note |
| --- | --- | --- | --- |
| Results + rolling fight stats | 0.6521 | 0.616 | The stats model. Adopted only if it beats results-only beyond noise. |
| Results + stats, without opponent quality and recent activity | 0.6546 | 0.616 | The same model before the strength-of-schedule and activity features were added. |
| Results + stats, plus stance, weight-class, age-decline, damage and style-clash features | 0.6524 | 0.616 | Tried and not adopted: no meaningful gain over the default model. |
| Results only | 0.6592 | 0.604 | The previous primary model. |
| Stats + Elo, no other results features | 0.6585 | 0.603 | Shows how much the fight statistics carry on their own. |
| Results + stats, plus missing-profile flags | 0.6493 | 0.627 | Known leak: profile completeness today reflects future career length. Shown only for comparison. |
| Results only, no age or reach | 0.6647 | 0.589 | Needs no fighter-profile snapshot at all. |
| Elo + experience only | 0.6638 | 0.591 | Smallest feature set. |

## 11. Registry
Production: `octa-results-stats-lr-0.2@58ca637e2e2c`. Records: 32.

| Record | Status | Data version | Note |
| --- | --- | --- | --- |
| octa-results-stats-lr-0.2@58ca637e2e2c | production | 58ca637e2e2c |  |
| Boosted trees@58ca637e2e2c | rejected | 58ca637e2e2c | log loss +0.0044 versus logistic stats model [+0.0005, +0.0081]; the interval includes zero |
| Ensemble of logistic and trees@58ca637e2e2c | shadow | 58ca637e2e2c | log loss -0.0005 versus logistic stats model [-0.0025, +0.0013]; the interval includes zero |
| Calibration: temperature@58ca637e2e2c | rejected | 58ca637e2e2c | log loss +0.0006 versus no recalibration [-0.0009, +0.0022]; the interval includes zero |
| Calibration: platt@58ca637e2e2c | rejected | 58ca637e2e2c | log loss +0.0006 versus no recalibration [-0.0009, +0.0022]; the interval includes zero |
| Calibration: isotonic@58ca637e2e2c | rejected | 58ca637e2e2c | log loss +0.0009 versus no recalibration [-0.0003, +0.0021]; the interval includes zero |
| Direct six-outcome method model (hybrid with the win model)@58ca637e2e2c | shadow | 58ca637e2e2c | log loss -0.0034 versus independent winner-and-method joint [-0.0101, +0.0030]; the interval includes zero |
| octa-results-stats-lr-0.2@0075c265d94e | previous | 0075c265d94e |  |
| Boosted trees@0075c265d94e | rejected | 0075c265d94e | log loss +0.0044 versus logistic stats model [+0.0007, +0.0079]; the interval includes zero |
| Ensemble of logistic and trees@0075c265d94e | shadow | 0075c265d94e | log loss -0.0005 versus logistic stats model [-0.0024, +0.0013]; the interval includes zero |
| Calibration: temperature@0075c265d94e | rejected | 0075c265d94e | log loss +0.0006 versus no recalibration [-0.0008, +0.0022]; the interval includes zero |
| Calibration: platt@0075c265d94e | rejected | 0075c265d94e | log loss +0.0006 versus no recalibration [-0.0008, +0.0022]; the interval includes zero |
| Calibration: isotonic@0075c265d94e | rejected | 0075c265d94e | log loss +0.0009 versus no recalibration [-0.0004, +0.0022]; the interval includes zero |
| Direct six-outcome method model (hybrid with the win model)@0075c265d94e | shadow | 0075c265d94e | log loss -0.0034 versus independent winner-and-method joint [-0.0096, +0.0026]; the interval includes zero |
| research:lr_all@58ca637e2e2c | shadow | 58ca637e2e2c | Inconclusive against the gate; log loss -0.0001 against the baseline [-0.0017, 0.0015] |
| research:histgb@58ca637e2e2c | rejected | 58ca637e2e2c | Rejected by the gate; log loss +0.0223 against the baseline [0.0172, 0.0281] |
| research:lightgbm@58ca637e2e2c | rejected | 58ca637e2e2c | Rejected by the gate; log loss +0.0216 against the baseline [0.0165, 0.0273] |
| research:xgboost@58ca637e2e2c | rejected | 58ca637e2e2c | Rejected by the gate; log loss +0.0172 against the baseline [0.0123, 0.0224] |
| research:catboost@58ca637e2e2c | rejected | 58ca637e2e2c | Rejected by the gate; log loss +0.0122 against the baseline [0.0080, 0.0170] |
| research:lightgbm_es@58ca637e2e2c | rejected | 58ca637e2e2c | Rejected by the gate; log loss +0.0036 against the baseline [0.0005, 0.0069] |
| research:xgboost_es@58ca637e2e2c | rejected | 58ca637e2e2c | Rejected by the gate; log loss +0.0046 against the baseline [0.0013, 0.0082] |
| research:catboost_es@58ca637e2e2c | rejected | 58ca637e2e2c | Rejected by the gate; log loss +0.0026 against the baseline [-0.0003, 0.0058] |
| research:glicko2@58ca637e2e2c | rejected | 58ca637e2e2c | Rejected by the gate; log loss +0.0282 against the baseline [0.0216, 0.0350] |
| research:hier@58ca637e2e2c | shadow | 58ca637e2e2c | Inconclusive against the gate; log loss -0.0000 against the baseline [-0.0001, 0.0000] |
| research:hier_decay@58ca637e2e2c | shadow | 58ca637e2e2c | Cleared the gate in research; not deployed as production; log loss -0.0022 against the baseline [-0.0036, -0.0007] |
| research:lr_decay@58ca637e2e2c | shadow | 58ca637e2e2c | Inconclusive against the gate; log loss -0.0020 against the baseline [-0.0035, -0.0006] |
| research:lr_decay_noreach@58ca637e2e2c | shadow | 58ca637e2e2c | Inconclusive against the gate; log loss -0.0017 against the baseline [-0.0041, 0.0007] |
| research:elo_only@58ca637e2e2c | rejected | 58ca637e2e2c | Rejected by the gate; log loss +0.0297 against the baseline [0.0230, 0.0365] |
| research:neural: linear_torch@58ca637e2e2c | rejected | 58ca637e2e2c | Rejected by the gate; log loss +0.0001 against the baseline [-0.0018, 0.0020] |
| research:neural: mlp@58ca637e2e2c | rejected | 58ca637e2e2c | Rejected by the gate; log loss +0.0005 against the baseline [-0.0018, 0.0028] |
| research:neural: gru@58ca637e2e2c | rejected | 58ca637e2e2c | Rejected by the gate; log loss +0.0002 against the baseline [-0.0028, 0.0033] |
| research:neural: attn@58ca637e2e2c | rejected | 58ca637e2e2c | Rejected by the gate; log loss +0.0008 against the baseline [-0.0018, 0.0036] |
