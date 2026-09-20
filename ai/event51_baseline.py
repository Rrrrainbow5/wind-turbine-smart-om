"""Reproducible robust-z baseline for CARE Wind Farm A Event 51."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd


MODEL_VERSION = "robust-z-v0.1.0"
TURBINE_ID = "WT02"
COMPONENT_ID = "WT02_COMPONENT_01"
FEATURES = (
    "sensor_11_avg",
    "sensor_12_avg",
    "sensor_18_avg",
    "sensor_52_avg",
    "power_29_avg",
    "wind_speed_3_avg",
)


@dataclass(frozen=True)
class BaselineResult:
    payload: dict[str, object]
    evaluation: dict[str, object]


def read_care_csv(path: Path) -> pd.DataFrame:
    return pd.read_csv(path, sep=";")


def clean_numeric(frame: pd.DataFrame, features: tuple[str, ...]) -> pd.DataFrame:
    missing = [feature for feature in features if feature not in frame.columns]
    if missing:
        raise ValueError(f"Missing required features: {', '.join(missing)}")
    numeric = frame.loc[:, features].apply(pd.to_numeric, errors="coerce")
    return numeric.replace([np.inf, -np.inf], np.nan)


def calculate_auc(labels: pd.Series, scores: pd.Series) -> float | None:
    labels = labels.astype(int).reset_index(drop=True)
    scores = scores.reset_index(drop=True)
    positive_count = int(labels.sum())
    negative_count = int((1 - labels).sum())
    if positive_count == 0 or negative_count == 0:
        return None
    ranks = scores.rank(method="average")
    positive_rank_sum = float(ranks.loc[labels == 1].sum())
    return (positive_rank_sum - positive_count * (positive_count + 1) / 2) / (
        positive_count * negative_count
    )


def warning_level(risk_score: float) -> str:
    if risk_score >= 0.75:
        return "HIGH"
    if risk_score >= 0.45:
        return "MEDIUM"
    if risk_score > 0:
        return "LOW"
    return "NORMAL"


def build_event51_result(
    farm_dir: Path,
    *,
    source_timezone: str = "UTC",
) -> BaselineResult:
    data = read_care_csv(farm_dir / "datasets" / "51.csv")
    events = read_care_csv(farm_dir / "event_info.csv")
    event_rows = events.loc[events["event_id"] == 51]
    if event_rows.empty:
        raise ValueError("Event 51 is missing from event_info.csv")
    event = event_rows.iloc[0]

    data = data.copy()
    data["time_stamp"] = pd.to_datetime(data["time_stamp"], errors="raise")
    data = data.sort_values("time_stamp").reset_index(drop=True)
    train = data.loc[data["train_test"] == "train"].copy()
    prediction = data.loc[data["train_test"] == "prediction"].copy()
    if len(train) < 10 or prediction.empty:
        raise ValueError("Event 51 requires chronological train and prediction rows")

    fit_end = int(len(train) * 0.60)
    validation_end = int(len(train) * 0.80)
    fit = train.iloc[:fit_end]
    validation = train.iloc[fit_end:validation_end]
    holdout = train.iloc[validation_end:]

    fit_values = clean_numeric(fit, FEATURES)
    medians = fit_values.median()
    fit_values = fit_values.fillna(medians)
    mad = (fit_values - medians).abs().median()
    scale = (1.4826 * mad).replace(0, np.nan)
    scale = scale.fillna(fit_values.std().replace(0, 1)).fillna(1)

    def score(frame: pd.DataFrame) -> pd.Series:
        values = clean_numeric(frame, FEATURES).fillna(medians)
        robust_z = ((values - medians).abs() / scale).fillna(0)
        return robust_z.max(axis=1)

    validation_score = score(validation)
    threshold = float(validation_score.quantile(0.99))
    if not np.isfinite(threshold) or threshold <= 0:
        raise ValueError("Validation threshold must be finite and positive")

    prediction_score = score(prediction)
    event_start = pd.Timestamp(event["event_start"])
    event_end = pd.Timestamp(event["event_end"])
    labels = prediction["time_stamp"].between(event_start, event_end).astype(int)
    predictions = (prediction_score >= threshold).astype(int)

    true_positive = int(((labels == 1) & (predictions == 1)).sum())
    false_positive = int(((labels == 0) & (predictions == 1)).sum())
    false_negative = int(((labels == 1) & (predictions == 0)).sum())
    precision = true_positive / (true_positive + false_positive) if true_positive + false_positive else 0.0
    recall = true_positive / (true_positive + false_negative) if true_positive + false_negative else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    auc = calculate_auc(labels, prediction_score)

    event_index = prediction["time_stamp"].sub(event_start).abs().idxmin()
    raw_score = float(prediction_score.loc[event_index])
    relative_risk = float(np.clip(raw_score / (2 * threshold), 0, 1))
    health_index = float(np.clip(100 * (1 - relative_risk), 0, 100))
    observed_at = prediction.loc[event_index, "time_stamp"].to_pydatetime().replace(
        tzinfo=ZoneInfo(source_timezone)
    )
    pre_event_alerts = prediction.loc[
        (prediction["time_stamp"] < event_start) & (prediction_score >= threshold),
        "time_stamp",
    ]

    payload = {
        "turbine_id": TURBINE_ID,
        "component_id": COMPONENT_ID,
        "timestamp": observed_at.isoformat(),
        "health_index": round(health_index, 4),
        "anomaly_score": round(relative_risk, 6),
        "failure_risk": round(relative_risk, 6),
        "warning_level": warning_level(relative_risk),
        "model_version": MODEL_VERSION,
        "data_origin": "DERIVED",
    }
    evaluation = {
        "dataset_version": "CARE to Compare Version 6",
        "wind_farm": "Wind Farm A",
        "event_id": 51,
        "asset_id": str(event["asset"]),
        "features": list(FEATURES),
        "split": {
            "method": "chronological 60/20/20 within train rows",
            "fit_rows": len(fit),
            "validation_rows": len(validation),
            "holdout_rows": len(holdout),
        },
        "missing_value_method": "fit-window median imputation",
        "outlier_method": "robust median/MAD scaling; no unverified physical clipping",
        "threshold": threshold,
        "risk_definition": "clip(robust_z / (2 * validation_p99), 0, 1); relative score, not calibrated probability",
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "roc_auc": auc,
        "first_pre_event_alert": None if pre_event_alerts.empty else pre_event_alerts.iloc[0].isoformat(),
        "source_timezone_note": (
            f"CARE timestamps are anonymized and timezone-naive; {source_timezone} is an explicit "
            "integration convention, not a claim about the original wind-farm timezone."
        ),
    }
    return BaselineResult(payload=payload, evaluation=evaluation)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the Event 51 DERIVED API payload.")
    parser.add_argument("farm_dir", type=Path, help="Path to CARE Wind Farm A")
    parser.add_argument("--output", type=Path, required=True, help="API payload JSON path")
    parser.add_argument("--metrics-output", type=Path, help="Optional evaluation JSON path")
    parser.add_argument("--source-timezone", default="UTC")
    args = parser.parse_args()

    result = build_event51_result(args.farm_dir, source_timezone=args.source_timezone)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result.payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.metrics_output:
        args.metrics_output.parent.mkdir(parents=True, exist_ok=True)
        args.metrics_output.write_text(
            json.dumps(result.evaluation, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print(json.dumps(result.payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
