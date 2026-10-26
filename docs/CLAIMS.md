# Claims OctaIQ must not make

Each line is something the evidence in this project does not support.

- **"Beats the market" or "has an edge".** On 2,735 matched fights (2014–2020) the model's log loss is worse than the market's, and blending the two does not demonstrably help (`docs/REPORT.md`, section 6). A disagreement between the model and the market is a place to look, not a bet.
- **"The most accurate" or "professional-grade".** No comparison against other published models has been made, and the market is better on the only matched sample.
- **A guaranteed or target accuracy.** About 62% of winners were picked in the walk-forward test; that describes the past and says nothing certain about the next card.
- **"Profit", "ROI", "value bet" from accuracy.** No strategy backtest with timestamped prices exists. Expected value shown anywhere is conditional on the model being right and the price being available.
- **"Locked", "immutable", "tamper-proof".** Saved forecasts live in a public, versioned git history. That is a record anyone can inspect, not a cryptographic seal. Forecasts are replaced by newer versions until the event starts.
- **"Live odds".** Prices are collected every few hours (or minutes if the optional service is deployed), never streamed. After the event starts only the last pre-fight prices are shown.
- **"Live" or in-fight forecasts.** No fight-state data exists to validate one.
- **Closing-line value.** There is no reliable closing-price source; the 2014–2020 data does not say whether its prices are opening, closing or best-available.
- **A confidence percentage.** The site shows a probability, a likely range, and a separate data-quality rating (Good, Fair, Limited). None of these is a validated "confidence score".
- **Causes.** Factor groups show what the model associates with winning. They are not proof that, say, youth causes wins.
- **Injury, camp, weight-cut or news inputs.** None are in the model. News is shown only with a date and a source and is labelled as not checked by OctaIQ.
- **Round-by-round or finishing-time predictions.** Not built or tested.
- **"Better" because there are more models or more simulations.** Boosted trees, an ensemble, a direct method model and four calibration methods were each tested and none replaced the baseline. A simulation count is not evidence of accuracy.
- **An untouched test set.** Test years have informed development. Only the prospective record in `data/ledger/` is clean out-of-sample evidence, and it is small so far.
