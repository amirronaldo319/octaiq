# Model research: families, ratings, ensembles, sequences and rounds
Generated from `data/experiments/*.json` (written by `research/run.py`, `neural.py`, `rounds.py`). Data version `58ca637e2e2c`, feature pipeline `features-3`, 2014-2026, 6288 fights.

## Reproduce
```bash
npm install
python3 -m venv research/.venv && research/.venv/bin/pip install -r research/requirements.txt   # on macOS also: brew install libomp
npm run backtest && npm run research:export
research/.venv/bin/python research/run.py      # families, ratings, hierarchical, ensembles, age/reach
research/.venv/bin/python research/neural.py   # sequence models
research/.venv/bin/python research/rounds.py   # round-of-ending
research/.venv/bin/python -m unittest discover -s research -p "test_*.py"
```
Python 3.14.7, numpy 2.5.4, pandas 3.1.0, scikit-learn 1.9.1.
**Reproduction check:** the Python production-form logistic regression gives log loss 0.651055 against 0.651052 for the TypeScript production model on the same 6288 fights (difference 2.9e-6). The two implementations agree, so the comparisons below are against the real baseline.

## Protocol
- Hyperparameters chosen on 2008-2013 using only earlier fights (24 Bayesian TPE trials per family); fixed afterwards.
- Each year 2014-2026 predicted by models fitted on earlier years only; events kept whole.
- Baseline: Production-form ridge logistic regression (no intercept) on the production feature set.
- 1000 resamples of whole events; paired differences on identical fights. Intervals are also given at a level widened for the number of challengers tested together (Bonferroni), because testing many models and reporting the best inflates apparent gains.
- 14 model variants, 96 Bayesian tuning trials, 6 feature ablations and 5 ensemble constructions were run in this round, after earlier rounds described in the README.
- **There is no untouched holdout.** Every test year has been used to compare models. The prospective record in `data/ledger/` is the only clean out-of-sample evidence.

## Model families on identical folds
Log loss is the primary metric. "Calibration slope" is 1 when forecasts are neither too extreme (below 1) nor too timid (above 1). Decisions use the fixed promotion gate (paired interval below zero, gain of at least 0.002, better in 60% of years, slope within 0.8 to 1.2), plus the multiple-comparison check.

| Model | Log loss | Brier | Accuracy | AUC | Cal. slope | Against the baseline [95% CI] | Adjusted interval | Years better | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Production-form ridge logistic regression (baseline) | 0.6511 | 0.2296 | 0.616 | 0.664 | 0.95 | reference |  |  |  |
| Logistic regression, all features, tuned ridge | 0.6519 | 0.2300 | 0.615 | 0.662 | 0.93 | +0.0009 [-0.0019, +0.0034] | [-0.0028, +0.0048] | 38% | reject |
| HistGradientBoosting | 0.6743 | 0.2407 | 0.598 | 0.638 | 2.52 | +0.0233 [+0.0181, +0.0293] | [+0.0142, +0.0312] | 0% | reject |
| LightGBM | 0.6737 | 0.2403 | 0.602 | 0.640 | 2.50 | +0.0226 [+0.0174, +0.0286] | [+0.0135, +0.0307] | 0% | reject |
| XGBoost | 0.6692 | 0.2381 | 0.610 | 0.650 | 2.31 | +0.0182 [+0.0133, +0.0237] | [+0.0097, +0.0257] | 0% | reject |
| CatBoost | 0.6643 | 0.2358 | 0.607 | 0.649 | 1.69 | +0.0132 [+0.0088, +0.0183] | [+0.0056, +0.0199] | 8% | reject |
| LightGBM, trees chosen inside the training period | 0.6556 | 0.2317 | 0.615 | 0.656 | 0.96 | +0.0046 [+0.0007, +0.0088] | [-0.0007, +0.0098] | 23% | reject |
| XGBoost, trees chosen inside the training period | 0.6567 | 0.2322 | 0.615 | 0.654 | 1.02 | +0.0056 [+0.0019, +0.0099] | [+0.0003, +0.0112] | 23% | reject |
| CatBoost, trees chosen inside the training period | 0.6546 | 0.2313 | 0.616 | 0.656 | 0.97 | +0.0036 [-0.0001, +0.0075] | [-0.0018, +0.0090] | 31% | reject |
| Glicko-2 ratings | 0.6803 | 0.2437 | 0.562 | 0.588 | 0.88 | +0.0292 [+0.0226, +0.0358] | [+0.0193, +0.0393] | 0% | reject |
| Hierarchical: production features plus fighter effects | 0.6509 | 0.2296 | 0.616 | 0.664 | 0.96 | -0.0002 [-0.0004, +0.0002] | [-0.0005, +0.0002] | 77% | shadow |
| Hierarchical, with older fights counting for less | 0.6498 | 0.2290 | 0.616 | 0.666 | 0.97 | -0.0012 [-0.0022, -0.0003] | [-0.0025, +0.0000] | 69% | shadow |
| Logistic regression, older fights count for less | 0.6511 | 0.2296 | 0.616 | 0.664 | 0.95 | +0.0000 [+0.0000, +0.0000] | [+0.0000, +0.0000] | 0% | reject |
| Same, with reach put back (the earlier production form) | 0.6521 | 0.2301 | 0.616 | 0.662 | 0.92 | +0.0010 [-0.0013, +0.0030] | [-0.0022, +0.0040] | 31% | reject |
| Elo only | 0.6817 | 0.2444 | 0.558 | 0.585 | 0.88 | +0.0307 [+0.0239, +0.0374] | [+0.0197, +0.0404] | 0% | reject |
| Coin flip | 0.6931 | 0.2500 | 0.500 | 0.500 | – | reference |  |  |  |

