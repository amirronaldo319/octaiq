"""Neural sequence experiment: does a fighter's fight history carry information beyond the engineered features?

Each model predicts logit(A beats B) = linear(engineered matchup features) + g(h_A - h_B), where h is a learned summary of a fighter's
last 8 fights (a GRU, or self-attention). The linear part is the production model's form, so any gain is what the sequence adds.
Everything is odd in the fighter swap, so swapping the corners gives the complementary probability exactly.

Run:  npm run research:export && research/.venv/bin/python research/neural.py   (after run.py, which writes oof.csv)
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import torch
import torch.nn as nn

import gate
from common import ROOT, fold_diffs, ll_each, load, paired_bootstrap, summarize

torch.set_num_threads(4)
T0 = time.time()
L = 8
SEEDS = [11, 22, 33]
df, report = load()
excluded = set(report["reproducibility"]["options"]["excludedFeatures"])
xcols = [c for c in df.columns if c.startswith("x_")]
prod_cols = [c for c in xcols if c[2:] not in excluded]
dec = df[df["y"].notna()].reset_index(drop=True)
dec["y"] = dec["y"].astype(float)
dec["dt"] = pd.to_datetime(dec["date"])
first_test = report["report"]["options"]["firstTestYear"]
years = sorted(dec.loc[dec["year"] >= first_test, "year"].unique().tolist())

# ---- fight tokens per fighter
long = pd.read_csv(ROOT / "data/experiments/fights_long.csv", keep_default_na=False, na_values=[""])
long["dt"] = pd.to_datetime(long["date"])
long = long.sort_values(["fighter", "dt", "bout_id"]).reset_index(drop=True)
TOK = ["result", "ko", "sub", "dec", "minutes", "has_stats", "sig_landed_pm", "sig_absorbed_pm", "td_per15", "td_att_per15", "sub_per15", "kd", "ctrl_share"]
SCALE = np.array([1, 1, 1, 1, 1 / 15, 1, 1 / 6, 1 / 6, 1 / 4, 1 / 8, 1 / 2, 1, 1])
tok = long[TOK].fillna(0).to_numpy(float) * SCALE
tok = np.hstack([tok, (long["rounds"].fillna(3).to_numpy() == 5)[:, None].astype(float)])
F = tok.shape[1] + 2  # plus days since the previous fight and days before the target bout, both in years
by_fighter = {k: (g["dt"].to_numpy(), g.index.to_numpy()) for k, g in long.groupby("fighter")}


def sequence(key: str, when: np.datetime64):
    out = np.zeros((L, F))
    mask = np.zeros(L)
    if key not in by_fighter:
        return out, mask
    dts, idx = by_fighter[key]
    end = np.searchsorted(dts, when, side="left")  # strictly earlier fights only
    start = max(0, end - L)
    prev = None
    for slot, j in enumerate(range(start, end)):
        pos = L - (end - start) + slot
        out[pos, : tok.shape[1]] = tok[idx[j]]
        out[pos, tok.shape[1]] = 0.0 if prev is None else (dts[j] - prev) / np.timedelta64(1, "D") / 365.25
        out[pos, tok.shape[1] + 1] = (when - dts[j]) / np.timedelta64(1, "D") / 365.25
        mask[pos] = 1
        prev = dts[j]
    return out, mask


n = len(dec)
SA, MA, SB, MB = np.zeros((n, L, F)), np.zeros((n, L)), np.zeros((n, L, F)), np.zeros((n, L))
dts = dec["dt"].to_numpy()
for i in range(n):
    SA[i], MA[i] = sequence(dec.at[i, "a"], dts[i])
    SB[i], MB[i] = sequence(dec.at[i, "b"], dts[i])
print(f"[{time.time() - T0:5.1f}s] built sequences for {n} fights (last {L} fights, {F} inputs each)", flush=True)
Xe = dec[prod_cols].to_numpy(float)


class Net(nn.Module):
    def __init__(self, nx: int, kind: str, hidden: int = 16):
        super().__init__()
        self.kind = kind
        self.lin = nn.Linear(nx, 1, bias=False)
        nn.init.zeros_(self.lin.weight)
        if kind == "gru":
            self.enc = nn.GRU(F, hidden, batch_first=True)
        elif kind == "attn":
            self.proj = nn.Linear(F, hidden)
            self.att = nn.MultiheadAttention(hidden, 2, batch_first=True, dropout=0.1)
        if kind in ("gru", "attn"):
            self.head = nn.Sequential(nn.Linear(hidden, hidden, bias=False), nn.Tanh(), nn.Linear(hidden, 1, bias=False))
        elif kind == "mlp":
            self.head = nn.Sequential(nn.Linear(nx, 16, bias=False), nn.Tanh(), nn.Linear(16, 1, bias=False))
        self.drop = nn.Dropout(0.1)

    def embed(self, s, m):
        if self.kind == "gru":
            out, _ = self.enc(s)
            idx = (m.sum(1).clamp(min=1) - 1).long()  # padding sits at the start, so the last step is the newest fight
            return out[:, -1, :]
        h = torch.relu(self.proj(s))
        pad = (m == 0)
        pad[:, -1] = False  # keep at least one position attendable
        a, _ = self.att(h, h, h, key_padding_mask=pad)
        w = m.unsqueeze(-1)
        return (a * w).sum(1) / w.sum(1).clamp(min=1)

    def forward(self, x, sa, ma, sb, mb):
        z = self.lin(x).squeeze(-1)
        if self.kind == "mlp":
            z = z + (self.head(x) - self.head(-x)).squeeze(-1) / 2
        elif self.kind in ("gru", "attn"):
            d = self.drop(self.embed(sa, ma)) - self.drop(self.embed(sb, mb))
            z = z + (self.head(d) - self.head(-d)).squeeze(-1) / 2
        return z


def fit_predict(kind, tr_idx, va_idx, te_idx, seed):
    torch.manual_seed(seed)
    np.random.seed(seed)
    scale = np.sqrt((Xe[tr_idx] ** 2).mean(0))
    scale[scale < 1e-9] = 1
    T = lambda a: torch.tensor(a, dtype=torch.float32)
    xs = T(Xe / scale)
    sa, ma, sb, mb, yy = T(SA), T(MA), T(SB), T(MB), T(dec["y"].to_numpy())
    net = Net(Xe.shape[1], kind)
    opt = torch.optim.AdamW(net.parameters(), lr=3e-3, weight_decay=2e-2)
    lossf = nn.BCEWithLogitsLoss()
    best, best_state, wait = 9.0, None, 0
    for epoch in range(80):
        net.train()
        perm = np.random.permutation(tr_idx)
        for s in range(0, len(perm), 256):
            b = perm[s : s + 256]
            opt.zero_grad()
            loss = lossf(net(xs[b], sa[b], ma[b], sb[b], mb[b]), yy[b]) + 5.0 / len(tr_idx) * (net.lin.weight**2).sum() / 2 * len(b) / len(b)
            loss.backward()
            opt.step()
        net.eval()
        with torch.no_grad():
            v = float(lossf(net(xs[va_idx], sa[va_idx], ma[va_idx], sb[va_idx], mb[va_idx]), yy[va_idx]))
        if v < best - 1e-5:
            best, wait = v, 0
            best_state = {k: t.clone() for k, t in net.state_dict().items()}
        else:
            wait += 1
            if wait >= 8:
                break
    net.load_state_dict(best_state)
    net.eval()
    with torch.no_grad():
        return torch.sigmoid(net(xs[te_idx], sa[te_idx], ma[te_idx], sb[te_idx], mb[te_idx])).numpy()


KINDS = ["linear_torch", "mlp", "gru", "attn"]
preds = {k: [] for k in KINDS}
ids, ys, evs, yrs = [], [], [], []
for yr in years:
    tr = np.where((dec["year"] < yr).to_numpy())[0]
    te = np.where((dec["year"] == yr).to_numpy())[0]
    fit_idx = tr[(dec["year"].to_numpy()[tr] < yr - 1)]
    val_idx = tr[(dec["year"].to_numpy()[tr] == yr - 1)]
    for kind in KINDS:
        p = np.mean([fit_predict("none" if kind == "linear_torch" else kind, fit_idx, val_idx, te, s) for s in SEEDS], axis=0)
        preds[kind].append(p)
    ids.append(dec.loc[te, "id"].to_numpy())
    ys.append(dec.loc[te, "y"].to_numpy())
    evs.append(dec.loc[te, "event_key"].to_numpy())
    yrs.append(dec.loc[te, "year"].to_numpy())
    print(f"[{time.time() - T0:5.1f}s] fold {yr} done", flush=True)

ids, y, ev, yr_arr = map(np.concatenate, (ids, ys, evs, yrs))
P = {k: np.concatenate(v) for k, v in preds.items()}
base = pd.read_csv(ROOT / "data/experiments/oof.csv").set_index("id").loc[ids, "lr_prod"].to_numpy()
out = {"generatedAt": datetime.now(timezone.utc).isoformat(), "dataVersion": report["reproducibility"]["dataVersion"], "n": int(len(y)),
       "setup": {"history": f"last {L} fights per fighter, strictly before the bout", "seeds": SEEDS, "inputs": F, "epochs": "up to 80, early stopping on the last training year",
                 "form": "linear(engineered features) + odd function of the difference between fighter summaries"}, "models": {}}
K = len(KINDS)
for k, p in P.items():
    d = ll_each(p, y) - ll_each(base, y)
    est, lo, hi = paired_bootstrap(d, ev)
    _, lo_a, hi_a = paired_bootstrap(d, ev, level=1 - 0.05 / K)
    s = summarize(p, y)
    dd = gate.decide(est, lo, hi, fold_diffs(d, yr_arr), (s["calibration"] or {}).get("slope"))
    dd["adjustedInterval"] = {"level": 1 - 0.05 / K, "lo": lo_a, "hi": hi_a, "challengers": K}
    if dd["mode"] == "promote" and not hi_a < 0:
        dd["mode"], dd["reasons"] = "shadow", dd["reasons"] + ["does not survive the multiple-comparison adjustment"]
    out["models"][k] = {"summary": s, "vsBaseline": {"estimate": est, "lo": lo, "hi": hi}, "decision": dd}
    print(f"{k:14s} ll {s['logLoss']:.4f} acc {s['accuracy']:.3f} vs lr_prod {est:+.4f} [{lo:+.4f},{hi:+.4f}] {dd['mode']}")
(ROOT / "data/experiments/neural.json").write_text(json.dumps(out, indent=2, default=float) + "\n")
print(f"[{time.time() - T0:5.1f}s] wrote data/experiments/neural.json")
