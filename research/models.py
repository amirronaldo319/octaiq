"""Model families for the win-probability research. Every model sees the same point-in-time feature rows.

All of them are made symmetric: swapping the two fighters returns the complement. Linear models without an intercept are odd
functions of the matchup features, so they are symmetric by construction; tree models are trained on mirrored rows and their
predictions are averaged over both orientations.
"""
from __future__ import annotations

import math
import warnings

import numpy as np
import scipy.sparse as sp
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression

warnings.filterwarnings("ignore")
SEED = 20261026


def rms_scale(X: np.ndarray) -> np.ndarray:
    s = np.sqrt((X**2).mean(axis=0))
    s[s < 1e-9] = 1.0
    return s


class Logistic:
    """Ridge logistic regression with no intercept on RMS-scaled features: the production model's form."""

    def __init__(self, ridge: float = 5.0):
        self.ridge = ridge

    def fit(self, X, y, w=None):
        self.s = rms_scale(X)
        self.m = LogisticRegression(C=1.0 / self.ridge, fit_intercept=False, max_iter=2000).fit(X / self.s, y, sample_weight=w)
        return self

    def predict(self, X):
        return self.m.predict_proba(X / self.s)[:, 1]


class Mirrored:
    """Wraps a tree model: train on mirrored rows, predict the average of both orientations."""

    def __init__(self, make):
        self.make = make

    def fit(self, X, y, w=None):
        Xa, ya = np.vstack([X, -X]), np.concatenate([y, 1 - y])
        wa = None if w is None else np.concatenate([w, w])
        self.m = self.make()
        try:
            self.m.fit(Xa, ya, sample_weight=wa)
        except TypeError:
            self.m.fit(Xa, ya)
        return self

    def predict(self, X):
        p1 = self.m.predict_proba(X)[:, 1]
        p2 = self.m.predict_proba(-X)[:, 1]
        return 0.5 * (p1 + 1 - p2)


def make_histgb(p):
    return lambda: HistGradientBoostingClassifier(
        learning_rate=p["learning_rate"], max_iter=p["max_iter"], max_leaf_nodes=p["max_leaf_nodes"], min_samples_leaf=p["min_samples_leaf"],
        l2_regularization=p["l2"], max_depth=p.get("max_depth"), random_state=SEED, early_stopping=False)


def make_lightgbm(p):
    import lightgbm as lgb

    return lambda: lgb.LGBMClassifier(
        n_estimators=p["n_estimators"], learning_rate=p["learning_rate"], num_leaves=p["num_leaves"], min_child_samples=p["min_child_samples"],
        reg_lambda=p["l2"], subsample=p["subsample"], subsample_freq=1, colsample_bytree=p["colsample"], random_state=SEED, verbose=-1, n_jobs=4)


def make_xgboost(p):
    import xgboost as xgb

    return lambda: xgb.XGBClassifier(
        n_estimators=p["n_estimators"], learning_rate=p["learning_rate"], max_depth=p["max_depth"], min_child_weight=p["min_child_weight"],
        reg_lambda=p["l2"], subsample=p["subsample"], colsample_bytree=p["colsample"], random_state=SEED, n_jobs=4, tree_method="hist", verbosity=0)


def make_catboost(p):
    from catboost import CatBoostClassifier

    return lambda: CatBoostClassifier(
        iterations=p["iterations"], learning_rate=p["learning_rate"], depth=p["depth"], l2_leaf_reg=p["l2"], random_seed=SEED, verbose=0, thread_count=4, allow_writing_files=False)


SPACES = {
    "histgb": lambda t: {"learning_rate": t.suggest_float("learning_rate", 0.01, 0.2, log=True), "max_iter": t.suggest_int("max_iter", 30, 300), "max_leaf_nodes": t.suggest_int("max_leaf_nodes", 3, 15),
                         "min_samples_leaf": t.suggest_int("min_samples_leaf", 20, 200), "l2": t.suggest_float("l2", 0.1, 50, log=True), "max_depth": t.suggest_int("max_depth", 2, 5)},
    "lightgbm": lambda t: {"n_estimators": t.suggest_int("n_estimators", 30, 400), "learning_rate": t.suggest_float("learning_rate", 0.01, 0.15, log=True), "num_leaves": t.suggest_int("num_leaves", 3, 15),
                           "min_child_samples": t.suggest_int("min_child_samples", 20, 200), "l2": t.suggest_float("l2", 0.1, 50, log=True), "subsample": t.suggest_float("subsample", 0.5, 1.0),
                           "colsample": t.suggest_float("colsample", 0.4, 1.0)},
    "xgboost": lambda t: {"n_estimators": t.suggest_int("n_estimators", 30, 400), "learning_rate": t.suggest_float("learning_rate", 0.01, 0.15, log=True), "max_depth": t.suggest_int("max_depth", 2, 5),
                          "min_child_weight": t.suggest_float("min_child_weight", 1, 60, log=True), "l2": t.suggest_float("l2", 0.1, 50, log=True), "subsample": t.suggest_float("subsample", 0.5, 1.0),
                          "colsample": t.suggest_float("colsample", 0.4, 1.0)},
    "catboost": lambda t: {"iterations": t.suggest_int("iterations", 50, 400), "learning_rate": t.suggest_float("learning_rate", 0.01, 0.15, log=True), "depth": t.suggest_int("depth", 2, 6),
                           "l2": t.suggest_float("l2", 1, 50, log=True)},
}
MAKERS = {"histgb": make_histgb, "lightgbm": make_lightgbm, "xgboost": make_xgboost, "catboost": make_catboost}


