import numpy as np
import pytest

from ai.models.hybrid import (
    HybridDiagnosticModel,
    ModelInputError,
    SignalRecord,
    extract_features,
    grouped_train_test_split,
)
from ai.models.evaluation import evaluate_hybrid_model


def _record(sample_id: str, turbine: str, event: str, timestamp: str) -> SignalRecord:
    time = np.arange(128) / 512
    vibration = np.sin(2 * np.pi * 30 * time)
    current = np.sin(2 * np.pi * 10 * time)
    return SignalRecord(sample_id, turbine, event, timestamp, 512, vibration, current)


def test_feature_branches_keep_sample_id_and_equal_channels() -> None:
    record = _record("s-1", "wt-1", "e-1", "2026-01-01")
    features = extract_features(record)
    assert features.sample_id == record.sample_id
    assert features.engineering.ndim == features.raw.ndim == features.time_frequency.ndim == 1
    with pytest.raises(ModelInputError, match="equal lengths"):
        extract_features(SignalRecord("s-2", "wt-1", "e-1", "2026-01-01", 512, record.vibration, record.current[:-1]))


def test_group_split_does_not_split_same_group() -> None:
    records = [_record("s-0", "wt-1", "e-1", "2026-01-01"),
               _record("s-1", "wt-1", "e-1", "2026-01-02")]
    records += [_record(f"s-{i}", "wt-2", "e-2", "2026-01-02") for i in range(2, 4)]
    train, test = grouped_train_test_split(records, test_fraction=.5, seed=2)
    assert set(train).isdisjoint(test)
    assert {records[i].turbine_id for i in train}.isdisjoint({records[i].turbine_id for i in test})


def test_model_is_explicitly_untrained_until_fit() -> None:
    records = [_record(f"s-{i}", f"wt-{i // 2}", f"e-{i // 2}", f"2026-01-0{i + 1}") for i in range(6)]
    features = [extract_features(record) for record in records]
    model = HybridDiagnosticModel()
    assert model.predict(features[0])["status"] == "NOT_TRAINED"
    model.fit(features, ["unbalance", "unbalance", "misalignment", "misalignment", "bearing", "bearing"], records)
    result = model.predict(features[0])
    assert result["status"] == "INFERRED_BASELINE"
    assert result["sample_id"] == records[0].sample_id
    assert 0 <= result["confidence"] <= 1
    assert sum(result["gate_weights"].values()) == pytest.approx(1)
    assert sum(result["class_probabilities"].values()) == pytest.approx(1)
    with pytest.raises(ModelInputError, match="branches"):
        model.predict(features[0], branches=("invented",))


def test_grouped_evaluation_reports_required_metrics_and_ablations() -> None:
    records = []
    labels = []
    for index in range(18):
        label_index = index % 3
        label = ("bearing", "misalignment", "unbalance")[label_index]
        time = np.arange(128) / 512
        frequency = (30, 60, 90)[label_index]
        records.append(SignalRecord(
            f"eval-{index}", f"wt-{index}", f"event-{index}", f"2026-02-{index + 1:02d}",
            512, np.sin(2 * np.pi * frequency * time),
            np.sin(2 * np.pi * (10 + label_index * 5) * time),
        ))
        labels.append(label)
    features = [extract_features(record) for record in records]
    report = evaluate_hybrid_model(features, labels, records, test_fraction=1 / 3, seed=4)
    assert set(report["split"]["train_sample_ids"]).isdisjoint(report["split"]["test_sample_ids"])
    assert 0 <= report["metrics"]["macro_f1"] <= 1
    assert set(report["metrics"]["per_class"]) == set(labels)
    assert len(report["metrics"]["confusion_matrix"]["values"]) == 3
    assert {"ece", "brier"}.issubset(report["metrics"]["calibration"])
    assert {"hybrid", "engineering_only", "raw_only", "time_frequency_only"}.issubset(
        report["ablations"]
    )
    assert all(prediction["sample_id"] in report["split"]["test_sample_ids"]
               for prediction in report["predictions"])
