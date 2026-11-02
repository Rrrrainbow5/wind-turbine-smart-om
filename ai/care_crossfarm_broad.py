"""Cross-farm CARE SCADA benchmark using shared semantic channels.

This experiment deliberately predicts broad, supportable classes instead of
claiming that different bearing locations or transformer symptoms are the same
fine-grained failure.  It uses six-hour windows of ten-minute CARE aggregates
and evaluates with leave-one-physical-asset-out groups prefixed by wind farm.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

RANDOM_STATE = 20261102
WINDOW_ROWS = 36
MODEL_VERSION = "care-ab-semantic-broad-v1"

FARMS = {
    "A": {
        "asset_column": "asset",
        "channels": {
            "ambient_temperature": ["sensor_0_avg"],
            "wind_speed": ["wind_speed_3_avg"],
            "active_power": ["power_30_avg"],
            "rotor_speed": ["sensor_52_avg"],
            "generator_speed": ["sensor_18_avg"],
            "gearbox_oil_temperature": ["sensor_12_avg"],
            "bearing_temperature": ["sensor_11_avg", "sensor_13_avg", "sensor_14_avg"],
            "transformer_temperature": ["sensor_38_avg", "sensor_39_avg", "sensor_40_avg"],
        },
    },
    "B": {
        "asset_column": "asset_id",
        "channels": {
            "ambient_temperature": ["sensor_8_avg"],
            "wind_speed": ["wind_speed_61_avg"],
            "active_power": ["power_62_avg"],
            "rotor_speed": ["sensor_25_avg"],
            "generator_speed": ["sensor_19_avg"],
            "gearbox_oil_temperature": ["sensor_38_avg", "sensor_39_avg"],
            "bearing_temperature": [
                "sensor_32_avg", "sensor_33_avg", "sensor_34_avg", "sensor_35_avg",
                "sensor_36_avg", "sensor_37_avg", "sensor_51_avg", "sensor_52_avg",
            ],
            "transformer_temperature": [
                "sensor_41_avg", "sensor_42_avg", "sensor_43_avg", "sensor_44_avg",
                "sensor_45_avg", "sensor_46_avg", "sensor_47_avg",
            ],
        },
    },
}

SEMANTIC_CHANNELS = [
    "ambient_temperature", "wind_speed", "active_power", "rotor_speed",
    "generator_speed", "gearbox_oil_temperature", "bearing_temperature",
    "transformer_temperature", "gearbox_temperature_rise",
    "bearing_temperature_rise", "transformer_temperature_rise",
]
STATS = ("median", "std", "delta", "iqr", "mad", "slope", "missing_rate")
FEATURE_NAMES = [f"{channel}__{stat}" for stat in STATS for channel in SEMANTIC_CHANNELS]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def broad_label(farm: str, description: str) -> str | None:
    text = description.strip().lower()
    if not text:
        return "healthy"
    if farm == "A":
        if text in {"generator bearing failure", "gearbox bearings damaged"}:
            return "bearing_anomaly"
        if text == "transformer failure":
            return "transformer_thermal"
        return None
    if "bearing" in text:
        return "bearing_anomaly"
    if "high temperature in transformer cell" in text:
        return "transformer_thermal"
    return None


def semantic_values(frame, mapping):
    import numpy as np

    result = {}
    for name, columns in mapping.items():
        values = frame[columns].to_numpy(dtype=float)
        values[~np.isfinite(values)] = np.nan
        with np.errstate(all="ignore"):
            result[name] = np.nanmedian(values, axis=1)
    ambient = result["ambient_temperature"]
    result["gearbox_temperature_rise"] = result["gearbox_oil_temperature"] - ambient
    result["bearing_temperature_rise"] = result["bearing_temperature"] - ambient
    result["transformer_temperature_rise"] = result["transformer_temperature"] - ambient
    return np.column_stack([result[name] for name in SEMANTIC_CHANNELS])


def window_features(values):
    import numpy as np

    values = np.asarray(values, dtype=float)
    values[~np.isfinite(values)] = np.nan
    position = np.arange(values.shape[0], dtype=float)
    with np.errstate(all="ignore"):
        median = np.nanmedian(values, axis=0)
        std = np.nanstd(values, axis=0)
        delta = values[-1] - values[0]
        q25, q75 = np.nanpercentile(values, [25, 75], axis=0)
        mad = np.nanmedian(np.abs(values - median), axis=0)
        missing = np.isnan(values).mean(axis=0)
        slopes = []
        for column in values.T:
            valid = np.isfinite(column)
            slopes.append(np.polyfit(position[valid], column[valid], 1)[0] if valid.sum() >= 2 else np.nan)
        vector = np.concatenate([median, std, delta, q75 - q25, mad, slopes, missing])
    return [float(value) if np.isfinite(value) else None for value in vector]


def build_windows(farm_paths: dict[str, Path]):
    import numpy as np
    import pandas as pd

    rows, sources = [], []
    rejected = {"unsupported_events": 0, "overlap_rows": 0, "incomplete_windows": 0}
    for farm, root in farm_paths.items():
        config = FARMS[farm]
        events = pd.read_csv(root / "event_info.csv", sep=";").fillna("")
        events["start"] = pd.to_datetime(events.event_start)
        events["end"] = pd.to_datetime(events.event_end)
        events["broad_label"] = [broad_label(farm, value) for value in events.event_description]
        rejected["unsupported_events"] += int(events.broad_label.isna().sum())
        selected = events.loc[events.broad_label.notna()].copy()
        raw_columns = sorted({column for columns in config["channels"].values() for column in columns})
        baseline_chunks = {}
        for _, event in selected.sort_values("event_id").iterrows():
            path = root / "datasets" / f"{int(event.event_id)}.csv"
            baseline_frame = pd.read_csv(path, sep=";", usecols=["train_test", *raw_columns])
            baseline_frame = baseline_frame.loc[baseline_frame.train_test.eq("train")]
            if baseline_frame.empty:
                continue
            step = max(1, len(baseline_frame) // 10000)
            asset = int(event[config["asset_column"]])
            baseline_chunks.setdefault(asset, []).append(
                semantic_values(baseline_frame.iloc[::step], config["channels"])
            )
        asset_baselines = {}
        for asset, chunks in baseline_chunks.items():
            reference = np.concatenate(chunks, axis=0)
            with np.errstate(all="ignore"):
                center = np.nanmedian(reference, axis=0)
                q25, q75 = np.nanpercentile(reference, [25, 75], axis=0)
            scale = q75 - q25
            scale[~np.isfinite(scale) | (np.abs(scale) < 1e-9)] = 1.0
            asset_baselines[asset] = (center, scale)
        for _, event in selected.sort_values("event_id").iterrows():
            path = root / "datasets" / f"{int(event.event_id)}.csv"
            frame = pd.read_csv(path, sep=";", usecols=["time_stamp", "train_test", *raw_columns])
            frame["time_stamp"] = pd.to_datetime(frame.time_stamp)
            frame = frame.loc[
                frame.time_stamp.between(event.start, event.end)
                & frame.train_test.ne("train")
            ].sort_values("time_stamp").drop_duplicates("time_stamp")
            asset = int(event[config["asset_column"]])
            conflicts = selected.loc[
                (selected[config["asset_column"]].astype(int) == asset)
                & (selected.event_id.astype(int) != int(event.event_id))
                & (selected.broad_label != event.broad_label)
            ]
            for _, other in conflicts.iterrows():
                overlap = frame.time_stamp.between(other.start, other.end)
                rejected["overlap_rows"] += int(overlap.sum())
                frame = frame.loc[~overlap]
            for start, block in frame.groupby(frame.time_stamp.dt.floor("6h")):
                expected = pd.date_range(start, periods=WINDOW_ROWS, freq="10min")
                if len(block) != WINDOW_ROWS or not np.array_equal(block.time_stamp.to_numpy(), expected.to_numpy()):
                    rejected["incomplete_windows"] += 1
                    continue
                semantic = semantic_values(block, config["channels"])
                center, scale = asset_baselines[asset]
                adapted = (semantic - center) / scale
                rows.append({
                    "sample_id": f"CARE-{farm}-{int(event.event_id)}-{start.strftime('%Y%m%dT%H%M')}",
                    "farm": farm,
                    "asset": asset,
                    "group": f"{farm}-{asset}",
                    "event_id": int(event.event_id),
                    "label": event.broad_label,
                    "description": event.event_description or "Normal operation",
                    "start": str(start),
                    "end": str(block.time_stamp.iloc[-1]),
                    "features": window_features(semantic),
                    "asset_adapted_features": window_features(adapted),
                })
            sources.append({
                "farm": farm, "event_id": int(event.event_id), "asset": asset,
                "label": event.broad_label, "file": path.name, "sha256": sha256(path),
            })
            print(f"{farm} event {int(event.event_id)} {event.broad_label}: windows={len(rows)}", flush=True)
    unique = {(row["group"], row["start"]): row for row in rows}
    return list(unique.values()), sources, rejected


def sample_weights(y, event_groups, indices):
    import numpy as np

    weights = np.zeros(len(indices), dtype=float)
    train_y, train_events = y[indices], event_groups[indices]
    labels = sorted(set(train_y.tolist()))
    for label in labels:
        events = sorted(set(train_events[train_y == label].tolist()))
        for event in events:
            mask = (train_y == label) & (train_events == event)
            weights[mask] = 1 / (len(labels) * len(events) * int(mask.sum()))
    weights *= len(indices) / weights.sum()
    return weights


def evaluate(name, estimator, x, y, groups, event_groups, classes,
             farm_normalized=False):
    import numpy as np
    from sklearn.feature_selection import VarianceThreshold
    from sklearn.impute import SimpleImputer
    from sklearn.metrics import accuracy_score, balanced_accuracy_score, classification_report, confusion_matrix, f1_score
    from sklearn.model_selection import LeaveOneGroupOut
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import RobustScaler

    predictions = np.empty(len(y), dtype=object)
    folds = []
    for train_idx, test_idx in LeaveOneGroupOut().split(x, y, groups):
        train_x, test_x = x[train_idx].copy(), x[test_idx].copy()
        if farm_normalized:
            train_farms = np.asarray([str(value).split("-", 1)[0] for value in groups[train_idx]])
            test_farm = str(groups[test_idx][0]).split("-", 1)[0]
            normalized_train = train_x.copy()
            farm_statistics = {}
            for farm in sorted(set(train_farms.tolist())):
                farm_mask = train_farms == farm
                reference = train_x[farm_mask]
                with np.errstate(all="ignore"):
                    center = np.nanmedian(reference, axis=0)
                    q25, q75 = np.nanpercentile(reference, [25, 75], axis=0)
                scale = q75 - q25
                scale[~np.isfinite(scale) | (np.abs(scale) < 1e-9)] = 1.0
                normalized_train[farm_mask] = (train_x[farm_mask] - center) / scale
                farm_statistics[farm] = (center, scale)
            center, scale = farm_statistics.get(
                test_farm,
                (np.nanmedian(train_x, axis=0), np.nanpercentile(train_x, 75, axis=0) - np.nanpercentile(train_x, 25, axis=0)),
            )
            scale[~np.isfinite(scale) | (np.abs(scale) < 1e-9)] = 1.0
            train_x = normalized_train
            test_x = (test_x - center) / scale
        steps = [
            ("imputer", SimpleImputer(strategy="median", keep_empty_features=True)),
            ("variance", VarianceThreshold()),
        ]
        if name in {"hist_gradient_boosting", "logistic_regression"}:
            steps.append(("scale", RobustScaler(quantile_range=(10, 90))))
        steps.append(("classifier", estimator()))
        model = Pipeline(steps)
        model.fit(
            train_x, y[train_idx],
            classifier__sample_weight=sample_weights(y, event_groups, train_idx),
        )
        fold_predictions = model.predict(test_x)
        predictions[test_idx] = fold_predictions
        fold_labels = sorted(set(y[test_idx].tolist()))
        folds.append({
            "group": str(groups[test_idx][0]), "test_windows": int(len(test_idx)),
            "true_classes": fold_labels,
            "missing_train_classes": sorted(set(fold_labels) - set(y[train_idx].tolist())),
            "accuracy": float(accuracy_score(y[test_idx], fold_predictions)),
            "macro_f1_present": float(f1_score(
                y[test_idx], fold_predictions, labels=fold_labels, average="macro", zero_division=0,
            )),
        })
    return {
        "accuracy": float(accuracy_score(y, predictions)),
        "balanced_accuracy": float(balanced_accuracy_score(y, predictions)),
        "macro_f1": float(f1_score(y, predictions, labels=classes, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y, predictions, labels=classes, average="weighted", zero_division=0)),
        "per_class": classification_report(y, predictions, labels=classes, output_dict=True, zero_division=0),
        "confusion_labels": classes,
        "confusion_matrix": confusion_matrix(y, predictions, labels=classes).tolist(),
        "folds": folds,
    }


def benchmark(farm_a: Path | None, farm_b: Path, output: Path):
    import numpy as np
    import sklearn
    from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
    from sklearn.linear_model import LogisticRegression

    farm_paths = {"B": farm_b}
    if farm_a is not None:
        farm_paths["A"] = farm_a
    rows, sources, rejected = build_windows(farm_paths)
    x = np.asarray([[np.nan if value is None else value for value in row["features"]] for row in rows])
    adapted_x = np.asarray([
        [np.nan if value is None else value for value in row["asset_adapted_features"]]
        for row in rows
    ])
    y = np.asarray([row["label"] for row in rows])
    groups = np.asarray([row["group"] for row in rows])
    event_groups = np.asarray([f"{row['farm']}-{row['event_id']}" for row in rows])
    classes = sorted(set(y.tolist()))
    estimators = {
        "extra_trees": lambda: ExtraTreesClassifier(
            n_estimators=600, min_samples_leaf=3, max_features=.7,
            random_state=RANDOM_STATE, n_jobs=-1,
        ),
        "hist_gradient_boosting": lambda: HistGradientBoostingClassifier(
            learning_rate=.045, max_iter=300, max_leaf_nodes=15,
            min_samples_leaf=12, l2_regularization=1.0,
            early_stopping=False, random_state=RANDOM_STATE,
        ),
        "logistic_regression": lambda: LogisticRegression(
            C=.1, max_iter=5000, solver="lbfgs", random_state=RANDOM_STATE,
        ),
    }
    feature_sets = {
        "full": (x, FEATURE_NAMES),
        "dynamic": (
            x[:, [
                index for index, name in enumerate(FEATURE_NAMES)
                if not name.endswith("__median") or "temperature_rise" in name
            ]],
            [
                name for name in FEATURE_NAMES
                if not name.endswith("__median") or "temperature_rise" in name
            ],
        ),
        "asset_adapted": (adapted_x, FEATURE_NAMES),
        "asset_adapted_dynamic": (
            adapted_x[:, [
                index for index, name in enumerate(FEATURE_NAMES)
                if not name.endswith("__median") or "temperature_rise" in name
            ]],
            [
                name for name in FEATURE_NAMES
                if not name.endswith("__median") or "temperature_rise" in name
            ],
        ),
    }
    evaluations = {}
    anomaly_evaluations = {}
    anomaly_y = np.where(y == "healthy", "healthy", "abnormal")
    anomaly_classes = sorted(set(anomaly_y.tolist()))
    for feature_set, (matrix, _) in feature_sets.items():
        for estimator_name, estimator in estimators.items():
            name = f"{feature_set}_{estimator_name}"
            print(f"Evaluating {name}", flush=True)
            evaluations[name] = evaluate(
                estimator_name, estimator, matrix, y, groups, event_groups, classes,
            )
            print(f"Evaluating anomaly_{name}", flush=True)
            anomaly_evaluations[name] = evaluate(
                estimator_name, estimator, matrix, anomaly_y, groups,
                event_groups, anomaly_classes,
            )
            normalized_name = f"{name}_farm_normalized"
            print(f"Evaluating {normalized_name}", flush=True)
            evaluations[normalized_name] = evaluate(
                estimator_name, estimator, matrix, y, groups, event_groups,
                classes, farm_normalized=True,
            )
            print(f"Evaluating anomaly_{normalized_name}", flush=True)
            anomaly_evaluations[normalized_name] = evaluate(
                estimator_name, estimator, matrix, anomaly_y, groups,
                event_groups, anomaly_classes, farm_normalized=True,
            )
    selected = max(evaluations, key=lambda name: (evaluations[name]["macro_f1"], evaluations[name]["balanced_accuracy"]))
    selected_anomaly = max(
        anomaly_evaluations,
        key=lambda name: (
            anomaly_evaluations[name]["macro_f1"],
            anomaly_evaluations[name]["balanced_accuracy"],
        ),
    )
    specialist_evaluations = {}
    for target in ("bearing_anomaly", "transformer_thermal"):
        subset = (y == "healthy") | (y == target)
        specialist_y = np.where(y[subset] == target, target, "healthy")
        specialist_classes = sorted(set(specialist_y.tolist()))
        for feature_set in ("asset_adapted", "asset_adapted_dynamic"):
            matrix = feature_sets[feature_set][0][subset]
            for estimator_name, estimator in estimators.items():
                for normalized in (False, True):
                    name = f"{feature_set}_{estimator_name}{'_farm_normalized' if normalized else ''}"
                    print(f"Evaluating specialist_{target}_{name}", flush=True)
                    specialist_evaluations.setdefault(target, {})[name] = evaluate(
                        estimator_name, estimator, matrix, specialist_y,
                        groups[subset], event_groups[subset], specialist_classes,
                        farm_normalized=normalized,
                    )
    selected_specialists = {
        target: max(
            candidates,
            key=lambda name: (
                candidates[name]["macro_f1"],
                candidates[name]["balanced_accuracy"],
            ),
        )
        for target, candidates in specialist_evaluations.items()
    }
    report = {
        "model_version": MODEL_VERSION,
        "farms": sorted(farm_paths),
        "status": "EXPERIMENTAL_CROSS_FARM_BROAD_CLASS",
        "protocol": "LeaveOneGroupOut(farm-asset); train-fold-only imputation, scaling and weighting",
        "random_state": RANDOM_STATE,
        "sklearn_version": sklearn.__version__,
        "selected_candidate": selected,
        "selected_anomaly_candidate": selected_anomaly,
        "selected_specialists": selected_specialists,
        "windows": len(rows), "features": len(FEATURE_NAMES),
        "feature_sets": {name: names for name, (_, names) in feature_sets.items()},
        "classes": classes,
        "groups": sorted(set(groups.tolist())), "events": len(sources),
        "class_support": {
            label: {
                "windows": int((y == label).sum()),
                "groups": sorted(set(groups[y == label].tolist())),
                "events": sorted(set(event_groups[y == label].tolist())),
            } for label in classes
        },
        "rejected": rejected, "sources": sources, "candidates": evaluations,
        "anomaly_detection": {
            "classes": anomaly_classes,
            "selected_candidate": selected_anomaly,
            "candidates": anomaly_evaluations,
        },
        "specialist_detection": {
            "selected_candidates": selected_specialists,
            "targets": specialist_evaluations,
        },
        "limits": [
            "Broad labels combine different physical bearing locations and transformer symptoms.",
            "CARE values are ten-minute SCADA aggregates, not high-rate waveform measurements.",
            "Candidate selection on this benchmark requires confirmation on future independent assets.",
            "Classifier scores are not calibrated failure probabilities.",
            "Asset-adapted candidates use only each asset's unlabeled train-background rows to estimate its baseline; they are not zero-shot transfer.",
        ],
    }
    output.mkdir(parents=True, exist_ok=True)
    path = output / "report.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps({
        "selected": selected, "macro_f1": evaluations[selected]["macro_f1"],
        "balanced_accuracy": evaluations[selected]["balanced_accuracy"],
        "anomaly_selected": selected_anomaly,
        "anomaly_macro_f1": anomaly_evaluations[selected_anomaly]["macro_f1"],
        "specialist_macro_f1": {
            target: specialist_evaluations[target][name]["macro_f1"]
            for target, name in selected_specialists.items()
        },
        "report": str(path),
    }, ensure_ascii=False), flush=True)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--farm-a", type=Path)
    parser.add_argument("--farm-b", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    benchmark(args.farm_a, args.farm_b, args.output)
