"""SCADA inference is separate from waveform analysis and field diagnoses."""
from __future__ import annotations

from datetime import datetime, timedelta
from functools import lru_cache
import json
import math
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from ai.care_multifault import MODEL_VERSION, SIGNALS, load_model, predict_portable, sha256, window_features
from backend.app.database import Database
from backend.app.diagnosis import persist_diagnosis
from backend.app.schemas import (
    DataOrigin,
    DiagnosisAnalyzeRequest,
    DiagnosisMappingStatus,
    DiagnosisPayload,
    ProcessingStep,
    SignalChannel,
    WarningLevel,
)

ROOT = Path(__file__).resolve().parents[2] / "models" / "care-multifault"
class ScadaRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    time_stamp: datetime
    signals: dict[str, float]


class ScadaWindow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rows: list[ScadaRow] = Field(min_length=36, max_length=36)


class FieldScadaWindow(ScadaWindow):
    """A traceable six-hour SCADA upload bound to one registered turbine."""

    turbine_id: str = Field(min_length=1, max_length=120)
    sample_id: str | None = Field(default=None, min_length=1, max_length=200)
    event_id: str | None = Field(default=None, min_length=1, max_length=120)
    source_reference: str = Field(min_length=1, max_length=1000)
    data_origin: DataOrigin = DataOrigin.REAL


CLASS_TO_COMPONENT = {
    "healthy": "UNMAPPED",
    "gearbox": "gearbox",
    "gearbox_bearing": "gearbox_bearing",
    "generator_bearing": "generator",
    "hydraulic": "hydraulic",
}

DEMO_FLEET_CASES = (
    ("WT01", "A-24"),  # normal operation
    ("WT02", "A-10"),  # gearbox
    ("WT03", "A-13"),  # normal operation; model prediction agrees with label
    ("WT04", "A-51"),  # gearbox bearing
    ("WT05", "A-22"),  # hydraulic
    ("WT06", "A-0"),   # generator bearing
)


def warning_level(risk: float) -> WarningLevel:
    if risk >= 0.75:
        return WarningLevel.HIGH
    if risk >= 0.45:
        return WarningLevel.MEDIUM
    if risk >= 0.2:
        return WarningLevel.LOW
    return WarningLevel.NORMAL


def validate_rows(rows: list[ScadaRow]) -> None:
    for index, row in enumerate(rows):
        if set(row.signals) != set(SIGNALS):
            raise HTTPException(422, "Expected exactly the CARE Farm A continuous signal schema")
        if not all(math.isfinite(value) for value in row.signals.values()):
            raise HTTPException(422, "All signal values must be finite")
        if (row.time_stamp.tzinfo is None) != (rows[0].time_stamp.tzinfo is None):
            raise HTTPException(422, "Use a consistent timezone for the entire window")
        if index and row.time_stamp - rows[index - 1].time_stamp != timedelta(minutes=10):
            raise HTTPException(422, "Expected 36 ordered consecutive 10-minute records")


def ensure_field_target(
    database: Database, turbine_id: str, component_id: str, display_name: str, data_origin: DataOrigin
) -> None:
    """Register a newly connected field asset without inventing an engineering mapping."""
    turbine = database.fetch_one("SELECT turbine_id FROM turbines WHERE turbine_id = ?", (turbine_id,))
    if not turbine:
        now = datetime.now().astimezone().isoformat()
        database.execute(
            """
            INSERT INTO turbines (turbine_id, display_name, wind_farm, operational_status, data_origin, created_at)
            VALUES (?, ?, ?, 'CONNECTED', ?, ?)
            """,
            (turbine_id, turbine_id, "FIELD_CONNECTED", data_origin.value, now),
        )
    component = database.fetch_one(
        "SELECT turbine_id FROM components WHERE component_id = ?", (component_id,)
    )
    if component and component["turbine_id"] != turbine_id:
        raise HTTPException(409, "component_id is already registered to a different turbine")
    if not component:
        now = datetime.now().astimezone().isoformat()
        database.execute(
            """
            INSERT INTO components (component_id, turbine_id, display_name, mapping_status, data_origin, created_at)
            VALUES (?, ?, ?, 'UNVERIFIED', ?, ?)
            """,
            (component_id, turbine_id, display_name, data_origin.value, now),
        )


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


