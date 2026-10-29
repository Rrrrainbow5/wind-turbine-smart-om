from datetime import datetime, timedelta
import json
from pathlib import Path

from fastapi.testclient import TestClient
import numpy as np
import pandas as pd

from ai.care_multifault import (
    FEATURE_NAMES, SIGNALS, build_windows, load_model, predict_portable, sha256, window_features,
)
from backend.app.main import create_app

ROOT = Path(__file__).resolve().parents[1] / "models" / "care-multifault"


def test_saved_model_recomputes_every_case():
    manifest = json.loads((ROOT / "cases.json").read_text(encoding="utf-8"))
    model = load_model(ROOT / "model.json.gz")
    assert sha256(ROOT / "model.json.gz") == manifest["model_sha256"]
    assert len(manifest["classes"]) == 6
    assert len(manifest["cases"]) >= 6
    assert not any(metadata in name for metadata in ("asset_id", "event_id", "train_test", "time_stamp") for name in FEATURE_NAMES)
    for sample in manifest["cases"]:
        recomputed = predict_portable(model, sample["features"])
        assert np.allclose(list(recomputed.values()), list(sample["probabilities"].values()), atol=1e-12)
        assert sample["prediction"] == max(recomputed, key=recomputed.get)
        assert abs(sum(recomputed.values()) - 1) < 1e-10
        assert len(sample["trend"]) == 36
        expected_signal = {
            "healthy": "power_30_avg", "generator_bearing": "sensor_13_avg",
            "gearbox": "sensor_12_avg", "hydraulic": "sensor_41_avg",
            "gearbox_bearing": "sensor_11_avg", "transformer": "sensor_38_avg",
        }[sample["label"]]
        assert sample["trend_signal"] == expected_signal
        assert np.isclose(np.median(sample["trend"]), sample["telemetry"][expected_signal])
    frontend = Path(__file__).resolve().parents[1] / "frontend/src/care-cases.json"
    assert json.loads(frontend.read_text(encoding="utf-8")) == manifest
    report = json.loads((ROOT / "report.json").read_text(encoding="utf-8"))
    for fold in report["folds"]:
        assert not set(fold["train_assets"]) & set(fold["test_assets"])
    assert len(report["folds"]) == 5


def test_windows_exclude_training_rows_partial_intervals_and_conflicts(tmp_path):
    (tmp_path / "datasets").mkdir()
    frame = pd.DataFrame({key: np.arange(144, dtype=float) for key in SIGNALS})
    frame["time_stamp"] = pd.date_range("2023-01-01", periods=144, freq="10min")
    frame["train_test"] = "prediction"
    frame.loc[:35, "train_test"] = "train"
    frame.to_csv(tmp_path / "datasets/0.csv", sep=";", index=False)
    events = pd.DataFrame([{
        "asset": 0, "event_id": 0, "event_label": "anomaly",
        "event_start": "2023-01-01 05:00", "event_end": "2023-01-01 18:30",
        "event_description": "Gearbox failure",
    }])
    events.to_csv(tmp_path / "event_info.csv", sep=";", index=False)
    windows, _, _ = build_windows(tmp_path)
    assert [row["start"] for row in windows] == ["2023-01-01 06:00:00", "2023-01-01 12:00:00"]
    # A second event of a different class removes the overlapping six-hour window.
    events.loc[1] = [0, 1, "anomaly", "2023-01-01 12:00", "2023-01-01 17:50", "Hydraulic group"]
    frame.to_csv(tmp_path / "datasets/1.csv", sep=";", index=False)
    events.to_csv(tmp_path / "event_info.csv", sep=";", index=False)
    windows, _, rejected = build_windows(tmp_path)
    assert len(windows) == 1
    assert rejected["overlapping_labels"] > 0
    assert windows[0]["label"] == "gearbox"


def test_feature_contract_uses_real_window_values():
    rows = [{key: index for key in SIGNALS} for index in range(36)]
    result = window_features(rows)
    assert result[:len(SIGNALS)] == [17.5] * len(SIGNALS)
    assert result[-len(SIGNALS):] == [35.0] * len(SIGNALS)


def test_scada_api_computes_and_rejects_incompatible_inputs(tmp_path):
    with TestClient(create_app(tmp_path / "care.db")) as client:
        manifest = client.get("/api/care/cases").json()
        sample = manifest["cases"][0]
        replay = client.post(f"/api/care/cases/{sample['id']}/infer")
        assert replay.status_code == 200
        assert replay.json()["prediction"] == sample["prediction"]
        assert replay.json()["source"] == "TRAINING_CASE_REPLAY"
        assert client.post("/api/care/cases/missing/infer").status_code == 404
        start = datetime(2023, 1, 1)
        rows = [{"time_stamp": (start + timedelta(minutes=10 * index)).isoformat(),
                 "signals": {key: float(index) for key in SIGNALS}} for index in range(36)]
        result = client.post("/api/care/infer", json={"rows": rows})
        assert result.status_code == 200
        assert result.json()["live_inference"] is True
        assert result.json()["field_diagnosis_persisted"] is False
        rows[2]["time_stamp"] = rows[1]["time_stamp"]
        assert client.post("/api/care/infer", json={"rows": rows}).status_code == 422
        assert client.post("/api/care/infer", json={"rows": rows[:12]}).status_code == 422
        rows[2]["time_stamp"] = (start + timedelta(minutes=20)).isoformat()
        rows[0]["signals"]["event_id"] = 0
        assert client.post("/api/care/infer", json={"rows": rows}).status_code == 422
