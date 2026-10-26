"""Checks for the research code. Run:  research/.venv/bin/python -m unittest discover -s research -p 'test_*.py'"""
import re
import unittest
from pathlib import Path

import numpy as np

import gate
from common import calibration_fit, paired_bootstrap, sigmoid
from models import Logistic, Mirrored, FighterEffects, MAKERS, glicko2_predictions, glicko2_update, SCALE

ROOT = Path(__file__).resolve().parents[1]


class Glicko2(unittest.TestCase):
    def test_matches_glickmans_worked_example(self):
        # Glickman (2013), "Example of the Glicko-2 system": a 1500 player (RD 200) against 1400/30 (win), 1550/100 (loss), 1700/300 (loss)
        mu, phi, sigma = 0.0, 200 / SCALE, 0.06
        games = [((1400 - 1500) / SCALE, 30 / SCALE, 1.0), ((1550 - 1500) / SCALE, 100 / SCALE, 0.0), ((1700 - 1500) / SCALE, 300 / SCALE, 0.0)]
        mu2, phi2, sigma2 = glicko2_update(mu, phi, sigma, games)
        self.assertAlmostEqual(mu2 * SCALE + 1500, 1464.06, delta=0.05)
        self.assertAlmostEqual(phi2 * SCALE, 151.52, delta=0.05)
        self.assertAlmostEqual(sigma2, 0.05999, delta=0.0001)

    def test_uses_only_earlier_fights_and_is_symmetric(self):
        dates = np.array(["2020-01-01", "2020-02-01", "2020-03-01", "2020-04-01"], dtype="datetime64[D]")
        a, b = np.array(["x", "x", "y", "x"]), np.array(["y", "z", "z", "y"])
        y = np.array([1.0, 1.0, 0.0, 1.0])
        p = glicko2_predictions(dates, a, b, y)
        self.assertAlmostEqual(p[0], 0.5)  # nothing is known before the first fight
        changed = y.copy()
        changed[3] = 0.0  # flipping the last result must not move any earlier forecast, or its own
        q = glicko2_predictions(dates, a, b, changed)
        np.testing.assert_allclose(p, q)
        swapped = glicko2_predictions(dates, b, a, 1 - y)
        np.testing.assert_allclose(p + swapped, 1.0, atol=1e-9)


class Symmetry(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(0)
        self.X = rng.normal(size=(600, 5))
        self.y = (rng.random(600) < sigmoid(self.X @ np.array([1.0, -0.5, 0.2, 0, 0.3]))).astype(float)

    def test_logistic_and_trees_return_the_complement_when_the_fighters_swap(self):
        lr = Logistic(5.0).fit(self.X, self.y)
        np.testing.assert_allclose(lr.predict(self.X) + lr.predict(-self.X), 1.0, atol=1e-9)
        tree = Mirrored(MAKERS["histgb"]({"learning_rate": 0.1, "max_iter": 30, "max_leaf_nodes": 5, "min_samples_leaf": 20, "l2": 1.0, "max_depth": 3})).fit(self.X, self.y)
        np.testing.assert_allclose(tree.predict(self.X) + tree.predict(-self.X), 1.0, atol=1e-9)

    def test_fighter_effects_pull_a_one_fight_fighter_toward_the_population(self):
        rng = np.random.default_rng(1)
        a = np.array(["star"] * 80 + ["rookie"] + ["p%d" % i for i in range(60)])
        b = np.array(["p%d" % (i % 60) for i in range(80)] + ["p0"] + ["q%d" % i for i in range(60)])
        X = np.zeros((len(a), 2))
        y = np.concatenate([np.ones(80), [1.0], (rng.random(60) < 0.5).astype(float)])
        m = FighterEffects(5.0, 1.0).fit(X + 1e-3 * rng.normal(size=X.shape), y, a, b)
        eff = dict(zip(sorted(set(a) | set(b)), m.m.coef_[0][2:]))
        self.assertGreater(eff["star"], 3 * abs(eff["rookie"]))


class Statistics(unittest.TestCase):
    def test_calibration_fit_finds_overconfidence(self):
        rng = np.random.default_rng(2)
        truth = 0.3 + 0.4 * rng.random(20000)
        y = (rng.random(20000) < truth).astype(float)
        stretched = sigmoid(2.2 * np.log(truth / (1 - truth)))
        self.assertLess(calibration_fit(stretched, y)["slope"], 0.6)

    def test_paired_bootstrap_resamples_whole_events(self):
        diff = np.array([-0.1, -0.1, 0.3, 0.3])
        events = np.array(["e1", "e1", "e2", "e2"])
        est, lo, hi = paired_bootstrap(diff, events, iters=500)
        self.assertAlmostEqual(est, 0.1)
        self.assertLessEqual(lo, est)
        self.assertGreaterEqual(hi, est)
        self.assertLess(lo, 0.0)  # two events cannot support a confident claim


class Gate(unittest.TestCase):
    def test_constants_match_the_typescript_gate(self):
        ts = (ROOT / "server/backtest/promotion.ts").read_text()
        self.assertEqual(float(re.search(r"MIN_IMPROVEMENT = ([0-9.]+)", ts).group(1)), gate.MIN_IMPROVEMENT)
        self.assertEqual(float(re.search(r"MIN_FOLD_WIN_SHARE = ([0-9.]+)", ts).group(1)), gate.MIN_FOLD_WIN_SHARE)
        band = re.search(r"CALIBRATION_BAND: \[number, number\] = \[([0-9.]+), ([0-9.]+)\]", ts)
        self.assertEqual((float(band.group(1)), float(band.group(2))), gate.CALIBRATION_BAND)

    def test_decisions(self):
        folds = [-0.01, -0.004, -0.008, 0.002, -0.006]
        self.assertEqual(gate.decide(-0.006, -0.011, -0.001, folds, 1.0)["mode"], "promote")
        self.assertEqual(gate.decide(-0.006, -0.011, 0.002, folds, 1.0)["mode"], "shadow")
        self.assertEqual(gate.decide(0.003, 0.0, 0.006, folds, 1.0)["mode"], "reject")
        self.assertEqual(gate.decide(-0.006, -0.011, -0.001, folds, 0.5)["mode"], "reject")


if __name__ == "__main__":
    unittest.main()
