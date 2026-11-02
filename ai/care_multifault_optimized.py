"""Strict asset-held-out CARE SCADA model benchmark.

This module does not replace the production export.  It compares candidate
estimators under the same leave-one-physical-asset-out protocol and writes a
fully reproducible evaluation report.  Run it before promoting any model:

    python -m ai.care_multifault_optimized --farm PATH --cache PATH --output PATH

No asset, event, timestamp, description, or label identifier enters the model.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Callable

from ai.care_multifault import FEATURE_NAMES, SIGNALS, prepare

RANDOM_STATE = 20261102
MODEL_VERSION = "care-scada-asset-held-out-benchmark-v2"


def _enhanced_features(farm: Path, rows: list[dict], cache: Path | None = None):
    """Extract trainable window statistics without changing the production cache.

    Every value is computed from the same 36 rows represented by the existing
    sample.  Event/asset/timestamp identifiers are used only to locate rows and
    never enter the returned feature matrix.
    """
    import numpy as np
    import pandas as pd

    names = [
        f"{signal}__{stat}"
        for stat in (
            "q10", "q25", "q75", "q90", "iqr", "mad", "min", "max",
            "range", "slope", "diff_median", "diff_mad", "missing_rate",
        )
        for signal in SIGNALS
    ]
    if cache and cache.exists():
        payload = json.loads(cache.read_text(encoding="utf-8"))
        if payload.get("schema") == 1 and payload.get("feature_names") == names:
            by_id = payload.get("samples", {})
            if all(row["sample_id"] in by_id for row in rows):
                return np.asarray([by_id[row["sample_id"]] for row in rows], dtype=float), names

    samples: dict[str, list[float]] = {}
    rows_by_event: dict[int, list[dict]] = {}
    for row in rows:
        rows_by_event.setdefault(int(row["event_id"]), []).append(row)
    position = np.arange(36, dtype=float)
    for event_id, event_rows in rows_by_event.items():
        frame = pd.read_csv(
            farm / "datasets" / f"{event_id}.csv", sep=";",
            usecols=["time_stamp", *SIGNALS],
        )
        frame["time_stamp"] = pd.to_datetime(frame.time_stamp)
        frame = frame.set_index("time_stamp").sort_index()
        for row in event_rows:
            block = frame.loc[pd.Timestamp(row["start"]):pd.Timestamp(row["end"]), SIGNALS]
            if len(block) != 36:
                raise ValueError(f"Enhanced feature window mismatch for {row['sample_id']}")
            values = block.to_numpy(dtype=float)
            values[~np.isfinite(values)] = np.nan
            with np.errstate(all="ignore"):
                q10, q25, q75, q90 = np.nanpercentile(values, [10, 25, 75, 90], axis=0)
                median = np.nanmedian(values, axis=0)
                mad = np.nanmedian(np.abs(values - median), axis=0)
                minimum, maximum = np.nanmin(values, axis=0), np.nanmax(values, axis=0)
                delta = np.diff(values, axis=0)
                diff_median = np.nanmedian(delta, axis=0)
                diff_center = np.nanmedian(delta, axis=0)
                diff_mad = np.nanmedian(np.abs(delta - diff_center), axis=0)
                missing_rate = np.isnan(values).mean(axis=0)
                slopes = []
                for column in values.T:
                    valid = np.isfinite(column)
                    slopes.append(np.polyfit(position[valid], column[valid], 1)[0] if valid.sum() >= 2 else np.nan)
                vector = np.concatenate([
                    q10, q25, q75, q90, q75 - q25, mad, minimum, maximum,
                    maximum - minimum, np.asarray(slopes), diff_median, diff_mad,
                    missing_rate,
                ])
            samples[row["sample_id"]] = [float(value) if np.isfinite(value) else np.nan for value in vector]
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({
            "schema": 1, "feature_names": names, "samples": samples,
        }, allow_nan=True), encoding="utf-8")
    return np.asarray([samples[row["sample_id"]] for row in rows], dtype=float), names


def _matrix(rows: list[dict], enhanced=None, enhanced_names=None):
    """Return base, robust-window and scale-resistant descriptors."""
    import numpy as np

    base = np.asarray([
        [np.nan if value is None else value for value in row["features"]]
        for row in rows
    ], dtype=float)
    width = len(SIGNALS)
    median, std, delta = base[:, :width], base[:, width:2 * width], base[:, 2 * width:]
    # Relative descriptors reduce turbine-specific offsets while retaining the
    # original engineering quantities.  The floor prevents unstable ratios for
    # channels whose median is close to zero.
    scale = np.maximum(np.abs(median), 1.0)
    relative_std = std / scale
    relative_delta = delta / scale
    parts = [base, relative_std, relative_delta]
    if enhanced is not None:
        parts.append(enhanced)
    matrix = np.concatenate(parts, axis=1)
    names = [
        *FEATURE_NAMES,
        *(f"{name}__relative_std" for name in SIGNALS),
        *(f"{name}__relative_delta" for name in SIGNALS),
    ]
    if enhanced_names:
        names.extend(enhanced_names)
    return matrix, names


def _sample_weights(y, event_ids, indices):
    """Equalise classes, then events within each class, using training rows only."""
    import numpy as np

    labels = sorted(set(y[indices].tolist()))
    weights = np.zeros(len(indices), dtype=float)
    train_y, train_events = y[indices], event_ids[indices]
    for label in labels:
        label_mask = train_y == label
        events = sorted(set(train_events[label_mask].tolist()))
        for event in events:
            mask = label_mask & (train_events == event)
            weights[mask] = 1.0 / (len(labels) * len(events) * int(mask.sum()))
    weights *= len(indices) / weights.sum()
    return weights


def _factories() -> dict[str, Callable[[], object]]:
    from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier, RandomForestClassifier

    return {
        "weighted_random_forest": lambda: RandomForestClassifier(
            n_estimators=500, max_depth=None, min_samples_leaf=3,
            max_features=0.45, class_weight=None, random_state=RANDOM_STATE,
            n_jobs=-1,
        ),
        "weighted_extra_trees": lambda: ExtraTreesClassifier(
            n_estimators=500, max_depth=None, min_samples_leaf=3,
            max_features=0.65, class_weight=None, random_state=RANDOM_STATE,
            n_jobs=-1,
        ),
        "hist_gradient_boosting": lambda: HistGradientBoostingClassifier(
            learning_rate=0.045, max_iter=250, max_leaf_nodes=15,
            min_samples_leaf=12, l2_regularization=1.0,
            early_stopping=False, random_state=RANDOM_STATE,
        ),
    }


def _coverage_metrics(y, predictions, groups):
    """Separate structurally evaluable rows from true classes absent in a fold.

    This is evaluation metadata only.  Production inference never sees the true
    label and must use a train-fold-derived confidence rejection rule instead.
    """
    import numpy as np
    from sklearn.metrics import f1_score

    asset_counts = {
        label: len(set(groups[y == label].tolist())) for label in set(y.tolist())
    }
    known_mask = np.asarray([asset_counts[label] > 1 for label in y], dtype=bool)
    known_labels = sorted(set(y[known_mask].tolist()))
    return {
        "known_class_windows": int(known_mask.sum()),
        "structurally_unseen_windows": int((~known_mask).sum()),
        "known_class_labels": known_labels,
        "macro_f1_known_classes": float(f1_score(
            y[known_mask], predictions[known_mask], labels=known_labels,
            average="macro", zero_division=0,
        )),
    }


def _evaluate(name, factory, x, y, groups, event_ids, classes):
    import numpy as np
    from sklearn.feature_selection import VarianceThreshold
    from sklearn.impute import SimpleImputer
    from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
    from sklearn.model_selection import LeaveOneGroupOut
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import RobustScaler

    predictions = np.empty(len(y), dtype=object)
    probabilities = np.zeros((len(y), len(classes)), dtype=float)
    folds = []
    for train_idx, test_idx in LeaveOneGroupOut().split(x, y, groups):
        estimator = factory()
        steps = [
            ("imputer", SimpleImputer(strategy="median", keep_empty_features=True)),
            ("variance", VarianceThreshold()),
        ]
        if name == "hist_gradient_boosting":
            steps.append(("scale", RobustScaler(quantile_range=(10, 90))))
        steps.append(("classifier", estimator))
        model = Pipeline(steps)
        weights = _sample_weights(y, event_ids, train_idx)
        model.fit(x[train_idx], y[train_idx], classifier__sample_weight=weights)
        fold_prediction = model.predict(x[test_idx])
        fold_probability = model.predict_proba(x[test_idx])
        predictions[test_idx] = fold_prediction
        trained_classes = model.named_steps["classifier"].classes_.tolist()
        for source_index, label in enumerate(trained_classes):
            probabilities[test_idx, classes.index(label)] = fold_probability[:, source_index]
        fold_labels = sorted(set(y[test_idx].tolist()))
        folds.append({
            "asset": int(groups[test_idx][0]),
            "test_windows": int(len(test_idx)),
            "true_classes": fold_labels,
            "missing_train_classes": sorted(set(fold_labels) - set(y[train_idx].tolist())),
            "accuracy": float(accuracy_score(y[test_idx], fold_prediction)),
            "macro_f1_present_classes": float(f1_score(
                y[test_idx], fold_prediction, labels=fold_labels,
                average="macro", zero_division=0,
            )),
        })
    evaluation = {
        "accuracy": float(accuracy_score(y, predictions)),
        "macro_f1_all_classes": float(f1_score(
            y, predictions, labels=classes, average="macro", zero_division=0,
        )),
        "weighted_f1": float(f1_score(y, predictions, labels=classes, average="weighted", zero_division=0)),
        "per_class": classification_report(
            y, predictions, labels=classes, output_dict=True, zero_division=0,
        ),
        "confusion_labels": classes,
        "confusion_matrix": confusion_matrix(y, predictions, labels=classes).tolist(),
        "folds": folds,
        **_coverage_metrics(y, predictions, groups),
    }
    return evaluation, predictions.tolist(), probabilities.tolist()


def _evaluate_two_stage(x, y, groups, event_ids, classes,
                        binary_kind="hgb", fault_kind="hgb"):
    """Separate normal/abnormal detection from supported fault classification."""
    import numpy as np
    from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
    from sklearn.feature_selection import VarianceThreshold
    from sklearn.impute import SimpleImputer
    from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
    from sklearn.model_selection import LeaveOneGroupOut
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import RobustScaler

    def pipeline(kind):
        estimator = HistGradientBoostingClassifier(
            learning_rate=.045, max_iter=250, max_leaf_nodes=15,
            min_samples_leaf=12, l2_regularization=1.0,
            early_stopping=False, random_state=RANDOM_STATE,
        ) if kind == "hgb" else ExtraTreesClassifier(
            n_estimators=500, min_samples_leaf=3, max_features=.65,
            random_state=RANDOM_STATE, n_jobs=-1,
        )
        steps = [
            ("imputer", SimpleImputer(strategy="median", keep_empty_features=True)),
            ("variance", VarianceThreshold()),
        ]
        if kind == "hgb":
            steps.append(("scale", RobustScaler(quantile_range=(10, 90))))
        steps.append(("classifier", estimator))
        return Pipeline(steps)

    predictions = np.empty(len(y), dtype=object)
    probabilities = np.zeros((len(y), len(classes)), dtype=float)
    folds = []
    for train_idx, test_idx in LeaveOneGroupOut().split(x, y, groups):
        binary_y = np.where(y == "healthy", "healthy", "fault")
        binary = pipeline(binary_kind)
        binary.fit(
            x[train_idx], binary_y[train_idx],
            classifier__sample_weight=_sample_weights(binary_y, event_ids, train_idx),
        )
        binary_scores = binary.predict_proba(x[test_idx])
        binary_classes = binary.named_steps["classifier"].classes_.tolist()
        p_healthy = binary_scores[:, binary_classes.index("healthy")]
        p_fault = binary_scores[:, binary_classes.index("fault")]

        fault_train_idx = train_idx[y[train_idx] != "healthy"]
        fault_model = pipeline(fault_kind)
        fault_model.fit(
            x[fault_train_idx], y[fault_train_idx],
            classifier__sample_weight=_sample_weights(y, event_ids, fault_train_idx),
        )
        conditional = fault_model.predict_proba(x[test_idx])
        fault_classes = fault_model.named_steps["classifier"].classes_.tolist()
        probabilities[test_idx, classes.index("healthy")] = p_healthy
        for source_index, label in enumerate(fault_classes):
            probabilities[test_idx, classes.index(label)] = p_fault * conditional[:, source_index]
        fold_prediction = np.asarray(classes)[probabilities[test_idx].argmax(axis=1)]
        predictions[test_idx] = fold_prediction
        fold_labels = sorted(set(y[test_idx].tolist()))
        folds.append({
            "asset": int(groups[test_idx][0]),
            "test_windows": int(len(test_idx)),
            "true_classes": fold_labels,
            "missing_train_classes": sorted(set(fold_labels) - set(y[train_idx].tolist())),
            "accuracy": float(accuracy_score(y[test_idx], fold_prediction)),
            "macro_f1_present_classes": float(f1_score(
                y[test_idx], fold_prediction, labels=fold_labels,
                average="macro", zero_division=0,
            )),
        })
    evaluation = {
        "accuracy": float(accuracy_score(y, predictions)),
        "macro_f1_all_classes": float(f1_score(
            y, predictions, labels=classes, average="macro", zero_division=0,
        )),
        "weighted_f1": float(f1_score(
            y, predictions, labels=classes, average="weighted", zero_division=0,
        )),
        "per_class": classification_report(
            y, predictions, labels=classes, output_dict=True, zero_division=0,
        ),
        "confusion_labels": classes,
        "confusion_matrix": confusion_matrix(y, predictions, labels=classes).tolist(),
        "folds": folds,
        **_coverage_metrics(y, predictions, groups),
    }
    return evaluation, predictions.tolist(), probabilities.tolist()


def benchmark(farm: Path, output: Path, cache: Path | None = None,
              frontend_export: Path | None = None,
              enhanced_cache: Path | None = None,
              use_enhanced: bool = True) -> dict:
    import numpy as np
    import sklearn

    rows, sources, rejected = prepare(farm, cache)
    if use_enhanced:
        enhanced, enhanced_names = _enhanced_features(farm, rows, enhanced_cache)
        x, feature_names = _matrix(rows, enhanced, enhanced_names)
    else:
        x, feature_names = _matrix(rows)
    y = np.asarray([row["label"] for row in rows])
    groups = np.asarray([row["asset"] for row in rows])
    event_ids = np.asarray([row["event_id"] for row in rows])
    classes = sorted(set(y.tolist()))
    candidates, prediction_sets, probability_sets = {}, {}, {}
    for name, factory in _factories().items():
        print(f"Evaluating {name} with strict asset holdout", flush=True)
        result, predictions, probabilities = _evaluate(
            name, factory, x, y, groups, event_ids, classes,
        )
        candidates[name] = result
        prediction_sets[name] = predictions
        probability_sets[name] = probabilities
    for binary_kind, fault_kind in (("hgb", "hgb"), ("extra", "hgb"), ("hgb", "extra"), ("extra", "extra")):
        name = f"two_stage_{binary_kind}_{fault_kind}"
        print(f"Evaluating {name} with strict asset holdout", flush=True)
        result, predictions, probabilities = _evaluate_two_stage(
            x, y, groups, event_ids, classes, binary_kind, fault_kind,
        )
        candidates[name] = result
        prediction_sets[name] = predictions
        probability_sets[name] = probabilities
    selected = max(
        candidates,
        key=lambda key: (candidates[key]["macro_f1_all_classes"], candidates[key]["accuracy"]),
    )
    report = {
        "model_version": MODEL_VERSION,
        "status": "EXPERIMENTAL_ASSET_HELD_OUT",
        "selection_rule": "highest strict leave-one-asset-out macro F1; accuracy tie-break",
        "selected_candidate": selected,
        "sklearn_version": sklearn.__version__,
        "random_state": RANDOM_STATE,
        "protocol": "LeaveOneGroupOut(asset); train-fold-only imputation, variance filtering and weighting",
        "windows": len(rows),
        "assets": sorted(set(groups.tolist())),
        "events": len(sources),
        "classes": classes,
        "base_features": len(FEATURE_NAMES),
        "features": len(feature_names),
        "feature_names": feature_names,
        "excluded": rejected,
        "class_support": {
            label: {
                "windows": int((y == label).sum()),
                "assets": sorted(set(groups[y == label].tolist())),
                "events": sorted(set(event_ids[y == label].tolist())),
            } for label in classes
        },
        "candidates": candidates,
        "selected_predictions": [
            {
                "sample_id": row["sample_id"],
                "asset": row["asset"],
                "event_id": row["event_id"],
                "true_label": row["label"],
                "prediction": prediction_sets[selected][index],
                "class_scores": dict(zip(classes, probability_sets[selected][index])),
                "evaluation_status": (
                    "PREDICTED" if len(set(groups[y == row["label"]].tolist())) > 1
                    else "UNSEEN_CLASS_IN_TRAIN"
                ),
            }
            for index, row in enumerate(rows)
        ],
        "limits": [
            "Candidate selection uses the same outer asset-held-out benchmark and requires confirmation on future independent assets.",
            "A class occurring on only one asset is impossible to learn when that asset is held out; its score remains in strict macro F1.",
            "Classifier scores are not calibrated fault probabilities.",
            "CARE inputs are ten-minute SCADA aggregates, not high-rate vibration waveforms.",
        ],
    }
    output.mkdir(parents=True, exist_ok=True)
    report_path = output / "benchmark-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    if frontend_export:
        frontend_export.parent.mkdir(parents=True, exist_ok=True)
        frontend_export.write_text(json.dumps({
            "model_version": MODEL_VERSION,
            "selected_candidate": selected,
            "evaluation": candidates[selected],
            "limits": report["limits"],
        }, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps({
        "selected": selected,
        "macro_f1": candidates[selected]["macro_f1_all_classes"],
        "accuracy": candidates[selected]["accuracy"],
        "report": str(report_path),
    }, ensure_ascii=False), flush=True)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--farm", type=Path, required=True)
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--output", type=Path, default=Path("models/care-multifault-optimized"))
    parser.add_argument("--frontend-export", type=Path)
    parser.add_argument("--enhanced-cache", type=Path)
    parser.add_argument("--no-enhanced", action="store_true")
    args = parser.parse_args()
    benchmark(
        args.farm, args.output, args.cache, args.frontend_export,
        args.enhanced_cache, not args.no_enhanced,
    )
