"""Read-only audit for a CARE to Compare wind-farm directory."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd


def read_semicolon_csv(path: Path) -> pd.DataFrame:
    return pd.read_csv(path, sep=";")


def audit_case(farm_dir: Path, event_id: int) -> dict:
    event_info = read_semicolon_csv(farm_dir / "event_info.csv")
    feature_description = read_semicolon_csv(farm_dir / "feature_description.csv")
    event_row = event_info.loc[event_info["event_id"] == event_id]
    if event_row.empty:
        raise ValueError(f"event_id={event_id} was not found in {farm_dir}")

    data_path = farm_dir / "datasets" / f"{event_id}.csv"
    data = read_semicolon_csv(data_path)
    event = event_row.iloc[0]
    prediction = data.loc[data["train_test"] == "prediction"]

    return {
        "farm": farm_dir.name,
        "event_id": int(event_id),
        "event_label": str(event["event_label"]),
        "event_description": None if pd.isna(event["event_description"]) else str(event["event_description"]),
        "event_start": str(event["event_start"]),
        "event_end": str(event["event_end"]),
        "event_start_id": int(event["event_start_id"]),
        "event_end_id": int(event["event_end_id"]),
        "data_shape": {"rows": int(data.shape[0]), "columns": int(data.shape[1])},
        "asset_ids": [str(value) for value in data["asset_id"].dropna().unique()],
        "train_test_counts": {str(k): int(v) for k, v in data["train_test"].value_counts().items()},
        "prediction_range": {
            "start": str(prediction["time_stamp"].iloc[0]),
            "end": str(prediction["time_stamp"].iloc[-1]),
        },
        "missing_values": {
            str(k): int(v)
            for k, v in data.isna().sum().items()
            if int(v) > 0
        },
        "average_feature_count": int(
            feature_description["statistics_type"].str.contains("average", case=False, na=False).sum()
        ),
        "feature_description_rows": int(feature_description.shape[0]),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit one CARE to Compare event without changing source data.")
    parser.add_argument("farm_dir", type=Path, help="Path to a Wind Farm A/B/C directory")
    parser.add_argument("--event-id", type=int, default=51)
    parser.add_argument("--output", type=Path, default=Path("care_audit.json"))
    args = parser.parse_args()

    result = audit_case(args.farm_dir, args.event_id)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
