"""Isolation Forest anomaly model + calibration + per-feature deviation explanations."""
import json
from pathlib import Path
from typing import Dict, List, Optional

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest

from app.ml.features import FEATURE_LABELS, FEATURES
from app.ml.synthetic import generate

ARTIFACT = Path(__file__).parent / "artifacts" / "isolation_forest.joblib"
MODEL_VERSION = "iforest-synthetic-v1"


def train(path: Path = ARTIFACT, n: int = 6000, seed: int = 42) -> dict:
    X = generate(n=n, seed=seed)
    clf = IsolationForest(n_estimators=250, contamination=0.03, random_state=seed)
    clf.fit(X)
    scores = np.sort(clf.score_samples(X))  # higher = more normal
    # Statistics from the bulk of the data (robust to the injected anomalies) for plain-English deviations.
    med = np.median(X, axis=0)
    mad = np.median(np.abs(X - med), axis=0) * 1.4826
    std = np.where(mad < 1e-6, X.std(axis=0) + 1e-6, mad)
    art = {"model": clf, "train_scores": scores, "median": med, "scale": std, "features": FEATURES,
           "version": MODEL_VERSION, "trained_on": "synthetic", "n_samples": int(n)}
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(art, path)
    return {k: v for k, v in art.items() if k in ("version", "trained_on", "n_samples")}


class AnomalyModel:
    def __init__(self, path: Path = ARTIFACT):
        try:
            self.art = joblib.load(path)
            _ = self.art["model"].n_features_in_
        except Exception:  # missing, or saved by an incompatible scikit-learn version -> retrain (takes ~2 s)
            train(path)
            self.art = joblib.load(path)

    @property
    def version(self) -> str:
        return self.art["version"]

    def score(self, feats: Dict[str, float]) -> Dict:
        x = np.array([[feats[f] for f in FEATURES]], dtype=float)
        raw = float(self.art["model"].score_samples(x)[0])
        ts = self.art["train_scores"]
        # share of training invoices that look MORE normal than this one
        percentile = float(100.0 * np.searchsorted(ts, raw, side="left") / len(ts))
        anomaly_pct = 100.0 - percentile
        z = (x[0] - self.art["median"]) / self.art["scale"]
        devs: List[Dict] = []
        for name, zi, val in sorted(zip(FEATURES, z, x[0]), key=lambda t: -abs(t[1])):
            if abs(zi) >= 3.0:
                devs.append({"feature": name, "label": FEATURE_LABELS[name], "value": round(float(val), 3), "deviation": round(float(zi), 1)})
        return {"anomaly_percentile": round(anomaly_pct, 1), "raw_score": round(raw, 4),
                "top_deviations": devs[:4], "model_version": self.version, "trained_on": self.art["trained_on"]}


_model: Optional[AnomalyModel] = None


def get_model() -> AnomalyModel:
    global _model
    if _model is None:
        _model = AnomalyModel()
    return _model


if __name__ == "__main__":
    print(json.dumps(train(), indent=2))
