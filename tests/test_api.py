from __future__ import annotations

from datetime import datetime, timezone

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

        history = client.get("/api/maintenance/history?turbine_id=WT02").json()
        assert history[0]["status"] == "EXECUTED"
        assert history[0]["record_id"] == record["record_id"]
