from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

import math
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def require_finite_json(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("nested numeric values must be finite")
    if isinstance(value, dict):
        for item in value.values():
            require_finite_json(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            require_finite_json(item)
    return value


class DataOrigin(str, Enum):
    REAL = "REAL"
    DERIVED = "DERIVED"
    SIMULATED = "SIMULATED"
    ASSUMED = "ASSUMED"
    REFERENCE = "REFERENCE"
    USER_INPUT = "USER_INPUT"
    EXTERNAL_PUBLIC = "EXTERNAL_PUBLIC"


class WarningLevel(str, Enum):
    NORMAL = "NORMAL"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class MaintenanceAction(str, Enum):
    MONITOR = "CONTINUE_MONITORING"
    INSPECT = "SCHEDULE_INSPECTION"
    MAINTAIN = "SCHEDULE_MAINTENANCE"


class Priority(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class DiagnosisMappingStatus(str, Enum):
    UNMAPPED = "UNMAPPED"
    CANDIDATE = "CANDIDATE"


class AIResultCreate(BaseModel):
    turbine_id: str = Field(min_length=1, examples=["WT02"])
    component_id: str = Field(min_length=1, examples=["WT02_COMPONENT_01"])
    timestamp: datetime
    health_index: float = Field(ge=0, le=100)
    anomaly_score: float = Field(ge=0, le=1)
    failure_risk: float = Field(ge=0, le=1)
    warning_level: WarningLevel
    model_version: str = Field(min_length=1)
    data_origin: DataOrigin
    sample_id: str | None = Field(default=None, min_length=1)
    diagnosis_id: str | None = Field(default=None, min_length=1)
    event_id: str | None = Field(default=None, min_length=1)
    fault_id: str | None = Field(default=None, min_length=1)


class AIResult(AIResultCreate):
    id: int
    created_at: datetime


class TurbineState(BaseModel):
    turbine_id: str
    component_id: str
    component_name: str
    mapping_status: str
    latest_ai_result: AIResult | None


class TelemetrySummary(BaseModel):
    turbine_id: str
    component_id: str
    active_power_kw: float | None = None
    available_power_kw: float | None = None
    wind_speed_ms: float | None = None
    trend: list[dict[str, object]] = Field(default_factory=list)
    bearing_temperature_c: float | None = None
    timestamp: datetime | None = None
    data_origin: DataOrigin = DataOrigin.REFERENCE
    source_fields: list[str] = Field(default_factory=list)
    mapping_status: str | None = None
    source_file: str | None = None


class MaintenanceOptimizeRequest(BaseModel):
    turbine_id: str = Field(min_length=1)
    component_id: str = Field(min_length=1)
    failure_risk: float | None = Field(default=None, ge=0, le=1)
    warning_level: WarningLevel | None = None
    maintenance_window_available: bool = True
    personnel_available: bool = True
    decision_origin: DataOrigin = DataOrigin.SIMULATED
    conditions_origin: DataOrigin = DataOrigin.SIMULATED
    rule_version: str = Field(default="trial-v0.1", min_length=1)
    source_plan_id: str | None = Field(default=None, min_length=1)
    replan_trigger: str | None = Field(default=None, min_length=1)
    confirmed_by: str | None = Field(default=None, min_length=1)
    confirmed_at: datetime | None = None
    source_sample_id: str | None = Field(default=None, min_length=1)
    source_diagnosis_id: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def require_complete_manual_risk(self) -> "MaintenanceOptimizeRequest":
        if (self.failure_risk is None) != (self.warning_level is None):
            raise ValueError("failure_risk and warning_level must be provided together")
        if self.failure_risk is not None and (
            self.source_sample_id is not None or self.source_diagnosis_id is not None
        ):
            raise ValueError(
                "manual risk cannot claim a diagnosis/sample source; omit manual risk to use that source"
            )
        return self


class CandidateAction(BaseModel):
    action: MaintenanceAction
    available: bool
    explanation: str


class MaintenancePlan(BaseModel):
    plan_id: str
    turbine_id: str
    component_id: str
    recommended_action: MaintenanceAction
    priority: Priority
    rationale: str
    requires_replan: bool
    decision_origin: DataOrigin
    conditions_origin: DataOrigin
    rule_version: str
    input_failure_risk: float
    input_warning_level: WarningLevel
    maintenance_window_available: bool
    personnel_available: bool
    parent_plan_id: str | None = None
    replan_trigger: str | None = None
    confirmed_by: str | None = None
    confirmed_at: datetime | None = None
    source_sample_id: str | None = None
    source_diagnosis_id: str | None = None
    candidates: list[CandidateAction]
    created_at: datetime


class MaintenanceExecuteRequest(BaseModel):
    plan_id: str = Field(min_length=1)
    executed_at: datetime
    outcome: str = Field(min_length=1)
    data_origin: DataOrigin


class MaintenanceRecord(BaseModel):
    record_id: str
    plan_id: str
    executed_at: datetime
    outcome: str
    data_origin: DataOrigin
    created_at: datetime


class RetestCreate(BaseModel):
    record_id: str = Field(min_length=1)
    observed_at: datetime
    health_index: float = Field(ge=0, le=100)
    failure_risk: float = Field(ge=0, le=1)
    conclusion: str = Field(min_length=1)
    data_origin: DataOrigin


class RetestRecord(RetestCreate):
    retest_id: str
    created_at: datetime


class FrequencyFeature(BaseModel):
    name: str = Field(min_length=1)
    formula: str = Field(min_length=1)
    required_parameters: list[str] = Field(default_factory=list)
    conditions: list[str] = Field(default_factory=list)
    source_references: list[str] = Field(default_factory=list)


class FaultFeature(BaseModel):
    fault_id: str = Field(min_length=1)
    category: str = Field(min_length=1)
    failure_form: str = Field(min_length=1)
    mechanism: str = Field(min_length=1)
    typical_symptoms: list[str] = Field(default_factory=list)
    affected_signals: list[str] = Field(default_factory=list)
    affected_component_key: str | None = None
    affected_component_candidates: list[str] = Field(default_factory=list)
    mapping_caution: str | None = None
    frequency_formula: str | None = None
    required_parameters: list[str] = Field(default_factory=list)
    severity: float | None = Field(default=None, ge=0, le=1)
    source_type: DataOrigin = DataOrigin.REFERENCE
    source_reference: str = Field(min_length=1)
    frequency_features: list[FrequencyFeature] = Field(default_factory=list)


class FaultLibraryResponse(BaseModel):
    schema_version: str
    data_origin: DataOrigin
    categories: list[str]
    items: list[FaultFeature]


class SignalChannel(BaseModel):
    name: str = Field(min_length=1)
    unit: str = Field(default="", max_length=32)
    samples: list[float] = Field(default_factory=list, max_length=4096)
    artifact_uri: str | None = Field(default=None, min_length=1, max_length=1000)
    sha256: str | None = Field(default=None, pattern=r"^[0-9a-fA-F]{64}$")
    sample_count: int | None = Field(default=None, ge=1)
    data_origin: DataOrigin | None = None
    source_reference: str | None = Field(default=None, min_length=1, max_length=1000)
    sensor_location: str | None = Field(default=None, min_length=1, max_length=200)
    window_length: int | None = Field(default=None, ge=1)
    overlap: float | None = Field(default=None, ge=0, lt=1)

    @field_validator("samples")
    @classmethod
    def finite_samples(cls, values: list[float]) -> list[float]:
        if any(not math.isfinite(value) for value in values):
            raise ValueError("signal samples must be finite numbers")
        return values

    @model_validator(mode="after")
    def samples_or_artifact(self) -> "SignalChannel":
        if not self.samples and not self.artifact_uri:
            raise ValueError("channel requires samples or artifact_uri")
        if self.sample_count is not None and self.sample_count < len(self.samples):
            raise ValueError("sample_count cannot be smaller than the preview sample length")
        return self


class ProcessingStep(BaseModel):
    name: str = Field(min_length=1)
    method: str = Field(min_length=1)
    parameters: dict[str, Any] = Field(default_factory=dict)
    output_reference: str | None = None

    @field_validator("parameters")
    @classmethod
    def finite_parameters(cls, value: dict[str, Any]) -> dict[str, Any]:
        return require_finite_json(value)


class SpectralPeak(BaseModel):
    channel: str = Field(min_length=1)
    frequency_hz: float = Field(ge=0)
    amplitude: float = Field(ge=0)
    source: DataOrigin = DataOrigin.DERIVED


class EmbeddingPoint(BaseModel):
    sample_id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    x: float
    y: float
    source: DataOrigin = DataOrigin.DERIVED

    @model_validator(mode="after")
    def finite_coordinates(self) -> "EmbeddingPoint":
        if not math.isfinite(self.x) or not math.isfinite(self.y):
            raise ValueError("embedding coordinates must be finite numbers")
        return self


class EmbeddingMetadata(BaseModel):
    method: str = Field(min_length=1)
    feature_version: str = Field(min_length=1)
    random_seed: int | None = None
    parameters: dict[str, float | int | str | bool] = Field(default_factory=dict)

    @field_validator("parameters")
    @classmethod
    def finite_parameters(
        cls, value: dict[str, float | int | str | bool]
    ) -> dict[str, float | int | str | bool]:
        return require_finite_json(value)

    @model_validator(mode="after")
    def reproducible_embedding(self) -> "EmbeddingMetadata":
        if self.method.lower() in {"t-sne", "tsne"} and self.random_seed is None:
            raise ValueError("t-SNE metadata requires random_seed")
        return self


class ArtifactRef(BaseModel):
    kind: Literal["FFT", "STFT", "WAVELET_PACKET", "EMBEDDING", "OTHER"]
    uri: str = Field(min_length=1, max_length=1000)
    sha256: str | None = Field(default=None, pattern=r"^[0-9a-fA-F]{64}$")
    data_origin: DataOrigin
    shape: list[int] = Field(default_factory=list)
    axes: list[str] = Field(default_factory=list)
    parameters: dict[str, float | int | str | bool] = Field(default_factory=dict)

    @field_validator("parameters")
    @classmethod
    def finite_parameters(
        cls, value: dict[str, float | int | str | bool]
    ) -> dict[str, float | int | str | bool]:
        return require_finite_json(value)

    @model_validator(mode="after")
    def traceable_artifact(self) -> "ArtifactRef":
        if any(size <= 0 for size in self.shape):
            raise ValueError("artifact shape values must be positive")
        if self.data_origin in {DataOrigin.REAL, DataOrigin.EXTERNAL_PUBLIC} and not self.sha256:
            raise ValueError("REAL and EXTERNAL_PUBLIC artifacts require sha256")
        return self


class DiagnosisPayload(BaseModel):
    model_version: str = Field(min_length=1)
    class_probabilities: dict[str, float] = Field(min_length=1)
    predicted_class: str = Field(min_length=1)
    uncertainty: float = Field(ge=0, le=1)
    component_key: str = Field(min_length=1)
    mapping_status: DiagnosisMappingStatus = DiagnosisMappingStatus.UNMAPPED
    health_index: float = Field(ge=0, le=100)
    anomaly_score: float = Field(ge=0, le=1)
    failure_risk: float = Field(ge=0, le=1)
    warning_level: WarningLevel
    rationale: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def probabilities_are_valid(self) -> "DiagnosisPayload":
        if any(
            not math.isfinite(value) or value < 0 or value > 1
            for value in self.class_probabilities.values()
        ):
            raise ValueError("class probabilities must be finite values between 0 and 1")
        if abs(sum(self.class_probabilities.values()) - 1.0) > 1e-3:
            raise ValueError("class probabilities must sum to 1")
        if self.predicted_class not in self.class_probabilities:
            raise ValueError("predicted_class must be present in class_probabilities")
        return self


class DiagnosisAnalyzeRequest(BaseModel):
    schema_version: Literal["signal-analysis.v2"] = "signal-analysis.v2"
    sample_id: str = Field(min_length=1, max_length=200)
    processing_run_id: str | None = Field(default=None, min_length=1, max_length=200)
    turbine_id: str = Field(min_length=1)
    component_id: str = Field(min_length=1)
    event_id: str | None = Field(default=None, min_length=1)
    event_name: str | None = Field(default=None, min_length=1)
    fault_id: str | None = Field(default=None, min_length=1)
    data_origin: DataOrigin
    sampling_rate_hz: float | None = Field(default=None, gt=0)
    channels: list[SignalChannel] = Field(default_factory=list)
    operating_condition: dict[str, Any] = Field(default_factory=dict)
    preprocessing: list[ProcessingStep] = Field(default_factory=list)
    time_features: dict[str, float] = Field(default_factory=dict)
    spectral_peaks: list[SpectralPeak] = Field(default_factory=list)
    time_frequency_artifacts: list[ArtifactRef] = Field(default_factory=list)
    embedding_2d: list[EmbeddingPoint] = Field(default_factory=list)
    embedding_metadata: EmbeddingMetadata | None = None
    diagnosis: DiagnosisPayload

    @field_validator("operating_condition")
    @classmethod
    def finite_operating_condition(cls, value: dict[str, Any]) -> dict[str, Any]:
        return require_finite_json(value)

    @model_validator(mode="after")
    def signal_requirements(self) -> "DiagnosisAnalyzeRequest":
        if self.data_origin == DataOrigin.SIMULATED and not self.sample_id.startswith("SIM-"):
            raise ValueError("SIMULATED analysis must use a SIM- sample_id")
        if self.data_origin != DataOrigin.SIMULATED and self.sample_id.startswith("SIM-"):
            raise ValueError("SIM- sample_id is reserved for SIMULATED analysis")
        if self.channels and self.sampling_rate_hz is None:
            raise ValueError("sampling_rate_hz is required when channels are supplied")
        for channel in self.channels:
            if channel.data_origin is None:
                channel.data_origin = self.data_origin
            if channel.data_origin in {DataOrigin.REAL, DataOrigin.EXTERNAL_PUBLIC}:
                if not channel.source_reference:
                    raise ValueError(
                        "REAL and EXTERNAL_PUBLIC channels require source_reference"
                    )
                if channel.artifact_uri and not channel.sha256:
                    raise ValueError("referenced external artifacts require sha256")
        lengths = {len(channel.samples) for channel in self.channels if channel.samples}
        if len(lengths) > 1:
            raise ValueError("all signal channels must have the same sample length")
        if self.data_origin == DataOrigin.REAL and not self.channels:
            raise ValueError("REAL analysis requires at least one signal channel")
        if any(not math.isfinite(value) for value in self.time_features.values()):
            raise ValueError("time features must be finite numbers")
        if self.embedding_2d and self.embedding_metadata is None:
            raise ValueError("embedding_metadata is required when embedding_2d is supplied")
        return self


class DiagnosisSample(DiagnosisAnalyzeRequest):
    diagnosis_id: str
    processing_run_id: str
    processing_status: str
    created_at: datetime


class DemoSimulationRequest(BaseModel):
    turbine_id: str = Field(default="WT02", min_length=1)
    component_id: str = Field(default="WT02_COMPONENT_01", min_length=1)
    event_id: str | None = Field(default=None, min_length=1)
    fault_id: str = Field(min_length=1)
    sensor_values: dict[str, float] = Field(default_factory=dict)
    sample_id: str | None = Field(default=None, min_length=1)

    @field_validator("sensor_values")
    @classmethod
    def finite_sensor_values(cls, values: dict[str, float]) -> dict[str, float]:
        if any(not math.isfinite(value) for value in values.values()):
            raise ValueError("sensor values must be finite numbers")
        return values

    @field_validator("sample_id")
    @classmethod
    def simulated_sample_namespace(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith("SIM-"):
            raise ValueError("demo sample_id must use the SIM- namespace")
        return value


class DiagnosisSummary(BaseModel):
    diagnosis_id: str
    processing_run_id: str
    sample_id: str
    turbine_id: str
    component_id: str
    event_id: str | None = None
    fault_id: str | None = None
    data_origin: DataOrigin
    processing_status: str
    model_version: str
    predicted_class: str
    failure_risk: float
    warning_level: WarningLevel
    created_at: datetime


class DiagnosisHistoryResponse(BaseModel):
    items: list[DiagnosisSummary]
    total: int


class ModelMetadata(BaseModel):
    model_version: str
    model_family: str
    status: str
    data_origins: list[DataOrigin]
    methods: list[str]
    feature_groups: list[str]
    limitations: list[str]
    references: list[str]
    training_data_version: str | None = None
    validation_split: str | None = None
    validation_metrics: dict[str, float] = Field(default_factory=dict)
    calibration_status: str
    threshold_source: str
    input_schema: str
    code_or_model_hash: str | None = None
