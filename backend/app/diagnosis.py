from __future__ import annotations

from datetime import datetime, timezone
import json
import math
from pathlib import Path
from statistics import mean, pvariance
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from backend.app.database import Database
from backend.app.schemas import (
    DataOrigin,
    DemoSimulationRequest,
    DiagnosisAnalyzeRequest,
    DiagnosisHistoryResponse,
    DiagnosisPayload,
    DiagnosisSample,
    DiagnosisSummary,
    FaultFeature,
    FaultLibraryResponse,
    ModelMetadata,
    ProcessingStep,
    WarningLevel,
)


MODEL_CATALOG: dict[str, dict[str, object]] = {
    "robust-z-v0.1.0": {
        "status": "BASELINE",
        "model_family": "robust statistical baseline",
        "methods": ["median/MAD robust z-score"],
        "feature_groups": ["CARE aggregated condition signals"],
        "data_origins": [DataOrigin.DERIVED],
        "limitations": [
            "relative risk only",
            "CARE data is aggregated and not raw vibration/current waveform",
        ],
        "references": ["docs/B_EVENT51_BASELINE_V0_1.md"],
        "training_data_version": "CARE to Compare Version 6",
        "validation_split": "chronological 60/20/20",
        "validation_metrics": {
            "precision": 0.5682,
            "recall": 0.0149,
            "f1": 0.0291,
            "roc_auc": 0.4659,
        },
        "calibration_status": "NOT_CALIBRATED",
        "threshold_source": "99th percentile of validation anomaly scores",
        "input_schema": "CARE aggregated feature rows; see docs/B_EVENT51_BASELINE_V0_1.md",
        "code_or_model_hash": None,
    },
    "hybrid-ai-v0.2.0": {
        "status": "NOT_IMPLEMENTED",
        "model_family": "hybrid signal-analysis demonstration",
        "methods": [
            "time-domain statistics",
            "FFT/STFT or wavelet artifact review",
            "rule-assisted fusion",
        ],
        "feature_groups": [
            "time features",
            "spectral peaks",
            "time-frequency artifacts",
            "2D embedding",
        ],
        "data_origins": [
            DataOrigin.SIMULATED,
            DataOrigin.USER_INPUT,
            DataOrigin.EXTERNAL_PUBLIC,
        ],
        "limitations": [
            "demo inference is not a calibrated probability",
            "mapping remains UNMAPPED until engineering verification",
        ],
        "references": ["docs/ai/fault-feature-library-v0.2.md"],
        "training_data_version": None,
        "validation_split": None,
        "validation_metrics": {},
        "calibration_status": "NOT_AVAILABLE",
        "threshold_source": "NOT_AVAILABLE",
        "input_schema": "signal-analysis.v2 (planned)",
        "code_or_model_hash": None,
    },
    "rule-demo-v0.2.0": {
        "status": "DEMO_ONLY",
        "model_family": "deterministic coupled-sensor demonstration",
        "methods": [
            "documented engineering demo rules",
            "fault-specific synthetic signals",
        ],
        "feature_groups": [
            "five demo controls",
            "simulated vibration/current previews",
        ],
        "data_origins": [DataOrigin.SIMULATED, DataOrigin.USER_INPUT],
        "limitations": [
            "not a trained AI model",
            "not a calibrated probability",
            "assumed ranges are not manufacturer limits",
        ],
        "references": [
            "docs/api-contract.md",
            "docs/ai/fault-feature-library-v0.2.md",
        ],
        "training_data_version": None,
        "validation_split": None,
        "validation_metrics": {},
        "calibration_status": "NOT_CALIBRATED",
        "threshold_source": "ASSUMED demo ranges documented in API implementation",
        "input_schema": "signal-analysis.v2 / DemoSimulationRequest",
        "code_or_model_hash": None,
    },
    "care-v6-offshore-demo-0.1": {
        "status": "DEMO_ONLY",
        "model_family": "CARE derived demonstration baseline",
        "methods": ["reproducible robust-z baseline"],
        "feature_groups": ["CARE aggregated SCADA/condition summary"],
        "data_origins": [DataOrigin.DERIVED],
        "limitations": ["trial asset mapping and physical scale require confirmation"],
        "references": [
            "docs/B_EVENT51_BASELINE_V0_1.md",
            "data/telemetry/WT02_telemetry_summary.json",
        ],
        "training_data_version": "CARE to Compare Version 6",
        "validation_split": "see robust-z-v0.1.0 baseline documentation",
        "validation_metrics": {},
        "calibration_status": "NOT_CALIBRATED",
        "threshold_source": "project demo mapping",
        "input_schema": "CARE aggregated telemetry summary",
        "code_or_model_hash": None,
    },
}


