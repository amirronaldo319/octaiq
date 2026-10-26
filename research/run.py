"""Win-probability research: model families, ratings, a hierarchical model, ensembles and ablations, on identical chronological folds.

Run:  npm run research:export && research/.venv/bin/python research/run.py
Writes data/experiments/results.json (committed) and data/experiments/oof.csv (not committed).
Protocol: hyperparameters are chosen on 2008-2013 using only earlier data; each test year is then predicted by models fitted on earlier years
only, with those hyperparameters fixed. Ensemble weights are learned only from earlier years' out-of-fold forecasts.
"""
from __future__ import annotations

import json
import platform
import sys
import time
from datetime import datetime, timezone

import numpy as np
import optuna
import pandas as pd
import sklearn
from scipy.optimize import minimize
from sklearn.linear_model import LogisticRegression

import gate
from common import ROOT, fold_diffs, ll_each, load, logit, paired_bootstrap, sigmoid, summarize
from models import MAKERS, SPACES, EarlyStopped, FighterEffects, Logistic, Mirrored, glicko2_predictions

optuna.logging.set_verbosity(optuna.logging.WARNING)
T0 = time.time()


def log(msg: str) -> None:
    print(f"[{time.time() - T0:6.1f}s] {msg}", flush=True)


df, report = load()
excluded = set(report["reproducibility"]["options"]["excludedFeatures"])
xcols = [c for c in df.columns if c.startswith("x_")]
names = {c: c[2:] for c in xcols}
prod_cols = [c for c in xcols if names[c] not in excluded]
tree_cols = [c for c in xcols if names[c] not in {"ageMissing", "reachMissing"}]
first_test = report["report"]["options"]["firstTestYear"]
dec = df[df["y"].notna()].reset_index(drop=True)
dec["y"] = dec["y"].astype(float)
years = sorted(dec.loc[dec["year"] >= first_test, "year"].unique().tolist())
log(f"{len(dec)} decisive fights; test years {years[0]}-{years[-1]}; {len(prod_cols)} production features, {len(tree_cols)} for trees")

DEV_END, DEV_START = pd.Timestamp("2008-01-01"), pd.Timestamp("2014-01-01")
dec["dt"] = pd.to_datetime(dec["date"])


def split(year):
    cut = pd.Timestamp(f"{year}-01-01")
    return dec["dt"] < cut, dec["year"] == year


def X(rows, cols):
    return rows[cols].to_numpy(dtype=float)


# ------------------------------------------------------------------ tuning on 2008-2013 using only earlier data
tuning: dict = {}
dev_tr = dec["dt"] < DEV_END
dev_va = (dec["dt"] >= DEV_END) & (dec["dt"] < DEV_START)
Xtr_t, ytr = X(dec[dev_tr], tree_cols), dec.loc[dev_tr, "y"].to_numpy()
Xva_t, yva = X(dec[dev_va], tree_cols), dec.loc[dev_va, "y"].to_numpy()
TRIALS = 24
best_params: dict = {}
for fam in ["histgb", "lightgbm", "xgboost", "catboost"]:
    def objective(trial, fam=fam):
        p = SPACES[fam](trial)
        m = Mirrored(MAKERS[fam](p)).fit(Xtr_t, ytr)
        return float(ll_each(m.predict(Xva_t), yva).mean())

    study = optuna.create_study(direction="minimize", sampler=optuna.samplers.TPESampler(seed=20261026))
    study.optimize(objective, n_trials=TRIALS)
    best_params[fam] = SPACES[fam](optuna.trial.FixedTrial(study.best_params))
    tuning[fam] = {"trials": TRIALS, "devLogLoss": study.best_value, "params": study.best_params}
    log(f"tuned {fam}: dev log loss {study.best_value:.4f}")