Always picking the higher-rated fighter is right 55.6% of the time (probabilities are not meaningful for that rule).

Gradient-boosted models trained with a fixed number of trees chosen on small early data are under-trained and clearly worse. Choosing the number of trees inside each training period (the "es" rows) fixes most of that, but none beats the regularised logistic baseline. Glicko-2 and Elo, which use results only, are far behind a model with the full feature set.

## Older fights count for less
Weighting recent fights more when fitting. The half-life used (4 years) was chosen on 2008-2013 only. The other half-lives are shown for sensitivity, not selection.

| Half-life | Log loss | Against the baseline [95% CI] |
| --- | --- | --- |
| half-life 2 years | 0.6511 | +0.0000 [-0.0019, +0.0020] |
| half-life 4 years | 0.6503 | -0.0007 [-0.0020, +0.0006] |
| half-life 8 years | 0.6503 | -0.0008 [-0.0016, -0.0000] |
| half-life 16 years | 0.6505 | -0.0006 [-0.0010, -0.0001] |

With the production feature set as it now stands (reach left out), recency weighting at the chosen half-life changes log loss by -0.0007 [-0.0020, +0.0006]; 2 of 4 half-lives have an interval entirely below zero. Earlier, with reach still in the model, the same weighting looked stronger (about -0.0020); once the unverifiable input is gone most of that disappears. It does not clear the gate (reject), so the recency-weighted model runs only as a **shadow**: it forecasts alongside production, is saved with each forecast, and is graded prospectively (see the Monitoring panel). The fighter-effects ("hierarchical") model adds nothing by itself.

## Age and reach, one at a time
Age comes from the date of birth, which is fixed. Reach, stance and height come from a single current profile snapshot with no effective date, so their value at an earlier fight is unverified.

| Features | Log loss | Against no age and no reach [95% CI] |
| --- | --- | --- |
| no age, no reach | 0.6607 | reference |
| age only | 0.6511 | -0.0097 [-0.0126, -0.0071] |
| reach only | 0.6614 | +0.0007 [-0.0019, +0.0030] |
| age and reach | 0.6521 | -0.0087 [-0.0123, -0.0054] |
| age and reach + interaction | 0.6522 | -0.0086 [-0.0122, -0.0054] |
| age and reach + stance | 0.6520 | -0.0087 [-0.0126, -0.0054] |

Age alone recovers essentially the whole gain (-0.0097); reach alone does nothing demonstrable (+0.0007), and neither an age-by-reach interaction nor stance adds anything. The earlier combined ablation was therefore carried by age. Because reach was both unhelpful and of unverified historical accuracy, **it was removed from the production model** (model version 0.3); this table puts it back only to run the comparison. (Baseline without either: 0.6607.)

## Ensembles
Members fixed before any result was read: lr_prod, histgb, lightgbm, xgboost, catboost, glicko2, hier. Weights are learned only from earlier years' out-of-fold forecasts. Compared on the later fights where a stack can be trained: 2016-2026, 5330 fights.