DEMO_SENSOR_SPECS: dict[str, dict[str, float | str]] = {
    "blade_rpm": {
        "min": 0.0,
        "max": 30.0,
        "normal_min": 8.0,
        "normal_max": 16.0,
        "default": 12.0,
        "unit": "rpm",
    },
    "gearbox_oil_temperature_c": {
        "min": -20.0,
        "max": 120.0,
        "normal_min": 40.0,
        "normal_max": 70.0,
        "default": 54.0,
        "unit": "degC",
    },
    "wind_speed_ms": {
        "min": 0.0,
        "max": 35.0,
        "normal_min": 4.0,
        "normal_max": 15.0,
        "default": 8.3,
        "unit": "m/s",
    },
    "noise_db": {
        "min": 30.0,
        "max": 120.0,
        "normal_min": 45.0,
        "normal_max": 75.0,
        "default": 68.0,
        "unit": "dB",
    },
    "output_power_kw": {
        "min": 0.0,
        "max": 3000.0,
        "normal_min": 500.0,
        "normal_max": 2500.0,
        "default": 1580.0,
        "unit": "kW",
    },
}


def demo_range_deviation(name: str, value: float) -> float:
    spec = DEMO_SENSOR_SPECS[name]
    normal_min = float(spec["normal_min"])
    normal_max = float(spec["normal_max"])
    if normal_min <= value <= normal_max:
        return 0.0
    if value < normal_min:
        return min(
            1.0,
            (normal_min - value) / max(1e-9, normal_min - float(spec["min"])),
        )
    return min(
        1.0,
        (value - normal_max) / max(1e-9, float(spec["max"]) - normal_max),
    )