# Logistic ridge on all features, and the hierarchical model's prior width and recency half-life.
Xtr_all, Xva_all = X(dec[dev_tr], prod_cols), X(dec[dev_va], prod_cols)
base_dev = float(ll_each(Logistic(5.0).fit(Xtr_all, ytr).predict(Xva_all), yva).mean())
best_lr_all = min(((float(ll_each(Logistic(r).fit(X(dec[dev_tr], tree_cols), ytr).predict(X(dec[dev_va], tree_cols)), yva).mean()), r) for r in [1, 3, 5, 10, 20, 40]))
tuning["lr_all"] = {"devLogLoss": best_lr_all[0], "ridge": best_lr_all[1]}
best_h = None
for scale in [0.1, 0.2, 0.4, 0.8]:
    for half in [None, 4.0, 8.0]:
        tr = dec[dev_tr]
        age = (DEV_END - tr["dt"]).dt.days.to_numpy() / 365.25
        h = FighterEffects(5.0, scale, half).fit(X(tr, prod_cols), tr["y"].to_numpy(), tr["a"].to_numpy(), tr["b"].to_numpy(), age)
        va = dec[dev_va]
        v = float(ll_each(h.predict(X(va, prod_cols), va["a"].to_numpy(), va["b"].to_numpy()), yva).mean())
        if best_h is None or v < best_h[0]:
            best_h = (v, scale, half)
tuning["hier"] = {"devLogLoss": best_h[0], "effectScale": best_h[1], "halfLifeYears": best_h[2]}
tuning["lr_prod"] = {"devLogLoss": base_dev, "ridge": 5.0}

# Recency weighting of the training fights (older fights count for less), half-life chosen on the same earlier data.
tr_dev = dec[dev_tr]
age_dev = (DEV_END - tr_dev["dt"]).dt.days.to_numpy() / 365.25
best_hl = None
for half in [None, 2.0, 4.0, 8.0]:
    w = None if half is None else 0.5 ** (age_dev / half)
    v = float(ll_each(Logistic(5.0).fit(Xtr_all, ytr, w).predict(Xva_all), yva).mean())
    if best_hl is None or v < best_hl[0]:
        best_hl = (v, half)
tuning["recency"] = {"devLogLoss": best_hl[0], "halfLifeYears": best_hl[1]}
log(f"recency half-life chosen on dev: {best_hl[1]} years (dev log loss {best_hl[0]:.4f} against {base_dev:.4f} unweighted)")

# Glicko-2: initial deviation and volatility constraint tuned on the same development window.
best_g = None
for tau in [0.2, 0.5]:
    for rd in [150.0, 250.0, 350.0]:
        gp = dict(zip(df["id"], glicko2_predictions(df.loc[df["date"] < "2014-01-01", "date"].to_numpy(), df.loc[df["date"] < "2014-01-01", "a"].to_numpy(), df.loc[df["date"] < "2014-01-01", "b"].to_numpy(), df.loc[df["date"] < "2014-01-01", "y"].to_numpy(dtype=float), tau, rd)))
        pv = dec.loc[dev_va, "id"].map(gp).to_numpy()
        v = float(ll_each(pv, yva).mean())
        if best_g is None or v < best_g[0]:
            best_g = (v, tau, rd)
tuning["glicko2"] = {"devLogLoss": best_g[0], "tau": best_g[1], "initialRd": best_g[2]}
log(f"glicko-2 tuned {best_g}")
log(f"tuned hierarchical {best_h}; production-form logistic dev {base_dev:.4f}")

# ------------------------------------------------------------------ walk-forward predictions
glicko_all = glicko2_predictions(df["date"].to_numpy(), df["a"].to_numpy(), df["b"].to_numpy(), df["y"].to_numpy(dtype=float), tuning["glicko2"]["tau"], tuning["glicko2"]["initialRd"])
glicko_by_id = dict(zip(df["id"], glicko_all))
dec["glicko2"] = dec["id"].map(glicko_by_id)

