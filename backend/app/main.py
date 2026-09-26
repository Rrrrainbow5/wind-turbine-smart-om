from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from backend.app.config import allowed_origins, database_path
from backend.app.database import Database
from backend.app.maintenance import decide_maintenance
from backend.app.schemas import (
    AIResult,
    AIResultCreate,
    DataOrigin,
    MaintenanceExecuteRequest,
    MaintenanceOptimizeRequest,
    MaintenancePlan,
    MaintenanceRecord,
    RetestCreate,
    RetestRecord,
    TurbineState, TelemetrySummary,
    WarningLevel,
)


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def create_app(db_path: Path | None = None) -> FastAPI:
    database = Database(db_path or database_path())

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        database.initialize()
        seed_database(database)
        yield

    app = FastAPI(
        title="WindCare Backend",
        version="0.1.0",
        description="风电装备智能运维项目的后端、状态接口与基础维护决策服务。",
        lifespan=lifespan,
    )
    app.state.database = database
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "windcare-backend", "version": app.version}

    @app.get("/api/turbines")
    def list_turbines() -> list[dict[str, object]]:
        return database.fetch_all(
            """
            SELECT t.*, COUNT(c.component_id) AS component_count
            FROM turbines t
            LEFT JOIN components c ON c.turbine_id = t.turbine_id
            GROUP BY t.turbine_id
            ORDER BY t.turbine_id
            """
        )

    @app.get("/api/turbines/{turbine_id}/state", response_model=list[TurbineState])
    def turbine_state(turbine_id: str) -> list[TurbineState]:
        turbine = database.fetch_one("SELECT turbine_id FROM turbines WHERE turbine_id = ?", (turbine_id,))
        if not turbine:
            raise HTTPException(status_code=404, detail="Turbine not found")
        components = database.fetch_all(
            "SELECT * FROM components WHERE turbine_id = ? ORDER BY component_id", (turbine_id,)
        )
        return [component_state(database, component) for component in components]

    @app.get("/api/turbines/{turbine_id}/telemetry", response_model=list[TelemetrySummary])
    def turbine_telemetry(turbine_id: str) -> list[TelemetrySummary]:
        """Return CARE telemetry mapping without fabricating values.

        Wind Farm B raw files are not bundled with the repository, so values
        remain null until a derived ingestion job writes an approved summary.
        """
        components = database.fetch_all(
            "SELECT component_id FROM components WHERE turbine_id = ? ORDER BY component_id",
            (turbine_id,),
        )
        return [TelemetrySummary(
            turbine_id=turbine_id,
            component_id=str(row["component_id"]),
            source_fields=["power_62", "power_58", "sensor_54", "sensor_55", "sensor_56", "sensor_52", "sensor_53"],
        ) for row in components]

    @app.get("/api/components/{component_id}/risk", response_model=AIResult)
    def component_risk(component_id: str) -> AIResult:
        component = database.fetch_one(
            "SELECT component_id FROM components WHERE component_id = ?", (component_id,)
        )
        if not component:
            raise HTTPException(status_code=404, detail="Component not found")
        latest = latest_ai_result(database, component_id)
        if not latest:
            raise HTTPException(status_code=404, detail="No AI result is available for this component")
        return AIResult.model_validate(latest)

    @app.post("/api/ai-results", response_model=AIResult, status_code=status.HTTP_201_CREATED)
    def create_ai_result(payload: AIResultCreate) -> AIResult:
        ensure_ids_exist(database, payload.turbine_id, payload.component_id)
        created_at = datetime.now(timezone.utc)
        result_id = database.execute(
            """
            INSERT INTO ai_results (
                turbine_id, component_id, observed_at, health_index, anomaly_score,
                failure_risk, warning_level, model_version, data_origin, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.turbine_id,
                payload.component_id,
                iso(payload.timestamp),
                payload.health_index,
                payload.anomaly_score,
                payload.failure_risk,
                payload.warning_level.value,
                payload.model_version,
                payload.data_origin.value,
                iso(created_at),
            ),
        )
        return AIResult(id=result_id, created_at=created_at, **payload.model_dump())

    def create_maintenance_plan(
        payload: MaintenanceOptimizeRequest, *, is_replan: bool
    ) -> MaintenancePlan:
        ensure_ids_exist(database, payload.turbine_id, payload.component_id)
        failure_risk, warning_level = resolve_risk(database, payload)
        action, priority, rationale, requires_replan, candidates = decide_maintenance(
            failure_risk=failure_risk,
            warning_level=warning_level,
            maintenance_window_available=payload.maintenance_window_available,
            personnel_available=payload.personnel_available,
        )
        parent_plan_id = payload.source_plan_id if is_replan else None
        replan_trigger = payload.replan_trigger if is_replan else None
        if is_replan and not replan_trigger:
            replan_trigger = "maintenance_conditions_changed"
        source_plan = None
        if parent_plan_id:
            source_plan = database.fetch_one(
                "SELECT plan_id, turbine_id, component_id FROM maintenance_plans WHERE plan_id = ?",
                (parent_plan_id,),
            )
            if not source_plan:
                raise HTTPException(status_code=404, detail="Source maintenance plan not found")
            if (
                source_plan["turbine_id"] != payload.turbine_id
                or source_plan["component_id"] != payload.component_id
            ):
                raise HTTPException(status_code=409, detail="Source plan does not match turbine/component")
        created_at = datetime.now(timezone.utc)
        plan = MaintenancePlan(
            plan_id=str(uuid4()),
            turbine_id=payload.turbine_id,
            component_id=payload.component_id,
            recommended_action=action,
            priority=priority,
            rationale=rationale,
            requires_replan=requires_replan,
            decision_origin=payload.decision_origin,
            conditions_origin=payload.conditions_origin,
            rule_version=payload.rule_version,
            input_failure_risk=failure_risk,
            input_warning_level=warning_level,
            maintenance_window_available=payload.maintenance_window_available,
            personnel_available=payload.personnel_available,
            parent_plan_id=parent_plan_id,
            replan_trigger=replan_trigger,
            confirmed_by=payload.confirmed_by,
            confirmed_at=payload.confirmed_at,
            candidates=candidates,
            created_at=created_at,
        )
        with database.connect() as connection:
            connection.execute(
                """
                INSERT INTO maintenance_plans (
                    plan_id, turbine_id, component_id, action, priority, status,
                    rationale, requires_replan, decision_origin, conditions_origin,
                    rule_version, input_failure_risk, input_warning_level,
                    maintenance_window_available, personnel_available, parent_plan_id,
                    replan_trigger, confirmed_by, confirmed_at, created_at
                ) VALUES (?, ?, ?, ?, ?, 'PROPOSED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    plan.plan_id,
                    plan.turbine_id,
                    plan.component_id,
                    plan.recommended_action.value,
                    plan.priority.value,
                    plan.rationale,
                    int(plan.requires_replan),
                    plan.decision_origin.value,
                    plan.conditions_origin.value,
                    plan.rule_version,
                    plan.input_failure_risk,
                    plan.input_warning_level.value,
                    int(plan.maintenance_window_available),
                    int(plan.personnel_available),
                    plan.parent_plan_id,
                    plan.replan_trigger,
                    plan.confirmed_by,
                    iso(plan.confirmed_at) if plan.confirmed_at else None,
                    iso(plan.created_at),
                ),
            )
            if source_plan:
                connection.execute(
                    "UPDATE maintenance_plans SET status = 'REPLANNED' WHERE plan_id = ?",
                    (source_plan["plan_id"],),
                )
            connection.commit()
        return plan

    @app.post("/api/maintenance/optimize", response_model=MaintenancePlan, status_code=201)
    def optimize_maintenance(payload: MaintenanceOptimizeRequest) -> MaintenancePlan:
        return create_maintenance_plan(payload, is_replan=False)

    @app.post("/api/maintenance/replan", response_model=MaintenancePlan, status_code=201)
    def replan_maintenance(payload: MaintenanceOptimizeRequest) -> MaintenancePlan:
        return create_maintenance_plan(payload, is_replan=True)

    @app.post("/api/maintenance/execute", response_model=MaintenanceRecord, status_code=201)
    def execute_maintenance(payload: MaintenanceExecuteRequest) -> MaintenanceRecord:
        plan = database.fetch_one("SELECT * FROM maintenance_plans WHERE plan_id = ?", (payload.plan_id,))
        if not plan:
            raise HTTPException(status_code=404, detail="Maintenance plan not found")
        created_at = datetime.now(timezone.utc)
        record = MaintenanceRecord(
            record_id=str(uuid4()),
            plan_id=payload.plan_id,
            executed_at=payload.executed_at,
            outcome=payload.outcome,
            data_origin=payload.data_origin,
            created_at=created_at,
        )
        with database.connect() as connection:
            connection.execute(
                """
                INSERT INTO maintenance_records (
                    record_id, plan_id, executed_at, outcome, data_origin, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    record.record_id,
                    record.plan_id,
                    iso(record.executed_at),
                    record.outcome,
                    record.data_origin.value,
                    iso(record.created_at),
                ),
            )
            connection.execute(
                "UPDATE maintenance_plans SET status = 'EXECUTED' WHERE plan_id = ?", (payload.plan_id,)
            )
            connection.commit()
        return record

    @app.get("/api/maintenance/history")
    def maintenance_history(turbine_id: str | None = None) -> list[dict[str, object]]:
        sql = """
            SELECT p.*, r.record_id, r.executed_at, r.outcome, r.data_origin AS execution_origin
            FROM maintenance_plans p
            LEFT JOIN maintenance_records r ON r.plan_id = p.plan_id
        """
        parameters: tuple[str, ...] = ()
        if turbine_id:
            sql += " WHERE p.turbine_id = ?"
            parameters = (turbine_id,)
        sql += " ORDER BY p.created_at DESC"
        return database.fetch_all(sql, parameters)

    @app.post("/api/retests", response_model=RetestRecord, status_code=201)
    def create_retest(payload: RetestCreate) -> RetestRecord:
        record = database.fetch_one(
            "SELECT record_id FROM maintenance_records WHERE record_id = ?", (payload.record_id,)
        )
        if not record:
            raise HTTPException(status_code=404, detail="Maintenance record not found")
        created_at = datetime.now(timezone.utc)
        retest = RetestRecord(retest_id=str(uuid4()), created_at=created_at, **payload.model_dump())
        database.execute(
            """
            INSERT INTO retest_records (
                retest_id, record_id, observed_at, health_index, failure_risk,
                conclusion, data_origin, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                retest.retest_id,
                retest.record_id,
                iso(retest.observed_at),
                retest.health_index,
                retest.failure_risk,
                retest.conclusion,
                retest.data_origin.value,
                iso(retest.created_at),
            ),
        )
        return retest

    @app.get(
        "/api/maintenance/records/{record_id}/retests",
        response_model=list[RetestRecord],
    )
    def list_retests(record_id: str) -> list[RetestRecord]:
        record = database.fetch_one(
            "SELECT record_id FROM maintenance_records WHERE record_id = ?", (record_id,)
        )
        if not record:
            raise HTTPException(status_code=404, detail="Maintenance record not found")
        rows = database.fetch_all(
            """
            SELECT retest_id, record_id, observed_at, health_index, failure_risk,
                   conclusion, data_origin, created_at
            FROM retest_records
            WHERE record_id = ?
            ORDER BY observed_at DESC, created_at DESC
            """,
            (record_id,),
        )
        return [RetestRecord.model_validate(row) for row in rows]

    return app