def load_fault_features() -> list[FaultFeature]:
    """Load the reviewed fault catalogue; never silently replace its schema."""
    path = (
        Path(__file__).resolve().parents[2]
        / "data"
        / "fault-library"
        / "fault-features.json"
    )
    if not path.is_file():
        raise HTTPException(status_code=503, detail="Reviewed fault library is unavailable")
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(document, dict):
            raise HTTPException(
                status_code=503, detail="Reviewed fault library root must be an object"
            )
        if document.get("schema_version") != "fault-feature-library-v0.2":
            raise HTTPException(
                status_code=503, detail="Reviewed fault library schema is unsupported"
            )
        standards = document.get("standards", [])
        registered_references = {
            str(item["ref_id"])
            for item in standards
            if isinstance(item, dict) and item.get("ref_id")
        }
        raw_items: object = document.get("items", document.get("faults"))
        if "categories" in document and isinstance(document["categories"], list):
            flattened: list[dict[str, object]] = []
            for category in document["categories"]:
                    if not isinstance(category, dict):
                        continue
                    category_id = str(category.get("id", "UNKNOWN"))
                    component_targets = category.get("component_targets", [])
                    if not isinstance(component_targets, list):
                        component_targets = []
                    modes = category.get("failure_modes", [])
                    if not isinstance(modes, list):
                        continue
                    for mode in modes:
                        if not isinstance(mode, dict):
                            continue
                        mode_id = str(mode.get("id", f"{category_id}_UNKNOWN"))
                        component_key = {
                            "GEAR_TOOTH_BREAKAGE": "gearbox",
                            "GEAR_PITTING_SCORING": "gearbox",
                            "BEARING_RACEWAY_DAMAGE": "bearing",
                            "BEARING_LUBRICATION_OR_MISALIGNMENT": "bearing",
                            "BROADBAND_IMPACT": "drivetrain",
                            "RESONANCE_OR_TOWER_VIBRATION": "tower",
                            "STATOR_WINDING_OR_PHASE_IMBALANCE": "generator",
                            "CONVERTER_OR_IGBT_THERMAL": "converter",
                        }.get(mode_id, "UNMAPPED")
                        signals = mode.get("signals", [])
                        signal_names = [
                            str(signal.get("signal_id"))
                            for signal in signals
                            if isinstance(signal, dict) and signal.get("signal_id")
                        ]
                        features = mode.get("frequency_features", [])
                        first_formula = None
                        required: list[str] = []
                        refs: list[str] = []
                        frequency_features: list[dict[str, object]] = []
                        if isinstance(features, list):
                            for feature in features:
                                if not isinstance(feature, dict):
                                    continue
                                first_formula = first_formula or feature.get("formula")
                                params = feature.get("required_parameters", [])
                                if isinstance(params, list):
                                    required.extend(str(param) for param in params)
                                source_refs = feature.get("source_refs", [])
                                if isinstance(source_refs, list):
                                    refs.extend(str(ref) for ref in source_refs)
                                    unknown_refs = {
                                        str(ref) for ref in source_refs
                                    } - registered_references
                                    if unknown_refs:
                                        raise HTTPException(
                                            status_code=503,
                                            detail="Reviewed fault library references an unknown standard",
                                        )
                                formula = feature.get("formula")
                                if formula:
                                    frequency_features.append(
                                        {
                                            "name": str(
                                                feature.get(
                                                    "label",
                                                    feature.get(
                                                        "feature_id", "frequency feature"
                                                    ),
                                                )
                                            ),
                                            "formula": str(formula),
                                            "required_parameters": [
                                                str(param) for param in params
                                            ]
                                            if isinstance(params, list)
                                            else [],
                                            "conditions": [
                                                str(value)
                                                for value in (
                                                    feature.get("applicability"),
                                                    feature.get("care_status"),
                                                )
                                                if value
                                            ],
                                            "source_references": [
                                                str(ref) for ref in source_refs
                                            ]
                                            if isinstance(source_refs, list)
                                            else [],
                                        }
                                    )
                        flattened.append(
                            {
                                "fault_id": mode_id,
                                "category": category_id,
                                "failure_form": str(
                                    mode.get("name_zh", mode.get("id", "未命名失效"))
                                ),
                                "mechanism": str(
                                    mode.get("mechanism", "未提供机理说明")
                                ),
                                "typical_symptoms": [
                                    str(value)
                                    for value in mode.get("typical_symptoms", [])
                                ]
                                if isinstance(mode.get("typical_symptoms", []), list)
                                else [],
                                "affected_signals": signal_names,
                                "affected_component_key": component_key,
                                "affected_component_candidates": [
                                    str(value) for value in component_targets
                                ],
                                "mapping_caution": str(mode["mapping_caution"])
                                if mode.get("mapping_caution")
                                else None,
                                "frequency_formula": str(first_formula)
                                if first_formula
                                else None,
                                "required_parameters": list(dict.fromkeys(required)),
                                "source_type": "REFERENCE",
                                "source_reference": "; ".join(dict.fromkeys(refs))
                                or "fault-feature-library-v0.2",
                                "frequency_features": frequency_features,
                            }
                        )
            if flattened:
                raw_items = flattened
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=503, detail="Reviewed fault library is invalid"
        ) from exc
    if not isinstance(raw_items, list) or not raw_items:
        raise HTTPException(
            status_code=503, detail="Reviewed fault library has no fault entries"
        )
    items: list[FaultFeature] = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        normalized = dict(raw)
        if "affected_component_key" not in normalized:
            normalized["affected_component_key"] = normalized.get("component_key")
        normalized.setdefault("source_type", "REFERENCE")
        normalized.setdefault("source_reference", "project fault-library review")
        try:
            items.append(FaultFeature.model_validate(normalized))
        except Exception as exc:
            raise HTTPException(
                status_code=503, detail="Reviewed fault library entry is invalid"
            ) from exc
    if len({item.fault_id for item in items}) != len(items):
        raise HTTPException(
            status_code=503, detail="Reviewed fault library has duplicate fault IDs"
        )
    return items