ABLATION_SETS = {
    "no age, no reach": [c for c in prod_cols if names[c] not in {"age", "reach"}],
    "age only": [c for c in prod_cols if names[c] != "reach"],
    "reach only": [c for c in prod_cols if names[c] != "age"],
    "age and reach": prod_cols,
}
oof: dict[str, list] = {k: [] for k in ["lr_prod", "lr_all", "histgb", "lightgbm", "xgboost", "catboost", "lightgbm_es", "xgboost_es", "catboost_es", "glicko2", "hier", "hier_decay", "lr_decay", "lr_decay_noreach"]}
oof_sens: dict[str, list] = {f"half-life {h} years": [] for h in [2, 4, 8, 16]}
noreach_cols = [c for c in prod_cols if names[c] != "reach"]
oof_abl: dict[str, list] = {k: [] for k in [*ABLATION_SETS, "age and reach + interaction", "age and reach + stance"]}
rows_eval: list[pd.DataFrame] = []

for yr in years:
    trm, tem = split(yr)
    tr, te = dec[trm], dec[tem]
    ytr_, cut = tr["y"].to_numpy(), pd.Timestamp(f"{yr}-01-01")
    rows_eval.append(te)
    oof["lr_prod"].append(Logistic(5.0).fit(X(tr, prod_cols), ytr_).predict(X(te, prod_cols)))
    oof["lr_all"].append(Logistic(tuning["lr_all"]["ridge"]).fit(X(tr, tree_cols), ytr_).predict(X(te, tree_cols)))
    for fam in ["histgb", "lightgbm", "xgboost", "catboost"]:
        oof[fam].append(Mirrored(MAKERS[fam](best_params[fam])).fit(X(tr, tree_cols), ytr_).predict(X(te, tree_cols)))
    oof["glicko2"].append(te["glicko2"].to_numpy())
    fit_mask = (tr["year"] < yr - 1).to_numpy()
    for fam in ["lightgbm", "xgboost", "catboost"]:
        oof[f"{fam}_es"].append(EarlyStopped(fam, best_params[fam]).fit(X(tr, tree_cols), ytr_, fit_mask).predict(X(te, tree_cols)))
    w_dec = None if tuning["recency"]["halfLifeYears"] is None else 0.5 ** (((cut - tr["dt"]).dt.days.to_numpy() / 365.25) / tuning["recency"]["halfLifeYears"])
    oof["lr_decay"].append(Logistic(5.0).fit(X(tr, prod_cols), ytr_, w_dec).predict(X(te, prod_cols)))
    oof["lr_decay_noreach"].append(Logistic(5.0).fit(X(tr, noreach_cols), ytr_, w_dec).predict(X(te, noreach_cols)))
    for h in [2, 4, 8, 16]:
        oof_sens[f"half-life {h} years"].append(Logistic(5.0).fit(X(tr, prod_cols), ytr_, 0.5 ** (((cut - tr["dt"]).dt.days.to_numpy() / 365.25) / h)).predict(X(te, prod_cols)))
    age = (cut - tr["dt"]).dt.days.to_numpy() / 365.25
    oof["hier"].append(FighterEffects(5.0, tuning["hier"]["effectScale"], None).fit(X(tr, prod_cols), ytr_, tr["a"].to_numpy(), tr["b"].to_numpy()).predict(X(te, prod_cols), te["a"].to_numpy(), te["b"].to_numpy()))
    oof["hier_decay"].append(FighterEffects(5.0, tuning["hier"]["effectScale"], tuning["hier"]["halfLifeYears"] or 6.0).fit(X(tr, prod_cols), ytr_, tr["a"].to_numpy(), tr["b"].to_numpy(), age).predict(X(te, prod_cols), te["a"].to_numpy(), te["b"].to_numpy()))
    for label, cols in ABLATION_SETS.items():
        oof_abl[label].append(Logistic(5.0).fit(X(tr, cols), ytr_).predict(X(te, cols)))
    inter = lambda d: (d["x_age"] * d["x_reach"]).to_numpy()[:, None]
    oof_abl["age and reach + interaction"].append(Logistic(5.0).fit(np.hstack([X(tr, prod_cols), inter(tr)]), ytr_).predict(np.hstack([X(te, prod_cols), inter(te)])))
    oof_abl["age and reach + stance"].append(Logistic(5.0).fit(X(tr, prod_cols + ["x_southpaw"]), ytr_).predict(X(te, prod_cols + ["x_southpaw"])))
    log(f"fitted fold {yr} ({len(tr)} train, {len(te)} test)")

