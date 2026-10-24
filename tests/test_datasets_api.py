from fastapi.testclient import TestClient
from backend.app.main import create_app


def test_dataset_upload_and_evaluation(tmp_path):
    with TestClient(create_app(tmp_path / "test.db")) as client:
        report = client.get("/api/datasets/experiments")
        assert report.status_code == 200
        assert len(report.json()["predictions"]) == 115
        assert report.json()["live_inference"] is False
        payload = {"sample_id": "test", "sampling_rate_hz": 1000,
                   "data_origin": "EXTERNAL_PUBLIC", "source_reference": "test fixture",
                   "channels": [{"name": "vibration", "unit": "g", "samples": [0, 1, 0, -1] * 16}]}
        response = client.post("/api/datasets/analyze", json=payload)
        assert response.status_code == 200
        row = response.json()
        assert row["model_status"] == "NOT_INFERRED"
        assert row["channels"][0]["statistics"]["variance"] == .5
        assert len(row["channels"][0]["transforms"]["fft"]["frequency_hz"]) == 33
        assert len(row["source_sha256"]) == 64
        payload["channels"].append({"name": "current", "unit": "A", "samples": [1] * 16})
        assert client.post("/api/datasets/analyze", json=payload).status_code == 422
        assert client.post("/api/datasets/analyze", content=b'x' * (2 * 1024 * 1024 + 1)).status_code == 413
