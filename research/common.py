"""Shared pieces for the research scripts: data loading, metrics, the paired event bootstrap and probability helpers."""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
EPS = 1e-6


def load() -> tuple[pd.DataFrame, dict]:
    df = pd.read_csv(ROOT / "data/experiments/features.csv", keep_default_na=False, na_values=[""])
    report = json.loads((ROOT / "data/reports/backtest-latest.json").read_text())
    df["event_key"] = df["year"].astype(str) + "|" + df["event"]
    df = df.sort_values(["date", "id"]).reset_index(drop=True)
    return df, report


def clip(p):
    return np.clip(p, EPS, 1 - EPS)


def logit(p):
    p = clip(p)
    return np.log(p / (1 - p))


def sigmoid(z):
    return 1 / (1 + np.exp(-z))


def ll_each(p, y):
    p = clip(np.asarray(p, dtype=float))
    y = np.asarray(y, dtype=float)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def calibration_fit(p, y):
    """Slope and intercept of a logistic recalibration of outcomes on forecast log-odds (Newton's method)."""
    z = logit(np.asarray(p, dtype=float))
    y = np.asarray(y, dtype=float)
    if len(z) < 30 or np.ptp(z) < 1e-9 or y.min() == y.max():
        return None
    a, b = 0.0, 1.0
    for _ in range(25):
        q = sigmoid(a + b * z)
        r = q - y
        w = q * (1 - q)
        ga, gb = r.sum(), (r * z).sum()
        haa, hab, hbb = w.sum() + 1e-6, (w * z).sum(), (w * z * z).sum() + 1e-6
        det = haa * hbb - hab * hab
        if abs(det) < 1e-12:
            return None
        da, db = (hbb * ga - hab * gb) / det, (haa * gb - hab * ga) / det
        a, b = a - da, b - db
        if max(abs(da), abs(db)) < 1e-9:
            break
    return {"slope": float(b), "intercept": float(a)}


def auc(p, y):
    from sklearn.metrics import roc_auc_score

    y = np.asarray(y)
    return float(roc_auc_score(y, p)) if y.min() != y.max() else float("nan")


def summarize(p, y) -> dict:
    p = np.asarray(p, dtype=float)
    y = np.asarray(y, dtype=float)
    pick = np.where(p > 0.5, 1, np.where(p < 0.5, 0, 0.5))
    acc = float(np.mean(np.where(pick == 0.5, 0.5, (pick == y).astype(float))))
    return {
        "n": int(len(y)),
        "logLoss": float(ll_each(p, y).mean()),
        "brier": float(np.mean((p - y) ** 2)),
        "accuracy": acc,
        "auc": auc(p, y),
        "calibration": calibration_fit(p, y),
    }


def paired_bootstrap(diff: np.ndarray, events: np.ndarray, iters: int = 1000, seed: int = 20261026, level: float = 0.95) -> tuple[float, float, float]:
    """Mean per-fight loss difference with a 95% interval from resampling whole events."""
    ev, inv = np.unique(events, return_inverse=True)
    sums = np.bincount(inv, weights=diff, minlength=len(ev))
    cnt = np.bincount(inv, minlength=len(ev)).astype(float)
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(ev), size=(iters, len(ev)))
    est = sums[idx].sum(axis=1) / cnt[idx].sum(axis=1)
    tail = (1 - level) / 2 * 100
    return float(diff.mean()), float(np.percentile(est, tail)), float(np.percentile(est, 100 - tail))


def fold_diffs(diff: np.ndarray, years: np.ndarray) -> list[float]:
    return [float(diff[years == y].mean()) for y in sorted(set(years.tolist()))]
