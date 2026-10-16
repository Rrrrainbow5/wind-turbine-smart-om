"""Leakage-safe metrics and branch ablations for the v0.2 hybrid baseline."""

from __future__ import annotations

from typing import Any, Sequence

import numpy as np

from .hybrid import (
    HybridDiagnosticModel,
    HybridFeatureSet,
    ModelInputError,
    SignalRecord,
    grouped_train_test_split,
)


def _aligned_probabilities(result: dict[str, Any], classes: list[str]) -> np.ndarray:
    provided = result["class_probabilities"]
    return np.asarray([float(provided.get(name, 0.0)) for name in classes], dtype=float)


def _binary_curves(y_true: np.ndarray, scores: np.ndarray) -> dict[str, Any]:
    positives = int(np.sum(y_true))
    negatives = int(y_true.size - positives)
    if positives == 0 or negatives == 0:
        return {"roc": None, "pr": None, "roc_auc": None, "average_precision": None}
    order = np.argsort(-scores, kind="stable")
    sorted_true = y_true[order]
    sorted_scores = scores[order]
    distinct = np.r_[np.flatnonzero(np.diff(sorted_scores)), sorted_scores.size - 1]
    true_positive = np.cumsum(sorted_true)[distinct]
    false_positive = (distinct + 1) - true_positive
    tpr = np.r_[0.0, true_positive / positives, 1.0]
    fpr = np.r_[0.0, false_positive / negatives, 1.0]
    recall = np.r_[0.0, true_positive / positives]
    precision = np.r_[1.0, true_positive / np.maximum(true_positive + false_positive, 1)]
    thresholds = sorted_scores[distinct]
    roc_auc = float(np.trapezoid(tpr, fpr))
    average_precision = float(np.sum(np.diff(recall) * precision[1:]))
    return {
        "roc": {"false_positive_rate": fpr.tolist(), "true_positive_rate": tpr.tolist(),
                "thresholds": [None, *thresholds.tolist(), None]},
        "pr": {"recall": recall.tolist(), "precision": precision.tolist(),
               "thresholds": thresholds.tolist()},
        "roc_auc": roc_auc,
        "average_precision": average_precision,
    }


def _metrics(labels: Sequence[str], probabilities: np.ndarray, classes: list[str],
             *, calibration_bins: int = 10) -> dict[str, Any]:
    truth = np.asarray(labels, dtype=str)
    if probabilities.shape != (truth.size, len(classes)):
        raise ModelInputError("probability matrix shape does not match labels and classes")
    predicted_indexes = np.argmax(probabilities, axis=1)
    truth_indexes = np.asarray([classes.index(label) for label in truth], dtype=int)
    confusion = np.zeros((len(classes), len(classes)), dtype=int)
    for actual, predicted in zip(truth_indexes, predicted_indexes):
        confusion[actual, predicted] += 1
    per_class: dict[str, Any] = {}
    f1_values: list[float] = []
    curves: dict[str, Any] = {}
    for index, name in enumerate(classes):
        tp = int(confusion[index, index])
        fp = int(np.sum(confusion[:, index]) - tp)
        fn = int(np.sum(confusion[index, :]) - tp)
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        per_class[name] = {"precision": precision, "recall": recall, "f1": f1,
                           "support": int(np.sum(confusion[index, :]))}
        f1_values.append(f1)
        curves[name] = _binary_curves((truth_indexes == index).astype(int), probabilities[:, index])
    target = np.eye(len(classes))[truth_indexes]
    brier = float(np.mean(np.sum((probabilities - target) ** 2, axis=1)))
    confidence = np.max(probabilities, axis=1)
    correct = (predicted_indexes == truth_indexes).astype(float)
    ece = 0.0
    bin_details = []
    for lower in np.linspace(0.0, 1.0, calibration_bins, endpoint=False):
        upper = lower + 1.0 / calibration_bins
        mask = (confidence >= lower) & (confidence < upper if upper < 1 else confidence <= upper)
        count = int(np.sum(mask))
        if count:
            accuracy = float(np.mean(correct[mask]))
            mean_confidence = float(np.mean(confidence[mask]))
            ece += count / truth.size * abs(accuracy - mean_confidence)
        else:
            accuracy = mean_confidence = None
        bin_details.append({"lower": float(lower), "upper": float(upper), "count": count,
                            "accuracy": accuracy, "mean_confidence": mean_confidence})
    return {
        "macro_f1": float(np.mean(f1_values)),
        "accuracy": float(np.mean(correct)),
        "per_class": per_class,
        "confusion_matrix": {"labels": classes, "values": confusion.tolist()},
        "curves": curves,
        "calibration": {"ece": float(ece), "brier": brier, "bins": bin_details},
    }


def evaluate_hybrid_model(features: Sequence[HybridFeatureSet], labels: Sequence[str],
                          records: Sequence[SignalRecord], *, test_fraction: float = 0.25,
                          seed: int = 7) -> dict[str, Any]:
    """Fit on grouped training records and report holdout metrics plus ablations."""
    if len(features) != len(labels) or len(features) != len(records):
        raise ModelInputError("features, labels and records must have equal lengths")
    if any(feature.sample_id != record.sample_id for feature, record in zip(features, records)):
        raise ModelInputError("feature and record sample_id values must match")
    train_indexes, test_indexes = grouped_train_test_split(
        records, test_fraction=test_fraction, seed=seed
    )
    train_features = [features[index] for index in train_indexes]
    train_labels = [labels[index] for index in train_indexes]
    train_records = [records[index] for index in train_indexes]
    test_features = [features[index] for index in test_indexes]
    test_labels = [labels[index] for index in test_indexes]
    missing_train_classes = sorted(set(labels) - set(train_labels))
    if missing_train_classes:
        raise ModelInputError(
            "grouped training split is missing classes: " + ", ".join(missing_train_classes)
        )
    model = HybridDiagnosticModel().fit(train_features, train_labels, train_records)
    classes = sorted(set(labels))
    configurations = {
        "hybrid": ("engineering", "raw", "time_frequency"),
        "engineering_only": ("engineering",),
        "raw_only": ("raw",),
        "time_frequency_only": ("time_frequency",),
        "without_engineering": ("raw", "time_frequency"),
        "without_raw": ("engineering", "time_frequency"),
        "without_time_frequency": ("engineering", "raw"),
    }
    reports: dict[str, Any] = {}
    hybrid_predictions: list[dict[str, Any]] = []
    for configuration, branches in configurations.items():
        results = [model.predict(feature, branches=branches) for feature in test_features]
        probabilities = np.stack([_aligned_probabilities(result, classes) for result in results])
        reports[configuration] = _metrics(test_labels, probabilities, classes)
        if configuration == "hybrid":
            hybrid_predictions = results
    return {
        "schema_version": "hybrid-evaluation.v0.2",
        "model_version": model.MODEL_VERSION,
        "random_seed": seed,
        "split": {
            "strategy": "grouped by turbine_id + event_id; all event timestamps stay together",
            "test_fraction": test_fraction,
            "train_sample_ids": [records[index].sample_id for index in train_indexes],
            "test_sample_ids": [records[index].sample_id for index in test_indexes],
        },
        "metrics": reports["hybrid"],
        "ablations": reports,
        "predictions": hybrid_predictions,
        "limitations": [
            "Metrics are valid only for the supplied labelled dataset and split.",
            "The NumPy heads are contract baselines, not the final XGBoost/CNN/TCN implementation.",
        ],
    }
