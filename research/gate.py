"""Promotion-gate constants. They mirror server/backtest/promotion.ts, and a test checks that the two files agree."""
MIN_IMPROVEMENT = 0.002
MIN_FOLD_WIN_SHARE = 0.6
CALIBRATION_BAND = (0.8, 1.2)


def decide(estimate: float, lo: float, hi: float, fold_diffs: list[float], slope: float | None) -> dict:
    """Same rule as the TypeScript gate: interval below zero, gain of at least MIN_IMPROVEMENT, enough winning folds, sane calibration."""
    wins = sum(1 for d in fold_diffs if d < 0)
    share = wins / len(fold_diffs) if len(fold_diffs) >= 3 else None
    interval_ok = hi < 0
    size_ok = estimate <= -MIN_IMPROVEMENT
    folds_ok = share is not None and share >= MIN_FOLD_WIN_SHARE
    slope_ok = slope is None or CALIBRATION_BAND[0] <= slope <= CALIBRATION_BAND[1]
    if interval_ok and size_ok and folds_ok and slope_ok:
        mode = "promote"
    elif estimate < 0 and slope_ok:
        mode = "shadow"
    else:
        mode = "reject"
    why = [
        f"log loss {estimate:+.4f} [{lo:+.4f}, {hi:+.4f}]",
        "interval entirely below zero" if interval_ok else "interval includes zero",
        f"gain at least {MIN_IMPROVEMENT}" if size_ok else f"gain under the {MIN_IMPROVEMENT} minimum",
        "too few yearly folds" if share is None else f"better in {wins} of {len(fold_diffs)} yearly folds",
    ]
    if slope is not None:
        why.append(f"calibration slope {slope:.2f}" + ("" if slope_ok else " is outside 0.8 to 1.2"))
    return {"mode": mode, "reasons": why, "estimate": estimate, "lo": lo, "hi": hi, "foldWinShare": share}
