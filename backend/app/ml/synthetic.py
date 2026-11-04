"""SYNTHETIC training data. There is no public labelled invoice-fraud dataset that can be used freely, so the
model learns what 'ordinary' invoice behaviour looks like from simulated, plausible distributions.
This is an anomaly detector - it flags UNUSUAL invoices, it does not prove fraud."""
import numpy as np

from app.ml.features import FEATURES, NEUTRAL_SIMILARITY


def generate(n: int = 6000, contamination: float = 0.03, seed: int = 42) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n_bad = int(n * contamination)
    n_ok = n - n_bad
    ok = {
        "amount_log": rng.normal(9.0, 1.2, n_ok),
        "amount_z_supplier": np.clip(rng.normal(0, 1.0, n_ok), -3, 3),
        "amount_z_pair": np.clip(rng.normal(0, 1.0, n_ok), -3, 3),
        "is_round_amount": (rng.random(n_ok) < 0.05).astype(float),
        "term_days": rng.choice([15, 30, 45, 60, 90], n_ok, p=[0.1, 0.4, 0.15, 0.25, 0.1]) + rng.integers(-2, 3, n_ok),
        "age_days": rng.integers(0, 25, n_ok).astype(float),
        # ~30% of ordinary invoices come from suppliers/buyers with no history yet
        "number_similarity": np.where(rng.random(n_ok) < 0.3, NEUTRAL_SIMILARITY, rng.beta(2, 8, n_ok)),
        "same_amount_recent": rng.poisson(0.04, n_ok).astype(float),
        "supplier_velocity_7d": rng.poisson(1.2, n_ok).astype(float),
        "pair_history": np.where(rng.random(n_ok) < 0.3, 0.0, rng.poisson(3.0, n_ok)).astype(float),
        "missing_count": (rng.random(n_ok) < 0.05).astype(float),
        "ocr_confidence": np.clip(rng.normal(0.94, 0.05, n_ok), 0.4, 1.0),
    }
    bad = {
        "amount_log": rng.normal(12.5, 1.0, n_bad),
        "amount_z_supplier": rng.choice([-1, 1], n_bad) * rng.uniform(3.5, 8, n_bad),
        "amount_z_pair": rng.choice([-1, 1], n_bad) * rng.uniform(3.5, 8, n_bad),
        "is_round_amount": (rng.random(n_bad) < 0.7).astype(float),
        "term_days": rng.choice([-20, -3, 0, 240, 365], n_bad).astype(float),
        "age_days": rng.choice([-15, -5, 120, 300], n_bad).astype(float),
        "number_similarity": rng.uniform(0.9, 1.0, n_bad),
        "same_amount_recent": rng.integers(1, 4, n_bad).astype(float),
        "supplier_velocity_7d": rng.integers(7, 20, n_bad).astype(float),
        "pair_history": np.zeros(n_bad),
        "missing_count": rng.integers(2, 5, n_bad).astype(float),
        "ocr_confidence": rng.uniform(0.3, 0.6, n_bad),
    }
    cols = lambda d: np.column_stack([d[f] for f in FEATURES])  # noqa: E731
    X = np.vstack([cols(ok), cols(bad)])
    rng.shuffle(X)
    return X