E = pd.concat(rows_eval).reset_index(drop=True)
P = {k: np.concatenate(v) for k, v in oof.items()}
PA = {k: np.concatenate(v) for k, v in oof_abl.items()}
PS = {k: np.concatenate(v) for k, v in oof_sens.items()}
CHALLENGERS = len(P) - 1
y_all = E["y"].to_numpy()
ev_all = E["event_key"].to_numpy()
yrs_all = E["year"].to_numpy()

# Reproduction check against the TypeScript production model on the same fights.
ts_ll = [m for m in report["report"]["models"] if m["id"] == report["report"]["primary"]][0]["metrics"]["logLoss"]
py_ll = float(ll_each(P["lr_prod"], y_all).mean())
log(f"production-form logistic: python {py_ll:.4f} vs TypeScript {ts_ll:.4f}")


def compare(pred, base, label_events=ev_all, label_years=yrs_all, y=y_all):
    d = ll_each(pred, y) - ll_each(base, y)
    est, lo, hi = paired_bootstrap(d, label_events)
    s = summarize(pred, y)
    # Several challengers are tested at once, so the interval is also widened to the level that holds across all of them.
    _, lo_a, hi_a = paired_bootstrap(d, label_events, level=1 - 0.05 / max(1, CHALLENGERS))
    dec_ = gate.decide(est, lo, hi, fold_diffs(d, label_years), (s["calibration"] or {}).get("slope"))
    dec_["adjustedInterval"] = {"level": 1 - 0.05 / max(1, CHALLENGERS), "lo": lo_a, "hi": hi_a, "challengers": CHALLENGERS}
    if dec_["mode"] == "promote" and not hi_a < 0:
        dec_["mode"] = "shadow"
        dec_["reasons"].append("does not survive the multiple-comparison adjustment")
    return {"summary": s, "vsBaseline": {"estimate": est, "lo": lo, "hi": hi}, "decision": dec_}


results_models: dict = {}
for k, p in P.items():
    results_models[k] = compare(p, P["lr_prod"]) if k != "lr_prod" else {"summary": summarize(p, y_all), "vsBaseline": None, "decision": None}
results_models["elo_only"] = compare(sigmoid(E["x_elo"].to_numpy() * 1.0 * 1.0 * 0 + (E["x_elo"].to_numpy() * 400) * np.log(10) / 400), P["lr_prod"])
results_models["coin_flip"] = {"summary": summarize(np.full(len(y_all), 0.5), y_all), "vsBaseline": None, "decision": None}
results_models["favourite_by_rating"] = {"summary": summarize(np.where(E["x_elo"].to_numpy() >= 0, 0.99, 0.01), y_all), "vsBaseline": None, "decision": None,
                                          "note": "Always pick the higher-rated fighter; probabilities are extreme, so log loss is not meaningful, only accuracy."}
log("evaluated model families")

# ------------------------------------------------------------------ age, reach, interaction and stance, one at a time
base_abl = PA["no age, no reach"]
abl_out: dict = {}
for k, p in PA.items():
    est, lo, hi = paired_bootstrap(ll_each(p, y_all) - ll_each(base_abl, y_all), ev_all)
    abl_out[k] = {"summary": summarize(p, y_all), "vsNoAgeNoReach": None if k == "no age, no reach" else {"estimate": est, "lo": lo, "hi": hi}}
inc_age = abl_out["age only"]["vsNoAgeNoReach"]["estimate"]
inc_reach = abl_out["reach only"]["vsNoAgeNoReach"]["estimate"]
abl_out["_sum_of_separate_effects"] = inc_age + inc_reach
abl_out["_both_together"] = abl_out["age and reach"]["vsNoAgeNoReach"]["estimate"]
log(f"age {inc_age:+.4f}, reach {inc_reach:+.4f}, both {abl_out['_both_together']:+.4f}")