class FighterEffects:
    """Hierarchical (partially pooled) model: production features plus one random effect per fighter.

    A fighter's effect has a Gaussian prior around zero, so a fighter with one fight is pulled almost all the way to the population
    and a long-serving fighter keeps their own estimate. `effect_scale` sets the prior width; `half_life` (years) weights recent fights more.
    """

    def __init__(self, ridge: float = 5.0, effect_scale: float = 0.4, half_life: float | None = None):
        self.ridge, self.effect_scale, self.half_life = ridge, effect_scale, half_life

    def _design(self, X, a, b):
        rows = np.arange(len(a))
        ia = np.array([self.index.get(k, -1) for k in a])
        ib = np.array([self.index.get(k, -1) for k in b])
        F = sp.lil_matrix((len(a), len(self.index)))
        for r in rows[ia >= 0]:
            F[r, ia[r]] += 1.0
        for r in rows[ib >= 0]:
            F[r, ib[r]] -= 1.0
        return sp.hstack([sp.csr_matrix(X / self.s), self.effect_scale * F.tocsr()]).tocsr()

    def fit(self, X, y, a, b, age_years=None):
        self.s = rms_scale(X)
        names = sorted(set(a) | set(b))
        self.index = {k: i for i, k in enumerate(names)}
        w = None if self.half_life is None or age_years is None else 0.5 ** (np.asarray(age_years) / self.half_life)
        self.m = LogisticRegression(C=1.0 / self.ridge, fit_intercept=False, max_iter=3000).fit(self._design(X, a, b), y, sample_weight=w)
        return self

    def predict(self, X, a, b):
        return self.m.predict_proba(self._design(X, a, b))[:, 1]


# ---------------------------------------------------------------- Glicko-2

TAU = 0.5
SCALE = 173.7178
INIT_PHI = 350 / SCALE
INIT_SIGMA = 0.06
DAYS_PER_PERIOD = 60.0
_PARAMS = {'tau': TAU, 'phi': INIT_PHI}


def _g(phi):
    return 1.0 / math.sqrt(1.0 + 3.0 * phi * phi / (math.pi**2))


def _new_volatility(phi, sigma, v, delta):
    TAU = _PARAMS['tau']
    a = math.log(sigma * sigma)

    def f(x):
        ex = math.exp(x)
        return ex * (delta**2 - phi**2 - v - ex) / (2 * (phi**2 + v + ex) ** 2) - (x - a) / TAU**2

    A = a
    if delta**2 > phi**2 + v:
        B = math.log(delta**2 - phi**2 - v)
    else:
        k = 1
        while f(a - k * TAU) < 0:
            k += 1
        B = a - k * TAU
    fA, fB = f(A), f(B)
    for _ in range(60):
        if abs(B - A) < 1e-6:
            break
        C = A + (A - B) * fA / (fB - fA)
        fC = f(C)
        if fC * fB <= 0:
            A, fA = B, fB
        else:
            fA /= 2
        B, fB = C, fC
    return math.exp(A / 2)


def glicko2_update(mu: float, phi: float, sigma: float, games: list[tuple[float, float, float]]) -> tuple[float, float, float]:
    """One Glicko-2 rating-period update from (opponent mu, opponent phi, score) games; returns (mu', phi', sigma')."""
    v_inv, s = 0.0, 0.0
    for mj, pj, score in games:
        gj = _g(pj)
        e = 1 / (1 + math.exp(-gj * (mu - mj)))
        v_inv += gj * gj * e * (1 - e)
        s += gj * (score - e)
    v = 1 / v_inv
    delta = v * s
    sigma_new = _new_volatility(phi, sigma, v, delta)
    phi_star = math.sqrt(phi * phi + sigma_new * sigma_new)
    phi_new = 1 / math.sqrt(1 / (phi_star * phi_star) + 1 / v)
    return mu + phi_new * phi_new * s, phi_new, sigma_new