def seed_database(database: Database) -> None:
    now = iso(datetime.now(timezone.utc))
    database.execute(
        """
        INSERT OR IGNORE INTO turbines (
            turbine_id, display_name, wind_farm, operational_status, data_origin, created_at
        ) VALUES ('WT02', 'WT02', 'CARE_VALIDATION_SCENARIO', 'UNKNOWN', 'SIMULATED', ?)
        """,
        (now,),
    )
    database.execute(
        """
        INSERT OR IGNORE INTO components (
            component_id, turbine_id, display_name, mapping_status, data_origin, created_at
        ) VALUES (
            'WT02_COMPONENT_01', 'WT02', '待核验关键部件', 'UNVERIFIED', 'REFERENCE', ?
        )
        """,
        (now,),
    )


def ensure_ids_exist(database: Database, turbine_id: str, component_id: str) -> None:
    component = database.fetch_one(
        "SELECT turbine_id FROM components WHERE component_id = ?", (component_id,)
    )
    if not component or component["turbine_id"] != turbine_id:
        raise HTTPException(status_code=404, detail="Turbine/component mapping not found")


def latest_ai_result(database: Database, component_id: str) -> dict[str, object] | None:
    return database.fetch_one(
        """
        SELECT id, turbine_id, component_id, observed_at AS timestamp, health_index,
               anomaly_score, failure_risk, warning_level, model_version, data_origin, created_at
        FROM ai_results
        WHERE component_id = ?
        ORDER BY observed_at DESC, id DESC
        LIMIT 1
        """,
        (component_id,),
    )


def component_state(database: Database, component: dict[str, object]) -> TurbineState:
    latest = latest_ai_result(database, str(component["component_id"]))
    return TurbineState(
        turbine_id=str(component["turbine_id"]),
        component_id=str(component["component_id"]),
        component_name=str(component["display_name"]),
        mapping_status=str(component["mapping_status"]),
        latest_ai_result=AIResult.model_validate(latest) if latest else None,
    )


def resolve_risk(
    database: Database, payload: MaintenanceOptimizeRequest
) -> tuple[float, WarningLevel]:
    if payload.failure_risk is not None and payload.warning_level is not None:
        return payload.failure_risk, payload.warning_level
    latest = latest_ai_result(database, payload.component_id)
    if not latest:
        raise HTTPException(status_code=409, detail="No AI result is available for this component")
    return float(latest["failure_risk"]), WarningLevel(str(latest["warning_level"]))


app = create_app()
