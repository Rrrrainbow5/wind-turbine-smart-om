from __future__ import annotations

import numpy as np

from ai.care_crossfarm_broad import FEATURE_NAMES as BROAD_FEATURE_NAMES
from ai.care_crossfarm_broad import broad_label, window_features
from ai.care_multifault_optimized import _coverage_metrics


def test_crossfarm_label_mapping_keeps_only_supported_broad_classes():
    assert broad_label("A", "") == "healthy"
    assert broad_label("A", "Gearbox bearings damaged") == "bearing_anomaly"
    assert broad_label("B", "Rotor Bearing 2 - Damage") == "bearing_anomaly"
    assert broad_label("B", "high temperature in transformer cell") == "transformer_thermal"
    assert broad_label("A", "Hydraulic group") is None


def test_crossfarm_window_feature_contract_is_finite_and_stable():
    values = np.arange(36 * 11, dtype=float).reshape(36, 11)
    features = window_features(values)
    assert len(features) == len(BROAD_FEATURE_NAMES)
    assert all(value is not None and np.isfinite(value) for value in features)


def test_coverage_metrics_mark_single_asset_classes_as_structurally_unseen():
    y = np.asarray(["healthy", "healthy", "rare"])
    predictions = np.asarray(["healthy", "healthy", "healthy"], dtype=object)
    groups = np.asarray(["A-1", "A-2", "A-1"])
    report = _coverage_metrics(y, predictions, groups)
    assert report["known_class_windows"] == 2
    assert report["structurally_unseen_windows"] == 1
    assert report["known_class_labels"] == ["healthy"]
    assert report["macro_f1_known_classes"] == 1.0