def finite_time_features(channels: list[dict[str, object]]) -> dict[str, float]:
    """Compute transparent time-domain statistics; no diagnosis is inferred here."""
    result: dict[str, float] = {}
    for channel in channels:
        name = str(channel["name"])
        values = [float(value) for value in channel["samples"]]  # type: ignore[index]
        if not values:
            continue
        average = mean(values)
        variance = pvariance(values) if len(values) > 1 else 0.0
        centered_fourth = mean((value - average) ** 4 for value in values)
        kurtosis = centered_fourth / (variance * variance) - 3.0 if variance > 0 else 0.0
        result[f"{name}.mean"] = average
        result[f"{name}.variance"] = variance
        result[f"{name}.rms"] = math.sqrt(mean(value * value for value in values))
        result[f"{name}.kurtosis_excess"] = kurtosis
    return result


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def persist_diagnosis(
    database: Database, request: DiagnosisAnalyzeRequest
) -> DiagnosisSample:
    diagnosis_id = str(uuid4())
    processing_run_id = request.processing_run_id or f"RUN-{uuid4()}"
    created_at = datetime.now(timezone.utc)
    payload = request.model_dump(mode="json")
    diagnosis = request.diagnosis
    with database.connect() as connection:
        existing_sample = connection.execute(
            """
            SELECT turbine_id, component_id, event_id, fault_id, data_origin
            FROM diagnosis_samples
            WHERE sample_id = ?
            ORDER BY created_at ASC LIMIT 1
            """,
            (request.sample_id,),
        ).fetchone()
        immutable_sample_fields = {
            "turbine_id": request.turbine_id,
            "component_id": request.component_id,
            "event_id": request.event_id,
            "fault_id": request.fault_id,
            "data_origin": request.data_origin.value,
        }
        if existing_sample and any(
            existing_sample[field] != expected
            for field, expected in immutable_sample_fields.items()
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "sample_id is already registered with different turbine, component, "
                    "event, fault, or data origin metadata"
                ),
            )
        connection.execute(
            """
            INSERT INTO diagnosis_samples (
                diagnosis_id, processing_run_id, sample_id, turbine_id, component_id, event_id, fault_id,
                data_origin, processing_status, payload_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                diagnosis_id,
                processing_run_id,
                request.sample_id,
                request.turbine_id,
                request.component_id,
                request.event_id,
                request.fault_id,
                request.data_origin.value,
                "INFERRED",
                json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                _iso(created_at),
            ),
        )
        connection.execute(
            """
            INSERT INTO ai_results (
                turbine_id, component_id, observed_at, health_index, anomaly_score,
                failure_risk, warning_level, model_version, data_origin,
                sample_id, diagnosis_id, event_id, fault_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                request.turbine_id,
                request.component_id,
                _iso(created_at),
                diagnosis.health_index,
                diagnosis.anomaly_score,
                diagnosis.failure_risk,
                diagnosis.warning_level.value,
                diagnosis.model_version,
                request.data_origin.value,
                request.sample_id,
                diagnosis_id,
                request.event_id,
                request.fault_id,
                _iso(created_at),
            ),
        )
        connection.commit()
    return DiagnosisSample(
        diagnosis_id=diagnosis_id,
        processing_run_id=processing_run_id,
        processing_status="INFERRED",
        created_at=created_at,
        **request.model_dump(exclude={"processing_run_id"}),
    )