# ------------------------------------------------------------------ ensembles on identical later fights
members = ["lr_prod", "histgb", "lightgbm", "xgboost", "catboost", "glicko2", "hier"]  # fixed before any results were read
MIN_STACK_ROWS = 800
STACK_RIDGE = 20.0
first_stack = None
for yr in years:
    if int((yrs_all < yr).sum()) >= MIN_STACK_ROWS:
        first_stack = yr
        break
stack_years = [y for y in years if y >= first_stack]
Z = np.column_stack([logit(P[m]) for m in members])
ens: dict[str, np.ndarray] = {k: np.full(len(y_all), np.nan) for k in ["average", "stack", "weighted", "stack_by_experience"]}
weights_last: dict = {}
min_prior = np.minimum(E["prior_a"].to_numpy(), E["prior_b"].to_numpy())
for yr in stack_years:
    te = yrs_all == yr
    tr = yrs_all < yr
    ens["average"][te] = sigmoid(Z[te].mean(axis=1))
    st = LogisticRegression(C=1.0 / STACK_RIDGE, fit_intercept=False, max_iter=1000).fit(Z[tr], y_all[tr])
    ens["stack"][te] = st.predict_proba(Z[te])[:, 1]
    weights_last["stack"] = dict(zip(members, st.coef_[0].round(3).tolist()))

    def neg_ll(w, Zt=Z[tr], yt=y_all[tr]):
        return float(ll_each(sigmoid(Zt @ w), yt).mean())

    k = len(members)
    res = minimize(neg_ll, np.full(k, 1 / k), method="SLSQP", bounds=[(0, 1)] * k, constraints=[{"type": "eq", "fun": lambda w: w.sum() - 1}])
    ens["weighted"][te] = sigmoid(Z[te] @ res.x)
    weights_last["weighted"] = dict(zip(members, res.x.round(3).tolist()))
    for bucket in (min_prior < 3, min_prior >= 3):
        trb, teb = tr & bucket, te & bucket
        if teb.any():
            if trb.sum() >= 300:
                stb = LogisticRegression(C=1.0 / STACK_RIDGE, fit_intercept=False, max_iter=1000).fit(Z[trb], y_all[trb])
                ens["stack_by_experience"][teb] = stb.predict_proba(Z[teb])[:, 1]
            else:
                ens["stack_by_experience"][teb] = ens["stack"][teb]
inE = ~np.isnan(ens["stack"])
yE, evE, yrE = y_all[inE], ev_all[inE], yrs_all[inE]
ens_out: dict = {"period": f"{stack_years[0]}-{stack_years[-1]}", "n": int(inE.sum()), "members": members, "stackRidge": STACK_RIDGE, "finalWeights": weights_last, "models": {}}
for k in members:
    ens_out["models"][k] = compare(P[k][inE], P["lr_prod"][inE], evE, yrE, yE) if k != "lr_prod" else {"summary": summarize(P[k][inE], yE), "vsBaseline": None, "decision": None}
for k, p in ens.items():
    ens_out["models"][k] = compare(p[inE], P["lr_prod"][inE], evE, yrE, yE)

# Platt recalibration of the stack, fitted on earlier stack outputs only.
cal = np.full(len(y_all), np.nan)
for yr in stack_years[2:]:
    te, tr = yrs_all == yr, (yrs_all < yr) & inE
    pl = LogisticRegression(C=1e6, fit_intercept=True, max_iter=500).fit(logit(np.concatenate([ens["stack"][tr], 1 - ens["stack"][tr]])).reshape(-1, 1), np.concatenate([y_all[tr], 1 - y_all[tr]]))
    cal[te] = pl.predict_proba(logit(ens["stack"][te]).reshape(-1, 1))[:, 1]
inC = ~np.isnan(cal)
ens_out["stackPlatt"] = {"n": int(inC.sum()), **{"vsStack": (lambda d: dict(zip(["estimate", "lo", "hi"], paired_bootstrap(d, ev_all[inC])))) (ll_each(cal[inC], y_all[inC]) - ll_each(ens["stack"][inC], y_all[inC]))}}
log(f"ensembles on {ens_out['period']} ({ens_out['n']} fights)")

