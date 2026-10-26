"""Round-of-ending and duration research. Is there enough signal in historical UFC data to forecast which round a fight ends in?

For a 3-round fight the outcome is one of: ends in round 1, round 2, round 3 by finish, or goes the distance. For a 5-round fight, rounds 1-5 or the distance.
Each model is multinomial logistic regression on the symmetric finish-proneness features and the weight class, fitted on earlier years only,
and is compared with the base rate (the share of earlier fights in each class) on the same fights.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

import gate
from common import ROOT, fold_diffs, load, paired_bootstrap

df, report = load()
first_test = report["report"]["options"]["firstTestYear"]
d = df[df["method"].isin(["ko", "sub", "dec"]) & df["result"].isin(["a", "b", "draw"]) & df["end_round"].notna() & df["rounds"].isin([3, 5])].copy()
d["end_round"] = d["end_round"].astype(int)
d["wc"] = d["weight_class"].str.replace(r" Bout$", "", regex=True).str.replace(r"^UFC ", "", regex=True).str.replace(r" Title$", "", regex=True)
dcols = [f"d{i}" for i in range(11)]
wc_dummies = pd.get_dummies(d["wc"]).astype(float)
Xall = pd.concat([d[dcols].reset_index(drop=True), wc_dummies.reset_index(drop=True)], axis=1).to_numpy(float)
d = d.reset_index(drop=True)


def classes(row_rounds: int) -> int:
    return row_rounds + 1  # one per round plus "goes the distance"


def label(r) -> int:
    return int(r["rounds"]) if r["method"] == "dec" else int(min(r["end_round"], r["rounds"])) - 1


d["label"] = d.apply(label, axis=1)
results: dict = {}
for sched in (3, 5):
    sub = d[d["rounds"] == sched]
    idx = sub.index.to_numpy()
    K = sched + 1
    P_model, P_base, Y, EV, YR = [], [], [], [], []
    for yr in sorted(sub.loc[sub["year"] >= first_test, "year"].unique().tolist()):
        tr = sub[sub["year"] < yr]
        te = sub[sub["year"] == yr]
        if len(tr) < 150 or len(te) == 0:
            continue
        Xtr, Xte = Xall[tr.index], Xall[te.index]
        s = np.sqrt((Xtr**2).mean(0))
        s[s < 1e-9] = 1
        m = LogisticRegression(C=1 / 5.0, max_iter=3000).fit(Xtr / s, tr["label"])
        p = np.full((len(te), K), 1e-4)
        p[:, m.classes_] = m.predict_proba(Xte / s)
        base = np.bincount(tr["label"], minlength=K) + 1.0
        P_model.append(p / p.sum(1, keepdims=True))
        P_base.append(np.tile(base / base.sum(), (len(te), 1)))
        Y.append(te["label"].to_numpy())
        EV.append(te["event_key"].to_numpy())
        YR.append(te["year"].to_numpy())
    if not Y:
        continue
    Pm, Pb, y, ev, yr = np.vstack(P_model), np.vstack(P_base), np.concatenate(Y), np.concatenate(EV), np.concatenate(YR)
    ll = lambda p: -np.log(np.clip(p[np.arange(len(y)), y], 1e-6, 1))

    def rps(p):
        cum_p = np.cumsum(p, axis=1)[:, :-1]
        cum_o = np.cumsum(np.eye(K)[y], axis=1)[:, :-1]
        return ((cum_p - cum_o) ** 2).sum(1) / (K - 1)

    diff = ll(Pm) - ll(Pb)
    est, lo, hi = paired_bootstrap(diff, ev)
    rdiff = rps(Pm) - rps(Pb)
    r_est, r_lo, r_hi = paired_bootstrap(rdiff, ev)
    dec_ = gate.decide(est, lo, hi, fold_diffs(diff, yr), None)
    # How well the model's chance of "ends in round 1" matches reality, in bins.
    p1 = Pm[:, 0]
    order = np.argsort(p1)
    bins = [{"n": int(len(b)), "predicted": float(p1[b].mean()), "observed": float((y[b] == 0).mean())} for b in np.array_split(order, 4)]
    results[f"{sched}-round"] = {
        "n": int(len(y)), "classes": ["round " + str(i + 1) for i in range(sched)] + ["distance"],
        "baseRate": (np.bincount(y, minlength=K) / len(y)).round(4).tolist(),
        "logLoss": {"model": float(ll(Pm).mean()), "baseRate": float(ll(Pb).mean()), "difference": {"estimate": est, "lo": lo, "hi": hi}},
        "rankedProbabilityScore": {"model": float(rps(Pm).mean()), "baseRate": float(rps(Pb).mean()), "difference": {"estimate": r_est, "lo": r_lo, "hi": r_hi}},
        "round1Calibration": bins, "decision": dec_,
    }
    print(f"{sched}-round fights: n={len(y)} log loss {ll(Pm).mean():.4f} vs base {ll(Pb).mean():.4f} ({est:+.4f} [{lo:+.4f},{hi:+.4f}]) -> {dec_['mode']}; RPS {r_est:+.4f}")

status = "experimental" if any(v["logLoss"]["difference"]["hi"] < 0 for v in results.values()) else "unavailable"
out = {"generatedAt": datetime.now(timezone.utc).isoformat(), "dataVersion": report["reproducibility"]["dataVersion"], "status": status, "results": results,
       "note": "Round forecasts are shown only if the model beats the base rate with an interval below zero and passes the promotion gate; otherwise they stay unavailable."}
(ROOT / "data/experiments/rounds.json").write_text(json.dumps(out, indent=2, default=float) + "\n")
print("status:", status)