def glicko2_predictions(dates, a_keys, b_keys, y, tau: float = 0.5, init_rd: float = 350.0):
    """Pre-fight Glicko-2 win probability for fighter A on every row, using only earlier events.

    Each event date is one rating period. A fighter's rating deviation grows with time away (one volatility step per 60 days), so a
    returning or new fighter is treated as uncertain, and the forecast is pulled toward 50% in proportion to that uncertainty.
    """
    _PARAMS['tau'] = tau
    INIT_PHI = init_rd / SCALE
    n = len(dates)
    out = np.full(n, 0.5)
    state: dict[str, list[float]] = {}  # key -> [mu, phi, sigma, last_day]
    day = np.asarray(dates, dtype="datetime64[D]").astype(int)

    def current(key, today):
        mu, phi, sigma, last = state.get(key, [0.0, INIT_PHI, INIT_SIGMA, today])
        steps = max(0.0, (today - last) / DAYS_PER_PERIOD)
        phi = min(INIT_PHI, math.sqrt(phi * phi + steps * sigma * sigma))
        return mu, phi, sigma

    i = 0
    while i < n:
        j = i
        while j < n and day[j] == day[i]:
            j += 1
        today = int(day[i])
        pending: dict[str, list[tuple[float, float, float]]] = {}
        for r in range(i, j):
            ma, pa, _ = current(a_keys[r], today)
            mb, pb, _ = current(b_keys[r], today)
            out[r] = 1 / (1 + math.exp(-_g(math.sqrt(pa * pa + pb * pb)) * (ma - mb)))
            if not np.isnan(y[r]):
                pending.setdefault(a_keys[r], []).append((mb, pb, float(y[r])))
                pending.setdefault(b_keys[r], []).append((ma, pa, 1.0 - float(y[r])))
        for key, games in pending.items():
            mu, phi, sigma = current(key, today)
            state[key] = [*glicko2_update(mu, phi, sigma, games), today]
        i = j
    return out


class EarlyStopped:
    """A boosted model whose number of trees is chosen inside the training period: the last training year is held out to stop early,
    then the model is refitted on all training rows with that number of trees. Mirrored rows keep it symmetric."""

    def __init__(self, family: str, params: dict, learning_rate: float = 0.03, max_rounds: int = 800):
        self.family, self.params, self.lr, self.max_rounds = family, params, learning_rate, max_rounds

    def _make(self, rounds: int):
        p = dict(self.params)
        p["learning_rate"] = self.lr
        if self.family == "lightgbm":
            p["n_estimators"] = rounds
        elif self.family == "xgboost":
            p["n_estimators"] = rounds
        else:
            p["iterations"] = rounds
        return MAKERS[self.family](p)()

    def fit(self, X, y, fit_mask):
        Xf, yf = X[fit_mask], y[fit_mask]
        Xv, yv = X[~fit_mask], y[~fit_mask]
        Xa, ya = np.vstack([Xf, -Xf]), np.concatenate([yf, 1 - yf])
        best, best_ll = 50, 9.0
        probe = self._make(self.max_rounds)
        probe.fit(Xa, ya)
        # Staged predictions give the validation loss at every number of trees without refitting.
        for rounds in range(25, self.max_rounds + 1, 25):
            if self.family == "lightgbm":
                p = 0.5 * (probe.predict_proba(Xv, num_iteration=rounds)[:, 1] + 1 - probe.predict_proba(-Xv, num_iteration=rounds)[:, 1])
            elif self.family == "xgboost":
                p = 0.5 * (probe.predict_proba(Xv, iteration_range=(0, rounds))[:, 1] + 1 - probe.predict_proba(-Xv, iteration_range=(0, rounds))[:, 1])
            else:
                a = [q[1] for q in probe.predict_proba(Xv, ntree_end=rounds)]
                b = [q[1] for q in probe.predict_proba(-Xv, ntree_end=rounds)]
                p = 0.5 * (np.array(a) + 1 - np.array(b))
            p = np.clip(p, 1e-6, 1 - 1e-6)
            ll = float(-(yv * np.log(p) + (1 - yv) * np.log(1 - p)).mean())
            if ll < best_ll:
                best, best_ll = rounds, ll
        self.rounds = best
        Xall, yall = np.vstack([X, -X]), np.concatenate([y, 1 - y])
        self.m = self._make(best)
        self.m.fit(Xall, yall)
        return self

    def predict(self, X):
        return 0.5 * (self.m.predict_proba(X)[:, 1] + 1 - self.m.predict_proba(-X)[:, 1])
