from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field, model_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class DataOrigin(str, Enum):
    REAL = "REAL"
    DERIVED = "DERIVED"
    SIMULATED = "SIMULATED"
    ASSUMED = "ASSUMED"
    REFERENCE = "REFERENCE"


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


class AIResult(AIResultCreate):
    id: int
    created_at: datetime


class TurbineState(BaseModel):
    turbine_id: str
    component_id: str
    component_name: str
    mapping_status: str
    latest_ai_result: AIResult | None


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

    @model_validator(mode="after")
    def require_complete_manual_risk(self) -> "MaintenanceOptimizeRequest":
        if (self.failure_risk is None) != (self.warning_level is None):
            raise ValueError("failure_risk and warning_level must be provided together")
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