def row_to_diagnosis(row: dict[str, object]) -> DiagnosisSample:
    payload = json.loads(str(row["payload_json"]))
    payload["diagnosis_id"] = row["diagnosis_id"]
    payload["processing_run_id"] = row["processing_run_id"]
    payload["processing_status"] = row["processing_status"]
    payload["created_at"] = row["created_at"]
    return DiagnosisSample.model_validate(payload)


def row_to_diagnosis_summary(row: dict[str, object]) -> DiagnosisSummary:
    sample = row_to_diagnosis(row)
    return DiagnosisSummary(
        diagnosis_id=sample.diagnosis_id,
        processing_run_id=sample.processing_run_id,
        sample_id=sample.sample_id,
        turbine_id=sample.turbine_id,
        component_id=sample.component_id,
        event_id=sample.event_id,
        fault_id=sample.fault_id,
        data_origin=sample.data_origin,
        processing_status=sample.processing_status,
        model_version=sample.diagnosis.model_version,
        predicted_class=sample.diagnosis.predicted_class,
        failure_risk=sample.diagnosis.failure_risk,
        warning_level=sample.diagnosis.warning_level,
        created_at=sample.created_at,
    )


def _ensure_ids_exist(database: Database, turbine_id: str, component_id: str) -> None:
    component = database.fetch_one(
        "SELECT turbine_id FROM components WHERE component_id = ?", (component_id,)
    )
    if not component or component["turbine_id"] != turbine_id:
        raise HTTPException(status_code=404, detail="Turbine/component mapping not found")