| Model | Log loss | Accuracy | Cal. slope | Against the baseline [95% CI] | Decision |
| --- | --- | --- | --- | --- | --- |
| Production-form ridge logistic regression (baseline) | 0.6487 | 0.618 | 0.99 | reference |  |
| HistGradientBoosting | 0.6735 | 0.603 | 2.67 | +0.0248 [+0.0190, +0.0311] | reject |
| LightGBM | 0.6732 | 0.603 | 2.59 | +0.0245 [+0.0187, +0.0307] | reject |
| XGBoost | 0.6683 | 0.615 | 2.43 | +0.0196 [+0.0142, +0.0254] | reject |
| CatBoost | 0.6635 | 0.609 | 1.74 | +0.0148 [+0.0098, +0.0200] | reject |
| Glicko-2 ratings | 0.6807 | 0.560 | 0.86 | +0.0320 [+0.0250, +0.0391] | reject |
| Hierarchical: production features plus fighter effects | 0.6486 | 0.617 | 0.99 | -0.0001 [-0.0004, +0.0002] | shadow |
| Average of the members | 0.6583 | 0.621 | 1.86 | +0.0095 [+0.0055, +0.0138] | reject |
| Logistic stack of the members | 0.6486 | 0.618 | 1.15 | -0.0001 [-0.0020, +0.0017] | shadow |
| Constrained weighted average | 0.6489 | 0.616 | 1.21 | +0.0002 [-0.0014, +0.0019] | reject |
| Stack fitted separately for newcomers and veterans | 0.6489 | 0.618 | 1.16 | +0.0002 [-0.0018, +0.0022] | reject |

Final stack weights (log-odds scale): lr_prod 0.344, histgb 0.038, lightgbm 0.094, xgboost 0.119, catboost 0.256, glicko2 0.071, hier 0.404. Recalibrating the stack with Platt scaling fitted on earlier stack outputs changed log loss by -0.0005 [-0.0014, +0.0005] on 4401 fights. **No ensemble beat the logistic baseline**, so none is deployed: the members' errors are too similar, and the weaker members add noise.

## Neural sequence models
Each model is a linear part on the engineered features (the production form) plus a learned summary of each fighter's last 8 fights (last 8 fights per fighter, strictly before the bout), so any gain is what the sequence adds beyond the features. 6288 fights, 3 seeds averaged, up to 80, early stopping on the last training year.

| Model | Log loss | Accuracy | Against the baseline [95% CI] | Decision |
| --- | --- | --- | --- | --- |
| Neural framework, linear part only (a check) | 0.6525 | 0.616 | +0.0015 [-0.0001, +0.0033] | reject |
| Engineered features through a small neural network | 0.6520 | 0.616 | +0.0010 [-0.0008, +0.0029] | reject |
| GRU over each fighter's last 8 fights | 0.6539 | 0.618 | +0.0028 [-0.0001, +0.0059] | reject |
| Self-attention over each fighter's last 8 fights | 0.6523 | 0.617 | +0.0013 [-0.0012, +0.0042] | reject |

The framework check (linear part only) reproduces the baseline, so the training procedure is sound. Neither a GRU nor attention over fight history improves on it: fight sequences carry no demonstrable information beyond the engineered summary features in this data.

## Round-of-ending forecasts
Round forecasts are shown only if the model beats the base rate with an interval below zero and passes the promotion gate; otherwise they stay unavailable.
Status: **unavailable**.

| Schedule | Fights | Classes | Log loss (model / base rate) | Difference [95% CI] | Ranked probability score difference | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| 3-round | 5704 | round 1, round 2, round 3, distance | 1.1838 / 1.1943 | -0.0105 [-0.0226, +0.0046] | -0.0097 [-0.0123, -0.0069] | shadow |
| 5-round | 617 | round 1, round 2, round 3, round 4, round 5, distance | 1.6390 / 1.5589 | +0.0801 [+0.0248, +0.1325] | -0.0093 [-0.0196, +0.0001] | reject |

Three-round fights show a small improvement over the base rate whose interval includes zero; five-round fights (few, and each round a separate class) are worse than the base rate. Round forecasts are therefore **not shown** on the site. The already-validated goes-the-distance probability remains the only duration output.

## Where the baseline does better and worse
Log loss by group, on all test fights (groups of at least 150).