# ------------------------------------------------------------------ where each model does better and worse
groups = {
    "Newcomers (a fighter with under 3 UFC fights)": min_prior < 3,
    "Both fighters with 3+ UFC fights": min_prior >= 3,
    "Five-round bouts": E["rounds"].to_numpy() == 5,
    "Either fighter off for a year or more": np.nan_to_num(np.maximum(E["layoff_a"].fillna(0), E["layoff_b"].fillna(0)).to_numpy()) >= 365,
}
for wc in sorted(E["weight_class"].str.replace(r" Bout$", "", regex=True).unique()):
    groups[f"Division: {wc}"] = (E["weight_class"].str.replace(r" Bout$", "", regex=True) == wc).to_numpy()
group_out = {}
show = ["lr_prod", "lightgbm", "catboost", "hier", "glicko2"]
for g, mask in groups.items():
    if mask.sum() >= 150:
        group_out[g] = {"n": int(mask.sum()), **{k: float(ll_each(P[k][mask], y_all[mask]).mean()) for k in show}}

# Coverage of each input by era, for the data audit.
audit = []
for lo_y, hi_y in [(1993, 2004), (2005, 2009), (2010, 2014), (2015, 2019), (2020, 2026)]:
    blk = dec[(dec["year"] >= lo_y) & (dec["year"] <= hi_y)]
    if len(blk):
        audit.append({"years": f"{lo_y}-{hi_y}", "fights": int(len(blk)), "bothDob": float(((blk["dob_a"] == 1) & (blk["dob_b"] == 1)).mean()), "bothReach": float(((blk["reach_a"] == 1) & (blk["reach_b"] == 1)).mean()), "withFightStats": float(1 - blk["meta_missing"].mean())})

out = {
    "dataAudit": audit,
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "dataVersion": report["reproducibility"]["dataVersion"],
    "featurePipeline": report["reproducibility"]["featurePipeline"],
    "codeCommit": report["reproducibility"].get("codeCommit"),
    "protocol": {
        "tuning": "Hyperparameters chosen on 2008-2013 using only earlier fights (24 Bayesian TPE trials per family); fixed afterwards.",
        "walkForward": f"Each year {years[0]}-{years[-1]} predicted by models fitted on earlier years only; events kept whole.",
        "baseline": "Production-form ridge logistic regression (no intercept) on the production feature set.",
        "bootstrap": "1000 resamples of whole events; paired differences on identical fights.",
        "ensembleMembers": members,
        "noUntouchedHoldout": True,
    },
    "versions": {"python": platform.python_version(), "numpy": np.__version__, "pandas": pd.__version__, "sklearn": sklearn.__version__},
    "replication": {"pythonLogLoss": py_ll, "typescriptLogLoss": ts_ll, "difference": py_ll - ts_ll},
    "tuning": tuning,
    "n": int(len(y_all)),
    "period": f"{years[0]}-{years[-1]}",
    "models": results_models,
    "ageReach": abl_out,
    "recencySensitivity": {k: {"summary": summarize(p, y_all), "vsBaseline": dict(zip(["estimate", "lo", "hi"], paired_bootstrap(ll_each(p, y_all) - ll_each(P["lr_prod"], y_all), ev_all)))} for k, p in PS.items()},
    "ensembles": ens_out,
    "groups": group_out,
    "experimentsRun": {"modelFamilies": len(P), "tuningTrials": TRIALS * 4, "ablations": len(PA), "ensembles": len(ens) + 1},
}
(ROOT / "data/experiments").mkdir(parents=True, exist_ok=True)
(ROOT / "data/experiments/results.json").write_text(json.dumps(out, indent=2, default=float) + "\n")
pd.DataFrame({"id": E["id"], "y": y_all, **{k: v for k, v in P.items()}, **{f"ens_{k}": v for k, v in ens.items()}}).to_csv(ROOT / "data/experiments/oof.csv", index=False)
log("wrote data/experiments/results.json")
