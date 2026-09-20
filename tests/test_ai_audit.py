from __future__ import annotations

from pathlib import Path

import pandas as pd

from ai.audit_care import audit_case


def write_csv(frame: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(path, sep=";", index=False)


def test_audit_case_reads_semicolon_care_files(tmp_path: Path) -> None:
    farm = tmp_path / "Wind Farm A"
    write_csv(
        pd.DataFrame(
            [
                {
                    "asset": 21,
                    "event_id": 51,
                    "event_label": "anomaly",
                    "event_start": "2023-10-06 01:30:00",
                    "event_start_id": 2,
                    "event_end": "2023-10-06 01:40:00",
                    "event_end_id": 3,
                    "event_description": "Gearbox bearings damaged",
                }
            ]
        ),
        farm / "event_info.csv",
    )
    write_csv(
        pd.DataFrame(
            [
                {
                    "sensor_name": "sensor_11",
                    "statistics_type": "average",
                    "description": "temperature",
                    "unit": "C",
                    "is_angle": False,
                    "is_counter": False,
                }
            ]
        ),
        farm / "feature_description.csv",
    )
    write_csv(
        pd.DataFrame(
            [
                ["2023-10-06 01:10:00", 21, 0, "train", 1.0],
                ["2023-10-06 01:20:00", 21, 1, "prediction", 2.0],
            ],
            columns=["time_stamp", "asset_id", "id", "train_test", "sensor_11_avg"],
        ),
        farm / "datasets" / "51.csv",
    )

    result = audit_case(farm, 51)

    assert result["event_description"] == "Gearbox bearings damaged"
    assert result["asset_ids"] == ["21"]
    assert result["train_test_counts"] == {"train": 1, "prediction": 1}
    assert result["average_feature_count"] == 1


def test_audit_case_rejects_missing_prediction_rows(tmp_path: Path) -> None:
    farm = tmp_path / "Wind Farm A"
    write_csv(
        pd.DataFrame(
            [[21, 51, "anomaly", "2023-01-01", 0, "2023-01-02", 1, "event"]],
            columns=[
                "asset",
                "event_id",
                "event_label",
                "event_start",
                "event_start_id",
                "event_end",
                "event_end_id",
                "event_description",
            ],
        ),
        farm / "event_info.csv",
    )
    write_csv(
        pd.DataFrame([["sensor_11", "average"]], columns=["sensor_name", "statistics_type"]),
        farm / "feature_description.csv",
    )
    write_csv(
        pd.DataFrame(
            [["2023-01-01", 21, 0, "train"]],
            columns=["time_stamp", "asset_id", "id", "train_test"],
        ),
        farm / "datasets" / "51.csv",
    )

    try:
        audit_case(farm, 51)
    except ValueError as error:
        assert "no prediction rows" in str(error)
    else:
        raise AssertionError("audit_case should reject a dataset without prediction rows")