| Group | n | Production-form ridge logistic regression (baseline) | LightGBM | CatBoost | Hierarchical: production features plus fighter effects | Glicko-2 ratings |
| --- | --- | --- | --- | --- | --- | --- |
| Newcomers (a fighter with under 3 UFC fights) | 3157 | 0.6589 | 0.6745 | 0.6668 | 0.6588 | 0.6801 |
| Both fighters with 3+ UFC fights | 3131 | 0.6431 | 0.6728 | 0.6618 | 0.6429 | 0.6805 |
| Five-round bouts | 614 | 0.6416 | 0.6721 | 0.6604 | 0.6424 | 0.6723 |
| Either fighter off for a year or more | 1164 | 0.6536 | 0.6736 | 0.6652 | 0.6533 | 0.6810 |
| Division: Bantamweight | 647 | 0.6285 | 0.6708 | 0.6597 | 0.6283 | 0.6732 |
| Division: Featherweight | 705 | 0.6632 | 0.6762 | 0.6682 | 0.6626 | 0.6813 |
| Division: Flyweight | 365 | 0.6364 | 0.6705 | 0.6597 | 0.6361 | 0.6704 |
| Division: Heavyweight | 444 | 0.6325 | 0.6629 | 0.6450 | 0.6326 | 0.6755 |
| Division: Light Heavyweight | 430 | 0.6900 | 0.6827 | 0.6789 | 0.6898 | 0.6887 |
| Division: Lightweight | 927 | 0.6428 | 0.6722 | 0.6617 | 0.6424 | 0.6738 |
| Division: Middleweight | 701 | 0.6619 | 0.6740 | 0.6657 | 0.6615 | 0.6946 |
| Division: Welterweight | 862 | 0.6634 | 0.6728 | 0.6652 | 0.6640 | 0.6868 |
| Division: Women's Bantamweight | 218 | 0.6899 | 0.6830 | 0.6827 | 0.6903 | 0.6919 |
| Division: Women's Flyweight | 267 | 0.6623 | 0.6745 | 0.6667 | 0.6618 | 0.6877 |
| Division: Women's Strawweight | 357 | 0.6313 | 0.6865 | 0.6812 | 0.6309 | 0.6872 |

## Data audit: what was knowable at the time of each fight
| Field | Source | Effective date | Safe for historical forecasts? |
| --- | --- | --- | --- |
| Fight results, method, round, weight class | ufcstats.com via a GPL-3.0 scrape | Event date | Yes: only fights dated before a forecast are used |
| Per-fight strikes, takedowns, control | The same, summed over rounds | Event date (post-fight totals) | Yes: enters later forecasts only, after the fight, through rolling averages |
| Date of birth, so age at the bout | Fighter profile page | Fixed for life | Yes |
| Reach, height, stance | Fighter profile page, one current snapshot | Unknown: no effective date, no history | Unverified: today's value is used for all past fights; reach adds nothing demonstrable, so it is a removal candidate |
| Weight class of each bout | Results file, per bout | Event date | Yes |
| Elo, rolling statistics, opponent quality, activity | Computed here from earlier fights | Computed per forecast | Yes: checked by tests that remove or change later results and compare features |
| Betting prices (2010-2020) | OpenML 43464, CC BY 4.0 | Not stated: opening, closing or best price is unknown | Only used to compare, never to train the independent model |

| Years | Fights | Both fighters' birth dates known | Both fighters' reach known | Per-fight statistics available |
| --- | --- | --- | --- | --- |
| 1993-2004 | 430 | 63.3% | 14.2% | 95.1% |
| 2005-2009 | 820 | 95.9% | 69.5% | 100.0% |
| 2010-2014 | 1748 | 99.1% | 84.0% | 100.0% |
| 2015-2019 | 2368 | 99.7% | 93.7% | 100.0% |
| 2020-2026 | 3426 | 97.4% | 95.5% | 100.0% |
Share of decisive fights in each era where both fighters have the field. A profile existing today does not mean the value was known then.

## Not done
- **Bayesian hierarchical model with a full posterior** (for example in PyMC or Stan): the partial-pooling model here is a maximum-a-posteriori fit with a Gaussian prior on fighter effects, which gives pooled estimates but not posterior intervals.
- **Dynamic ensemble weights** beyond the newcomer/veteran split, and Bayesian model averaging: not tested because no ensemble beat the baseline.
- **Prediction-interval coverage** for the tree and neural models: the production range comes from refitting the logistic model on resampled events; no comparable interval was built for the others.