def create_care_router(database: Database) -> APIRouter:
    router = APIRouter(prefix="/api/care", tags=["CARE SCADA"])

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
        validate_rows(window.rows)
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

    @router.post("/field-infer")
    def field_infer(window: FieldScadaWindow):
        """Run the deployed SCADA model and attach its output to the requested machine."""
        validate_rows(window.rows)
        model, cases = artifacts()
        probabilities = predict_portable(model, window_features([row.signals for row in window.rows]))
        prediction = max(probabilities, key=probabilities.get)
        risk = 1 - probabilities["healthy"]
        trend_key, trend_label, trend_unit = {
            "healthy": ("power_30_avg", "并网功率", "kW"),
            "generator_bearing": ("sensor_13_avg", "发电机驱动端轴承温度", "°C"),
            "gearbox": ("sensor_12_avg", "齿轮箱油温", "°C"),
            "hydraulic": ("sensor_41_avg", "液压油温", "°C"),
            "gearbox_bearing": ("sensor_11_avg", "齿轮箱高速轴轴承温度", "°C"),
        }[prediction]
        component_key = CLASS_TO_COMPONENT[prediction]
        component_id = f"{window.turbine_id}_{prediction.upper()}"
        component_name = {
            "healthy": "机组运行状态", "gearbox": "齿轮箱", "gearbox_bearing": "齿轮箱轴承",
            "generator_bearing": "发电机轴承", "hydraulic": "液压系统",
        }[prediction]
        ensure_field_target(database, window.turbine_id, component_id, component_name, window.data_origin)
        sample_id = window.sample_id or f"SCADA-{window.turbine_id}-{window.rows[-1].time_stamp.strftime('%Y%m%dT%H%M%S')}-{uuid4().hex[:8]}"
        request = DiagnosisAnalyzeRequest(
            sample_id=sample_id,
            turbine_id=window.turbine_id,
            component_id=component_id,
            event_id=window.event_id,
            data_origin=window.data_origin,
            sampling_rate_hz=1 / 600,
            channels=[SignalChannel(
                name=trend_key, unit=trend_unit,
                samples=[row.signals[trend_key] for row in window.rows],
                source_reference=window.source_reference,
                sensor_location=component_key if component_key != "UNMAPPED" else "机组运行状态",
            )],
            operating_condition={
                "scada_window": {
                    "records": 36, "interval_minutes": 10,
                    "start": window.rows[0].time_stamp.isoformat(), "end": window.rows[-1].time_stamp.isoformat(),
                    "source_reference": window.source_reference,
                },
                "active_power_kw": window.rows[-1].signals["power_30_avg"],
                "wind_speed_ms": window.rows[-1].signals["wind_speed_3_avg"],
            },
            preprocessing=[
                ProcessingStep(name="时间连续性校验", method="36条连续10分钟SCADA记录"),
                ProcessingStep(name="特征构建", method="40通道中位数、标准差、首尾变化"),
            ],
            diagnosis=DiagnosisPayload(
                model_version=MODEL_VERSION,
                class_probabilities=probabilities,
                predicted_class=prediction,
                uncertainty=1 - max(probabilities.values()),
                component_key=component_key,
                mapping_status=DiagnosisMappingStatus.CANDIDATE,
                health_index=100 * probabilities["healthy"],
                anomaly_score=risk,
                failure_risk=risk,
                warning_level=WarningLevel.NORMAL if prediction == "healthy" else warning_level(risk),
                rationale=(
                    f"连续6小时SCADA窗口经{MODEL_VERSION}推理，"
                    f"当前最匹配状态为 {prediction}。部件定位基于模型类别与所选部件的候选映射，需结合现场核验。"
                ),
            ),
        )
        result = persist_diagnosis(database, request)
        return {
            "diagnosis": result,
            "model_version": MODEL_VERSION,
            "model_sha256": cases["model_sha256"],
            "prediction": prediction,
            "probabilities": probabilities,
            "trend": {"signal": trend_key, "label": trend_label, "unit": trend_unit},
            "live_inference": True,
            "field_diagnosis_persisted": True,
            "calibrated_probability": False,
        }

    @router.post("/sync-demo-fleet")
    def sync_demo_fleet():
        """Populate the API workflow with the same six CARE cases as demo mode."""
        model, cases = artifacts()
        samples = {str(sample["id"]): sample for sample in cases["cases"]}
        results = []
        for turbine_id, case_id in DEMO_FLEET_CASES:
            sample = samples.get(case_id)
            if sample is None:
                raise HTTPException(503, f"Demo case {case_id} is unavailable")
            probabilities = predict_portable(model, sample["features"])
            prediction = max(probabilities, key=probabilities.get)
            component_key = CLASS_TO_COMPONENT[prediction]
            component_id = f"{turbine_id}_{prediction.upper()}"
            component_name = {
                "healthy": "机组运行状态", "gearbox": "齿轮箱", "gearbox_bearing": "齿轮箱轴承",
                "generator_bearing": "发电机轴承", "hydraulic": "液压系统",
            }[prediction]
            ensure_field_target(database, turbine_id, component_id, component_name, DataOrigin.DERIVED)
            risk = 1 - probabilities["healthy"]
            trend_key, trend_label, trend_unit = {
                "healthy": ("power_30_avg", "并网功率", "kW"),
                "generator_bearing": ("sensor_13_avg", "发电机驱动端轴承温度", "°C"),
                "gearbox": ("sensor_12_avg", "齿轮箱油温", "°C"),
                "hydraulic": ("sensor_41_avg", "液压油温", "°C"),
                "gearbox_bearing": ("sensor_11_avg", "齿轮箱高速轴轴承温度", "°C"),
            }[prediction]
            diagnosis = persist_diagnosis(database, DiagnosisAnalyzeRequest(
                sample_id=f"DEMO-{turbine_id}-{sample['sample_id']}",
                turbine_id=turbine_id,
                component_id=component_id,
                event_id=str(sample["event_id"]),
                event_name=str(sample["name"]),
                data_origin=DataOrigin.DERIVED,
                sampling_rate_hz=1 / 600,
                channels=[SignalChannel(
                    name=trend_key, unit=trend_unit, samples=sample["trend"],
                    source_reference=f"CARE Wind Farm A / event {sample['event_id']}",
                    sensor_location=component_name,
                )],
                operating_condition={
                    "scada_window": {"records": 36, "interval_minutes": 10, "source": "CARE demo case"},
                    "active_power_kw": sample["telemetry"].get("power_30_avg"),
                    "wind_speed_ms": sample["telemetry"].get("wind_speed_3_avg"),
                },
                preprocessing=[
                    ProcessingStep(name="案例窗口载入", method="CARE 风场 A 连续 36 条十分钟记录"),
                    ProcessingStep(name="特征构建", method="40通道中位数、标准差、首尾变化"),
                ],
                diagnosis=DiagnosisPayload(
                    model_version=MODEL_VERSION,
                    class_probabilities=probabilities,
                    predicted_class=prediction,
                    uncertainty=1 - max(probabilities.values()),
                    component_key=component_key,
                    mapping_status=DiagnosisMappingStatus.CANDIDATE,
                    health_index=100 * probabilities["healthy"],
                    anomaly_score=risk,
                    failure_risk=risk,
                    warning_level=WarningLevel.NORMAL if prediction == "healthy" else warning_level(risk),
                    rationale=f"CARE 演示场景同步：{sample['sample_id']} 的六小时窗口经 {MODEL_VERSION} 重算。",
                ),
            ))
            results.append({"turbine_id": turbine_id, "diagnosis_id": diagnosis.diagnosis_id, "prediction": prediction})
        return {
            "source": "CARE_DEMO_SYNC", "data_origin": DataOrigin.DERIVED,
            "model_version": MODEL_VERSION, "model_sha256": cases["model_sha256"],
            "turbines": results,
        }

    return router
