"""SCADA inference is separate from waveform analysis and field diagnoses."""
from __future__ import annotations

from datetime import datetime, timedelta
from functools import lru_cache
import json
import math
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from ai.care_multifault import MODEL_VERSION, SIGNALS, load_model, predict_portable, sha256, window_features

ROOT = Path(__file__).resolve().parents[2] / "models" / "care-multifault"
router = APIRouter(prefix="/api/care", tags=["CARE SCADA"])


class ScadaRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    time_stamp: datetime
    signals: dict[str, float]


class ScadaWindow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rows: list[ScadaRow] = Field(min_length=36, max_length=36)


@lru_cache(maxsize=1)
def artifacts() -> tuple[dict, dict]:
    try:
        cases = json.loads((ROOT / "cases.json").read_text(encoding="utf-8"))
        path = ROOT / "model.json.gz"
        if sha256(path) != cases["model_sha256"]:
            raise ValueError("CARE model hash does not match case manifest")
        return load_model(path), cases
    except (OSError, ValueError) as error:
        raise HTTPException(503, "CARE model artifacts unavailable or invalid") from error


@router.get("/cases")
def list_cases():
    return artifacts()[1]


@router.get("/report")
def report():
    artifacts()
    return json.loads((ROOT / "report.json").read_text(encoding="utf-8"))


@router.post("/cases/{case_id}/infer")
def infer_case(case_id: str):
    model, cases = artifacts()
    sample = next((row for row in cases["cases"] if row["id"] == case_id), None)
    if sample is None:
        raise HTTPException(404, "Unknown CARE case")
    probabilities = predict_portable(model, sample["features"])
    return {
        "sample_id": sample["sample_id"], "prediction": max(probabilities, key=probabilities.get),
        "probabilities": probabilities, "model_version": MODEL_VERSION,
        "model_sha256": cases["model_sha256"], "live_inference": True,
        "source": "TRAINING_CASE_REPLAY", "field_diagnosis_persisted": False,
    }


@router.post("/infer")
def infer(window: ScadaWindow):
    for index, row in enumerate(window.rows):
        if set(row.signals) != set(SIGNALS):
            raise HTTPException(422, "Expected exactly the CARE Farm A continuous signal schema")
        if not all(math.isfinite(value) for value in row.signals.values()):
            raise HTTPException(422, "All signal values must be finite")
        if (row.time_stamp.tzinfo is None) != (window.rows[0].time_stamp.tzinfo is None):
            raise HTTPException(422, "Use a consistent timezone for the entire window")
        if index and row.time_stamp - window.rows[index - 1].time_stamp != timedelta(minutes=10):
            raise HTTPException(422, "Expected 36 ordered consecutive 10-minute records")
    model, cases = artifacts()
    probabilities = predict_portable(model, window_features([row.signals for row in window.rows]))
    prediction = max(probabilities, key=probabilities.get)
    return {
        "model_version": MODEL_VERSION, "model_sha256": cases["model_sha256"],
        "prediction": prediction, "probabilities": probabilities,
        "anomaly_score": 1 - probabilities["healthy"],
        "source": "SUBMITTED_SCADA_WINDOW", "live_inference": True,
        "field_diagnosis_persisted": False, "calibrated_probability": False,
        "limitations": cases["limits"],
    }
