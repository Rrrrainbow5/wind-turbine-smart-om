from __future__ import annotations

from datetime import datetime, timezone
import json
import sqlite3

from fastapi.testclient import TestClient

from backend.app.main import create_app


def create_client(tmp_path) -> TestClient:
    return TestClient(create_app(tmp_path / "test.db"))


def ai_payload() -> dict[str, object]:
    return {
        "turbine_id": "WT02",
        "component_id": "WT02_COMPONENT_01",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "health_index": 63.2,
        "anomaly_score": 0.87,
        "failure_risk": 0.76,
        "warning_level": "HIGH",
        "model_version": "baseline-v0.1.0",
        "data_origin": "DERIVED",
    }


def test_health_and_seed_data(tmp_path) -> None:
    with create_client(tmp_path) as client:
        assert client.get("/health").json()["status"] == "ok"
        turbines = client.get("/api/turbines").json()
        assert turbines[0]["turbine_id"] == "WT02"
        assert turbines[0]["component_count"] == 1


def test_existing_v01_database_migrates_before_diagnosis_index_creation(tmp_path) -> None:
    database_path = tmp_path / "legacy.db"
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            """
            CREATE TABLE ai_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                turbine_id TEXT NOT NULL,
                component_id TEXT NOT NULL,
                observed_at TEXT NOT NULL,
                health_index REAL NOT NULL,
                anomaly_score REAL NOT NULL,
                failure_risk REAL NOT NULL,
                warning_level TEXT NOT NULL,
                model_version TEXT NOT NULL,
                data_origin TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
    with TestClient(create_app(database_path)) as client:
        assert client.get("/health").status_code == 200
    with sqlite3.connect(database_path) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(ai_results)")}
        assert {"sample_id", "diagnosis_id", "event_id", "fault_id"}.issubset(columns)
        indexes = {row[1] for row in connection.execute("PRAGMA index_list(ai_results)")}
        assert "idx_ai_results_diagnosis" in indexes


def test_ai_result_is_persisted_and_returned_as_state(tmp_path) -> None:
    with create_client(tmp_path) as client:
        created = client.post("/api/ai-results", json=ai_payload())
        assert created.status_code == 201

        state = client.get("/api/turbines/WT02/state")
        assert state.status_code == 200
        latest = state.json()[0]["latest_ai_result"]
        assert latest["failure_risk"] == 0.76
        assert latest["data_origin"] == "DERIVED"

        risk = client.get("/api/components/WT02_COMPONENT_01/risk")
        assert risk.status_code == 200
        assert risk.json()["model_version"] == "baseline-v0.1.0"


def test_high_risk_generates_maintenance_plan(tmp_path) -> None:
    with create_client(tmp_path) as client:
        client.post("/api/ai-results", json=ai_payload())
        response = client.post(
            "/api/maintenance/optimize",
            json={
                "turbine_id": "WT02",
                "component_id": "WT02_COMPONENT_01",
                "maintenance_window_available": True,
                "personnel_available": True,
                "decision_origin": "SIMULATED",
            },
        )
        assert response.status_code == 201
        plan = response.json()
        assert plan["recommended_action"] == "SCHEDULE_MAINTENANCE"
        assert plan["priority"] == "HIGH"
        assert plan["requires_replan"] is False
        assert len(plan["candidates"]) == 3


def test_unavailable_window_requires_replan(tmp_path) -> None:
    with create_client(tmp_path) as client:
        response = client.post(
            "/api/maintenance/replan",
            json={
                "turbine_id": "WT02",
                "component_id": "WT02_COMPONENT_01",
                "failure_risk": 0.9,
                "warning_level": "HIGH",
                "maintenance_window_available": False,
                "personnel_available": True,
                "decision_origin": "ASSUMED",
            },
        )
        assert response.status_code == 201
        assert response.json()["recommended_action"] == "SCHEDULE_INSPECTION"
        assert response.json()["requires_replan"] is True


def test_replan_preserves_source_plan_and_records_decision_inputs(tmp_path) -> None:
    with create_client(tmp_path) as client:
        client.post("/api/ai-results", json=ai_payload())
        original = client.post(
            "/api/maintenance/optimize",
            json={
                "turbine_id": "WT02",
                "component_id": "WT02_COMPONENT_01",
                "decision_origin": "SIMULATED",
                "conditions_origin": "ASSUMED",
                "rule_version": "trial-v0.1",
            },
        ).json()

        replanned = client.post(
            "/api/maintenance/replan",
            json={
                "turbine_id": "WT02",
                "component_id": "WT02_COMPONENT_01",
                "source_plan_id": original["plan_id"],
                "failure_risk": 0.91,
                "warning_level": "HIGH",
                "maintenance_window_available": False,
                "personnel_available": True,
                "decision_origin": "ASSUMED",
                "conditions_origin": "SIMULATED",
                "rule_version": "trial-v0.2",
                "replan_trigger": "weather_window_closed",
                "confirmed_by": "D",
                "confirmed_at": "2026-09-19T12:00:00+08:00",
            },
        )

        assert replanned.status_code == 201
        plan = replanned.json()
        assert plan["parent_plan_id"] == original["plan_id"]
        assert plan["replan_trigger"] == "weather_window_closed"
        assert plan["rule_version"] == "trial-v0.2"
        assert plan["input_failure_risk"] == 0.91
        assert plan["maintenance_window_available"] is False
        assert plan["conditions_origin"] == "SIMULATED"
        assert plan["confirmed_by"] == "D"

        history = client.get("/api/maintenance/history?turbine_id=WT02").json()
        original_row = next(row for row in history if row["plan_id"] == original["plan_id"])
        assert original_row["status"] == "REPLANNED"
        assert original_row["parent_plan_id"] is None


def test_execute_and_retest_flow(tmp_path) -> None:
    with create_client(tmp_path) as client:
        client.post("/api/ai-results", json=ai_payload())
        plan = client.post(
            "/api/maintenance/optimize",
            json={
                "turbine_id": "WT02",
                "component_id": "WT02_COMPONENT_01",
                "decision_origin": "SIMULATED",
            },
        ).json()
        executed_at = datetime.now(timezone.utc).isoformat()
        record_response = client.post(
            "/api/maintenance/execute",
            json={
                "plan_id": plan["plan_id"],
                "executed_at": executed_at,
                "outcome": "Simulation completed",
                "data_origin": "SIMULATED",
            },
        )
        assert record_response.status_code == 201
        record = record_response.json()

        retest = client.post(
            "/api/retests",
            json={
                "record_id": record["record_id"],
                "observed_at": executed_at,
                "health_index": 82.0,
                "failure_risk": 0.31,
                "conclusion": "Simulation indicates lower risk after maintenance",
                "data_origin": "SIMULATED",
            },
        )
        assert retest.status_code == 201
        assert retest.json()["failure_risk"] == 0.31

        retests = client.get(
            f"/api/maintenance/records/{record['record_id']}/retests"
        )
        assert retests.status_code == 200
        assert len(retests.json()) == 1
        assert retests.json()[0]["retest_id"] == retest.json()["retest_id"]
        assert retests.json()[0]["data_origin"] == "SIMULATED"

        history = client.get("/api/maintenance/history?turbine_id=WT02").json()
        assert history[0]["status"] == "EXECUTED"
        assert history[0]["record_id"] == record["record_id"]


def test_retest_query_rejects_unknown_maintenance_record(tmp_path) -> None:
    with create_client(tmp_path) as client:
        response = client.get("/api/maintenance/records/missing-record/retests")
        assert response.status_code == 404


def diagnosis_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "sample_id": "USER-20261015-0001",
        "processing_run_id": "B-RUN-20261015-0001",
        "turbine_id": "WT02",
        "component_id": "WT02_COMPONENT_01",
        "event_id": "51",
        "event_name": "Gearbox bearings damaged",
        "fault_id": "BEARING_RACEWAY_DAMAGE",
        "data_origin": "USER_INPUT",
        "sampling_rate_hz": 1000,
        "channels": [
            {"name": "drive_train_vibration", "unit": "g", "samples": [0.1, 0.2, 0.3, 0.2]},
            {"name": "generator_current", "unit": "A", "samples": [1.0, 1.1, 1.0, 0.9]},
        ],
        "preprocessing": [{"name": "demean", "method": "remove_mean"}],
        "diagnosis": {
            "model_version": "rule-demo-v0.2.0",
            "class_probabilities": {"BEARING_RACEWAY_DAMAGE": 0.8, "NORMAL": 0.2},
            "predicted_class": "BEARING_RACEWAY_DAMAGE",
            "uncertainty": 0.2,
            "component_key": "bearing",
            "mapping_status": "UNMAPPED",
            "health_index": 65,
            "anomaly_score": 0.7,
            "failure_risk": 0.7,
            "warning_level": "MEDIUM",
            "rationale": "test payload",
        },
    }
    payload.update(overrides)
    return payload


def test_fault_library_exposes_four_categories(tmp_path) -> None:
    with create_client(tmp_path) as client:
        response = client.get("/api/fault-library")
        assert response.status_code == 200
        body = response.json()
        assert {"GEAR", "BEARING", "VIBRATION", "MOTOR_ELECTRICAL"}.issubset(
            set(body["categories"])
        )
        assert len(body["items"]) >= 4
        assert body["data_origin"] == "REFERENCE"
        bearing = next(item for item in body["items"] if item["fault_id"] == "BEARING_RACEWAY_DAMAGE")
        assert len(bearing["frequency_features"]) >= 4
        assert bearing["affected_component_key"] == "bearing"
        assert {"gearbox_bearing", "rotor_bearing", "generator_bearing"}.issubset(
            set(bearing["affected_component_candidates"])
        )


def test_analysis_rejects_missing_sampling_rate_and_mismatched_channels(tmp_path) -> None:
    with create_client(tmp_path) as client:
        missing_rate = diagnosis_payload(sampling_rate_hz=None)
        assert client.post("/api/diagnosis/analyze", json=missing_rate).status_code == 422
        mismatched = diagnosis_payload(
            channels=[
                {"name": "a", "unit": "g", "samples": [1, 2]},
                {"name": "b", "unit": "A", "samples": [1]},
            ]
        )
        assert client.post("/api/diagnosis/analyze", json=mismatched).status_code == 422

        above_nyquist = diagnosis_payload(
            spectral_peaks=[
                {"channel": "drive_train_vibration", "frequency_hz": 600, "amplitude": 1}
            ]
        )
        assert client.post("/api/diagnosis/analyze", json=above_nyquist).status_code == 422


def test_analysis_rejects_non_finite_samples_and_invalid_probabilities(tmp_path) -> None:
    with create_client(tmp_path) as client:
        non_finite = diagnosis_payload(
            channels=[{"name": "a", "unit": "g", "samples": [1, "NaN"]}]
        )
        assert client.post("/api/diagnosis/analyze", json=non_finite).status_code == 422
        invalid_probability = diagnosis_payload(
            diagnosis={
                **diagnosis_payload()["diagnosis"],  # type: ignore[arg-type]
                "class_probabilities": {"BEARING_RACEWAY_DAMAGE": 0.9, "NORMAL": 0.2},
            }
        )
        assert client.post("/api/diagnosis/analyze", json=invalid_probability).status_code == 422

        untraceable_real = diagnosis_payload(
            data_origin="REAL",
            channels=[{"name": "a", "unit": "g", "samples": [1, 2]}],
        )
        assert client.post("/api/diagnosis/analyze", json=untraceable_real).status_code == 422

        invalid_artifact = diagnosis_payload(
            time_frequency_artifacts=[
                {
                    "kind": "STFT",
                    "uri": "simulated://test/stft",
                    "data_origin": "SIMULATED",
                    "shape": [4, 4],
                    "parameters": {"window": float("nan")},
                }
            ]
        )
        assert client.post(
            "/api/diagnosis/analyze",
            content=json.dumps(invalid_artifact),
            headers={"content-type": "application/json"},
        ).status_code == 422

        untraceable_real_channel = diagnosis_payload(
            channels=[
                {
                    "name": "drive_train_vibration",
                    "unit": "g",
                    "samples": [0.1, 0.2],
                    "data_origin": "REAL",
                }
            ]
        )
        assert (
            client.post("/api/diagnosis/analyze", json=untraceable_real_channel).status_code
            == 422
        )


def test_analysis_is_traceable_by_sample_and_updates_latest_ai_result(tmp_path) -> None:
    with create_client(tmp_path) as client:
        response = client.post("/api/diagnosis/analyze", json=diagnosis_payload())
        assert response.status_code == 201
        body = response.json()
        assert body["processing_status"] == "INFERRED"
        assert body["processing_run_id"] == "B-RUN-20261015-0001"
        assert body["data_origin"] == "USER_INPUT"
        assert body["time_features"]["drive_train_vibration.mean"] == 0.2
        assert "drive_train_vibration.kurtosis_excess" in body["time_features"]
        diagnosis_id = body["diagnosis_id"]
        assert client.get(f"/api/diagnosis/{diagnosis_id}").status_code == 200
        by_sample = client.get("/api/diagnosis/sample/USER-20261015-0001").json()
        assert by_sample[0]["diagnosis_id"] == diagnosis_id
        assert client.get("/api/diagnosis/history?turbine_id=WT02").json()["total"] == 1
        summary = client.get("/api/diagnosis/history?turbine_id=WT02").json()["items"][0]
        assert "channels" not in summary
        assert summary["sample_id"] == "USER-20261015-0001"
        risk = client.get("/api/components/WT02_COMPONENT_01/risk").json()
        assert risk["sample_id"] == "USER-20261015-0001"
        assert risk["diagnosis_id"] == diagnosis_id
        plan = client.post(
            "/api/maintenance/optimize",
            json={
                "turbine_id": "WT02",
                "component_id": "WT02_COMPONENT_01",
                "source_diagnosis_id": diagnosis_id,
                "decision_origin": "SIMULATED",
            },
        )
        assert plan.status_code == 201
        assert plan.json()["source_sample_id"] == "USER-20261015-0001"
        assert plan.json()["source_diagnosis_id"] == diagnosis_id


def test_sample_id_can_be_reprocessed_but_cannot_change_source_metadata(tmp_path) -> None:
    with create_client(tmp_path) as client:
        first = client.post("/api/diagnosis/analyze", json=diagnosis_payload())
        assert first.status_code == 201

        repeated = client.post(
            "/api/diagnosis/analyze",
            json=diagnosis_payload(processing_run_id="B-RUN-20261015-0002"),
        )
        assert repeated.status_code == 201
        assert repeated.json()["diagnosis_id"] != first.json()["diagnosis_id"]

        changed_event = client.post(
            "/api/diagnosis/analyze",
            json=diagnosis_payload(
                processing_run_id="B-RUN-20261015-0003",
                event_id="DIFFERENT-EVENT",
            ),
        )
        assert changed_event.status_code == 409


def test_demo_simulation_is_explicitly_simulated_and_model_is_documented(tmp_path) -> None:
    with create_client(tmp_path) as client:
        response = client.post(
            "/api/demo/simulate",
            json={"fault_id": "GEAR_TOOTH_BREAKAGE", "sensor_values": {"oil_temperature": 72}},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["data_origin"] == "SIMULATED"
        assert body["diagnosis"]["model_version"] == "rule-demo-v0.2.0"
        assert body["processing_status"] == "INFERRED"
        model = client.get("/api/models/rule-demo-v0.2.0")
        assert model.status_code == 200
        assert "limitations" in model.json()
        assert model.json()["status"] == "DEMO_ONLY"


def test_analysis_rejects_unknown_contract_values_and_unverified_claims(tmp_path) -> None:
    with create_client(tmp_path) as client:
        unknown_fault = diagnosis_payload(fault_id="NOT_IN_LIBRARY")
        assert client.post("/api/diagnosis/analyze", json=unknown_fault).status_code == 422

        unknown_model = diagnosis_payload(
            diagnosis={
                **diagnosis_payload()["diagnosis"],  # type: ignore[arg-type]
                "model_version": "unregistered-model",
            }
        )
        assert client.post("/api/diagnosis/analyze", json=unknown_model).status_code == 422

        unknown_probability_class = diagnosis_payload(
            diagnosis={
                **diagnosis_payload()["diagnosis"],  # type: ignore[arg-type]
                "class_probabilities": {"BEARING_RACEWAY_DAMAGE": 0.8, "INVENTED": 0.2},
            }
        )
        assert (
            client.post("/api/diagnosis/analyze", json=unknown_probability_class).status_code
            == 422
        )

        verified_mapping = diagnosis_payload(
            diagnosis={
                **diagnosis_payload()["diagnosis"],  # type: ignore[arg-type]
                "mapping_status": "VERIFIED",
            }
        )
        assert client.post("/api/diagnosis/analyze", json=verified_mapping).status_code == 422

        bad_schema = diagnosis_payload(schema_version="anything")
        assert client.post("/api/diagnosis/analyze", json=bad_schema).status_code == 422


def test_analysis_accepts_registered_candidate_component_without_verifying_mapping(
    tmp_path,
) -> None:
    with create_client(tmp_path) as client:
        payload = diagnosis_payload(
            diagnosis={
                **diagnosis_payload()["diagnosis"],  # type: ignore[arg-type]
                "component_key": "gearbox_bearing",
                "mapping_status": "CANDIDATE",
            }
        )
        response = client.post("/api/diagnosis/analyze", json=payload)
        assert response.status_code == 201
        assert response.json()["diagnosis"]["component_key"] == "gearbox_bearing"
        assert response.json()["diagnosis"]["mapping_status"] == "CANDIDATE"


def test_demo_profiles_are_fault_specific_and_do_not_claim_hybrid_ai(tmp_path) -> None:
    with create_client(tmp_path) as client:
        gear = client.post(
            "/api/demo/simulate",
            json={"fault_id": "GEAR_TOOTH_BREAKAGE", "sample_id": "SIM-GEAR-1"},
        )
        electrical = client.post(
            "/api/demo/simulate",
            json={"fault_id": "STATOR_WINDING_OR_PHASE_IMBALANCE", "sample_id": "SIM-ELEC-1"},
        )
        assert gear.status_code == electrical.status_code == 201
        assert gear.json()["sample_id"] == "SIM-GEAR-1"
        assert gear.json()["spectral_peaks"][0]["frequency_hz"] == 125.0
        assert electrical.json()["spectral_peaks"][0]["channel"] == "generator_current"
        assert gear.json()["channels"][0]["samples"] != electrical.json()["channels"][0]["samples"]
        assert gear.json()["time_frequency_artifacts"] == []
        assert gear.json()["embedding_2d"] == []


def test_legacy_ai_result_cannot_forge_diagnosis_and_manual_risk_cannot_claim_source(tmp_path) -> None:
    with create_client(tmp_path) as client:
        forged = ai_payload()
        forged["diagnosis_id"] = "made-up-diagnosis"
        assert client.post("/api/ai-results", json=forged).status_code == 409

        forged_sample = ai_payload()
        forged_sample["sample_id"] = "NO-SUCH-DIAGNOSIS-SAMPLE"
        assert client.post("/api/ai-results", json=forged_sample).status_code == 409

        now = datetime.now(timezone.utc).isoformat()
        client.app.state.database.execute(
            """
            INSERT INTO ai_results (
                turbine_id, component_id, observed_at, health_index, anomaly_score,
                failure_risk, warning_level, model_version, data_origin,
                sample_id, diagnosis_id, event_id, fault_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "WT02",
                "WT02_COMPONENT_01",
                now,
                1,
                0.99,
                0.99,
                "HIGH",
                "legacy-unverified",
                "REAL",
                "ORPHAN-SAMPLE",
                None,
                None,
                None,
                now,
            ),
        )
        orphan_source = client.post(
            "/api/maintenance/optimize",
            json={
                "turbine_id": "WT02",
                "component_id": "WT02_COMPONENT_01",
                "source_sample_id": "ORPHAN-SAMPLE",
            },
        )
        assert orphan_source.status_code == 404

        analysis = client.post("/api/diagnosis/analyze", json=diagnosis_payload()).json()
        response = client.post(
            "/api/maintenance/optimize",
            json={
                "turbine_id": "WT02",
                "component_id": "WT02_COMPONENT_01",
                "source_diagnosis_id": analysis["diagnosis_id"],
                "failure_risk": 0.9,
                "warning_level": "HIGH",
            },
        )
        assert response.status_code == 422