def create_diagnosis_router(database: Database) -> APIRouter:
    router = APIRouter()

    @router.get("/api/fault-library", response_model=FaultLibraryResponse)
    def fault_library(category: str | None = None) -> FaultLibraryResponse:
        all_items = load_fault_features()
        items = all_items
        if category:
            normalized = category.strip().upper()
            items = [item for item in items if item.category.upper() == normalized]
        return FaultLibraryResponse(
            schema_version="fault-library.v0.2",
            data_origin=DataOrigin.REFERENCE,
            categories=sorted({item.category for item in all_items}),
            items=items,
        )

    @router.get("/api/models/{model_version}", response_model=ModelMetadata)
    def model_metadata(model_version: str) -> ModelMetadata:
        metadata = MODEL_CATALOG.get(model_version)
        if metadata is None:
            raise HTTPException(status_code=404, detail="Model version not found")
        return ModelMetadata(model_version=model_version, **metadata)

    @router.post("/api/diagnosis/analyze", response_model=DiagnosisSample, status_code=201)
    def analyze_diagnosis(payload: DiagnosisAnalyzeRequest) -> DiagnosisSample:
        _ensure_ids_exist(database, payload.turbine_id, payload.component_id)
        fault_by_id = {item.fault_id: item for item in load_fault_features()}
        if payload.fault_id and payload.fault_id not in fault_by_id:
            raise HTTPException(
                status_code=422,
                detail="fault_id is not registered in the fault library",
            )
        predicted_class = payload.diagnosis.predicted_class
        unknown_classes = set(payload.diagnosis.class_probabilities) - {
            "NORMAL",
            *fault_by_id,
        }
        if unknown_classes:
            raise HTTPException(
                status_code=422,
                detail=(
                    "class_probabilities contains unregistered classes: "
                    + ", ".join(sorted(unknown_classes))
                ),
            )
        if predicted_class != "NORMAL" and predicted_class not in fault_by_id:
            raise HTTPException(
                status_code=422,
                detail="predicted_class is not registered in the fault library",
            )
        model = MODEL_CATALOG.get(payload.diagnosis.model_version)
        if model is None:
            raise HTTPException(status_code=422, detail="model_version is not registered")
        if model.get("status") == "NOT_IMPLEMENTED":
            raise HTTPException(
                status_code=422,
                detail="model_version is documented but not implemented",
            )
        allowed_origins = model.get("data_origins", [])
        if payload.data_origin not in allowed_origins:
            raise HTTPException(
                status_code=422,
                detail="data_origin is not registered for this model version",
            )
        if predicted_class != "NORMAL":
            fault_entry = fault_by_id[predicted_class]
            expected_component = fault_entry.affected_component_key
            supplied_component = payload.diagnosis.component_key
            allowed_components = {
                "UNMAPPED",
                *fault_entry.affected_component_candidates,
            }
            if expected_component:
                allowed_components.add(expected_component)
            if supplied_component not in allowed_components:
                raise HTTPException(
                    status_code=422,
                    detail="diagnosis component_key does not match the registered fault candidate",
                )
        risk = payload.diagnosis.failure_risk
        expected_warning = (
            WarningLevel.HIGH
            if risk >= 0.75
            else WarningLevel.MEDIUM
            if risk >= 0.45
            else WarningLevel.LOW
            if risk >= 0.2
            else WarningLevel.NORMAL
        )
        if payload.diagnosis.warning_level != expected_warning:
            raise HTTPException(
                status_code=422,
                detail=(
                    "warning_level is inconsistent with platform risk bands; "
                    f"expected {expected_warning.value}"
                ),
            )
        if payload.sampling_rate_hz and payload.spectral_peaks:
            nyquist = payload.sampling_rate_hz / 2
            if any(peak.frequency_hz > nyquist for peak in payload.spectral_peaks):
                raise HTTPException(
                    status_code=422,
                    detail="spectral peak exceeds the Nyquist frequency for sampling_rate_hz",
                )
        if payload.channels:
            payload.time_features.update(
                finite_time_features(
                    [channel.model_dump() for channel in payload.channels]
                )
            )
        return persist_diagnosis(database, payload)

    @router.post("/api/demo/simulate", response_model=DiagnosisSample, status_code=201)
    def simulate_diagnosis(payload: DemoSimulationRequest) -> DiagnosisSample:
        _ensure_ids_exist(database, payload.turbine_id, payload.component_id)
        fault = next(
            (
                item
                for item in load_fault_features()
                if item.fault_id == payload.fault_id
            ),
            None,
        )
        if fault is None:
            raise HTTPException(status_code=404, detail="Fault feature entry not found")
        aliases = {
            "rpm": "blade_rpm",
            "oil": "gearbox_oil_temperature_c",
            "oil_temperature": "gearbox_oil_temperature_c",
            "wind": "wind_speed_ms",
            "noise": "noise_db",
            "power": "output_power_kw",
        }
        submitted = {
            aliases.get(key, key): float(value)
            for key, value in payload.sensor_values.items()
        }
        unknown = sorted(set(submitted) - set(DEMO_SENSOR_SPECS))
        if unknown:
            raise HTTPException(
                status_code=422,
                detail=f"unsupported demo sensor fields: {', '.join(unknown)}",
            )
        sensor_values: dict[str, float] = {}
        for name, spec in DEMO_SENSOR_SPECS.items():
            value = submitted.get(name, float(spec["default"]))
            if value < float(spec["min"]) or value > float(spec["max"]):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"{name} must be between {spec['min']} and "
                        f"{spec['max']} {spec['unit']}"
                    ),
                )
            sensor_values[name] = value
        sensitivities = {
            "GEAR": {
                "gearbox_oil_temperature_c": 0.40,
                "noise_db": 0.35,
                "blade_rpm": 0.25,
            },
            "BEARING": {
                "gearbox_oil_temperature_c": 0.35,
                "noise_db": 0.40,
                "blade_rpm": 0.25,
            },
            "VIBRATION": {
                "noise_db": 0.35,
                "blade_rpm": 0.35,
                "wind_speed_ms": 0.30,
            },
            "MOTOR_ELECTRICAL": {
                "output_power_kw": 0.55,
                "wind_speed_ms": 0.20,
                "noise_db": 0.25,
            },
        }.get(fault.category, {"noise_db": 1.0})
        coupled_deviation = sum(
            weight * demo_range_deviation(name, sensor_values[name])
            for name, weight in sensitivities.items()
        )
        mode_severity = {
            "GEAR_TOOTH_BREAKAGE": 0.82,
            "GEAR_PITTING_SCORING": 0.66,
            "BEARING_RACEWAY_DAMAGE": 0.78,
            "BEARING_LUBRICATION_OR_MISALIGNMENT": 0.62,
            "BROADBAND_IMPACT": 0.70,
            "RESONANCE_OR_TOWER_VIBRATION": 0.64,
            "STATOR_WINDING_OR_PHASE_IMBALANCE": 0.75,
            "CONVERTER_OR_IGBT_THERMAL": 0.80,
        }.get(fault.fault_id, 0.60)
        risk = max(
            0.05,
            min(0.98, 0.18 + mode_severity * 0.55 + coupled_deviation * 0.32),
        )
        warning = (
            WarningLevel.HIGH
            if risk >= 0.75
            else WarningLevel.MEDIUM
            if risk >= 0.45
            else WarningLevel.LOW
            if risk >= 0.2
            else WarningLevel.NORMAL
        )
        sample_count = 256
        sampling_rate = 1000.0
        amplitude = 0.35 + risk
        vibration: list[float] = []
        current: list[float] = []
        peak_frequency = 12.0
        for index in range(sample_count):
            elapsed = index / sampling_rate
            base_current = math.sin(2 * math.pi * 50 * elapsed)
            if fault.category == "GEAR":
                vibration.append(
                    amplitude
                    * math.sin(2 * math.pi * 125 * elapsed)
                    * (1 + 0.28 * math.sin(2 * math.pi * 12.5 * elapsed))
                )
                current.append(
                    base_current
                    + 0.025 * risk * math.sin(2 * math.pi * 150 * elapsed)
                )
                peak_frequency = 125.0
            elif fault.category == "BEARING":
                phase = index % 40
                ring = math.exp(-phase / 8) * math.sin(
                    2 * math.pi * 180 * elapsed
                )
                vibration.append(
                    amplitude * ring
                    + 0.12 * math.sin(2 * math.pi * 12.5 * elapsed)
                )
                current.append(
                    base_current + 0.015 * math.sin(2 * math.pi * 150 * elapsed)
                )
                peak_frequency = 180.0
            elif fault.category == "MOTOR_ELECTRICAL":
                vibration.append(0.15 * math.sin(2 * math.pi * 25 * elapsed))
                current.append(
                    (1 + 0.18 * risk) * base_current
                    + 0.28 * risk * math.sin(2 * math.pi * 150 * elapsed)
                )
                peak_frequency = 150.0
            else:
                vibration.append(
                    amplitude * math.sin(2 * math.pi * 12 * elapsed)
                    + 0.22 * risk * math.sin(2 * math.pi * 24 * elapsed)
                )
                current.append(base_current)
                peak_frequency = 12.0
        confidence = min(0.96, 0.55 + risk * 0.40)
        class_probabilities = {fault.fault_id: confidence, "NORMAL": 1 - confidence}
        final_sample_id = payload.sample_id or f"SIM-{uuid4()}"
        simulated = DiagnosisAnalyzeRequest(
            schema_version="signal-analysis.v2",
            sample_id=final_sample_id,
            turbine_id=payload.turbine_id,
            component_id=payload.component_id,
            event_id=payload.event_id,
            event_name=fault.failure_form,
            fault_id=fault.fault_id,
            data_origin=DataOrigin.SIMULATED,
            sampling_rate_hz=sampling_rate,
            channels=[
                {
                    "name": "drive_train_vibration",
                    "unit": "g",
                    "samples": vibration,
                    "sample_count": sample_count,
                    "data_origin": "SIMULATED",
                    "source_reference": "rule-demo-v0.2.0",
                    "sensor_location": "nacelle_drivetrain",
                    "window_length": sample_count,
                    "overlap": 0.0,
                },
                {
                    "name": "generator_current",
                    "unit": "A",
                    "samples": current,
                    "sample_count": sample_count,
                    "data_origin": "SIMULATED",
                    "source_reference": "rule-demo-v0.2.0",
                    "sensor_location": "generator_output",
                    "window_length": sample_count,
                    "overlap": 0.0,
                },
            ],
            operating_condition={
                "sensor_values": sensor_values,
                "sensor_specs": DEMO_SENSOR_SPECS,
                "range_origin": "ASSUMED",
                "simulation": True,
            },
            preprocessing=[
                ProcessingStep(
                    name="demean",
                    method="remove_mean",
                    output_reference="preprocessed",
                ),
            ],
            spectral_peaks=[
                {
                    "channel": "drive_train_vibration"
                    if fault.category != "MOTOR_ELECTRICAL"
                    else "generator_current",
                    "frequency_hz": peak_frequency,
                    "amplitude": amplitude,
                    "source": "SIMULATED",
                }
            ],
            time_frequency_artifacts=[],
            embedding_2d=[],
            diagnosis=DiagnosisPayload(
                model_version="rule-demo-v0.2.0",
                class_probabilities=class_probabilities,
                predicted_class=fault.fault_id,
                uncertainty=round(1 - confidence, 6),
                component_key=fault.affected_component_key or "UNMAPPED",
                mapping_status="UNMAPPED",
                health_index=round(100 * (1 - risk), 3),
                anomaly_score=round(risk, 5),
                failure_risk=round(risk, 5),
                warning_level=warning,
                rationale=(
                    "故障类型专用规则与耦合参数生成的演示样本；"
                    "不是训练模型，风险与置信度均未校准。"
                ),
            ),
        )
        return analyze_diagnosis(simulated)

    @router.get("/api/diagnosis/history", response_model=DiagnosisHistoryResponse)
    def diagnosis_history(
        turbine_id: str | None = None,
        sample_id: str | None = None,
        limit: int = 50,
    ) -> DiagnosisHistoryResponse:
        limit = max(1, min(limit, 100))
        clauses: list[str] = []
        parameters: list[str | int] = []
        if turbine_id:
            clauses.append("turbine_id = ?")
            parameters.append(turbine_id)
        if sample_id:
            clauses.append("sample_id = ?")
            parameters.append(sample_id)
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        count_row = database.fetch_one(
            f"SELECT COUNT(*) AS total FROM diagnosis_samples{where}", parameters
        )
        rows = database.fetch_all(
            f"SELECT * FROM diagnosis_samples{where} ORDER BY created_at DESC LIMIT ?",
            [*parameters, limit],
        )
        return DiagnosisHistoryResponse(
            items=[row_to_diagnosis_summary(row) for row in rows],
            total=int(count_row["total"] if count_row else 0),
        )

    @router.get(
        "/api/diagnosis/sample/{sample_id}", response_model=list[DiagnosisSample]
    )
    def diagnosis_by_sample(sample_id: str) -> list[DiagnosisSample]:
        rows = database.fetch_all(
            "SELECT * FROM diagnosis_samples WHERE sample_id = ? ORDER BY created_at DESC",
            (sample_id,),
        )
        return [row_to_diagnosis(row) for row in rows]

    @router.get("/api/diagnosis/{diagnosis_id}", response_model=DiagnosisSample)
    def diagnosis_detail(diagnosis_id: str) -> DiagnosisSample:
        row = database.fetch_one(
            "SELECT * FROM diagnosis_samples WHERE diagnosis_id = ?", (diagnosis_id,)
        )
        if not row:
            raise HTTPException(status_code=404, detail="Diagnosis sample not found")
        return row_to_diagnosis(row)

    return router
