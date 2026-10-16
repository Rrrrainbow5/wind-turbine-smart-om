"""Leakage-safe v0.2 hybrid model contract.

The default backend is a small NumPy baseline so the contract can be tested
without installing a deep-learning runtime. It deliberately reports its
backend as ``numpy_baseline``; replacing the three heads with XGBoost, 1D
CNN/TCN and a time-frequency CNN does not change the feature or result schema.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

import numpy as np


class ModelInputError(ValueError):
    """Input records cannot be used for a leakage-safe model run."""


@dataclass(frozen=True)
class SignalRecord:
    sample_id: str
    turbine_id: str
    event_id: str
    timestamp: str
    sampling_rate_hz: float
    vibration: np.ndarray
    current: np.ndarray | None = None


@dataclass(frozen=True)
class HybridFeatureSet:
    sample_id: str
    engineering: np.ndarray
    raw: np.ndarray
    time_frequency: np.ndarray


def _as_waveform(values: np.ndarray, name: str) -> np.ndarray:
    values = np.asarray(values, dtype=float)
    if values.ndim != 1 or values.size < 16 or not np.isfinite(values).all():
        raise ModelInputError(f"{name} must be a finite one-dimensional waveform with 16+ values")
    return values


def _standardize(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=float)
    scale = np.std(values, axis=0)
    scale[scale < 1e-12] = 1.0
    return (values - np.mean(values, axis=0)) / scale


def _stats(values: np.ndarray) -> list[float]:
    x = _as_waveform(values, "signal")
    mean = float(np.mean(x))
    centered = x - mean
    std = float(np.std(x))
    rms = float(np.sqrt(np.mean(x * x)))
    return [
        mean,
        float(np.var(x)),
        std,
        rms,
        float(np.max(x) - np.min(x)),
        float(np.max(np.abs(x))),
        float(np.mean(centered**3) / std**3) if std else 0.0,
        float(np.mean(centered**4) / std**4) if std else 0.0,
        float(np.max(np.abs(x)) / rms) if rms else 0.0,
    ]


def _engineering_features(vibration: np.ndarray, current: np.ndarray | None, fs: float) -> np.ndarray:
    channels = [vibration] if current is None else [vibration, current]
    features: list[float] = []
    for channel in channels:
        features.extend(_stats(channel))
        spectrum = np.abs(np.fft.rfft(channel - np.mean(channel)))
        frequencies = np.fft.rfftfreq(channel.size, 1.0 / fs)
        top = np.argsort(spectrum[1:])[-3:] + 1 if spectrum.size > 1 else np.array([], dtype=int)
        features.extend(float(frequencies[index]) for index in top[::-1])
    return np.asarray(features, dtype=float)


def _resample(values: np.ndarray, width: int) -> np.ndarray:
    x = _as_waveform(values, "signal")
    source = np.linspace(0.0, 1.0, x.size)
    target = np.linspace(0.0, 1.0, width)
    result = np.interp(target, source, x)
    scale = float(np.std(result))
    return (result - float(np.mean(result))) / (scale if scale > 1e-12 else 1.0)


def _time_frequency_features(values: np.ndarray, fs: float, bins: int = 32) -> np.ndarray:
    x = _as_waveform(values, "signal")
    size = min(64, x.size)
    hop = max(1, size // 2)
    starts = list(range(0, x.size - size + 1, hop)) or [0]
    if starts[-1] != x.size - size:
        starts.append(x.size - size)
    frames = np.stack([x[start : start + size] for start in starts])
    window = np.hanning(size)
    spectrum = np.abs(np.fft.rfft((frames - np.mean(frames, axis=1, keepdims=True)) * window, axis=1))
    spectrum = np.log1p(spectrum)
    target = np.linspace(0, spectrum.shape[1] - 1, bins).round().astype(int)
    return _resample(spectrum[:, target].reshape(-1), 128)


def extract_features(record: SignalRecord) -> HybridFeatureSet:
    """Create all three branch inputs while retaining the same sample id."""
    if not record.sample_id.strip() or not record.turbine_id.strip() or not record.event_id.strip():
        raise ModelInputError("sample_id, turbine_id and event_id are required")
    if not np.isfinite(record.sampling_rate_hz) or record.sampling_rate_hz <= 0:
        raise ModelInputError("sampling_rate_hz must be positive and finite")
    vibration = _as_waveform(record.vibration, "vibration")
    current = None if record.current is None else _as_waveform(record.current, "current")
    if current is not None and current.size != vibration.size:
        raise ModelInputError("vibration and current must have equal lengths")
    engineering = _engineering_features(vibration, current, float(record.sampling_rate_hz))
    raw_channels = [_resample(vibration, 128)]
    if current is not None:
        raw_channels.append(_resample(current, 128))
    raw = np.concatenate(raw_channels)
    time_frequency = _time_frequency_features(vibration, float(record.sampling_rate_hz))
    return HybridFeatureSet(record.sample_id, engineering, raw, time_frequency)


def grouped_train_test_split(records: Sequence[SignalRecord], *, test_fraction: float = 0.2,
                             seed: int = 7) -> tuple[list[int], list[int]]:
    """Split by turbine/event group, keeping every event timestamp together."""
    if not records or not 0 < test_fraction < 1:
        raise ModelInputError("records are required and test_fraction must be between 0 and 1")
    groups = np.asarray([f"{r.turbine_id}|{r.event_id}" for r in records])
    unique = np.unique(groups)
    rng = np.random.default_rng(seed)
    rng.shuffle(unique)
    test_count = max(1, int(np.ceil(unique.size * test_fraction)))
    test_groups = set(unique[:test_count].tolist())
    test = [index for index, group in enumerate(groups) if group in test_groups]
    train = [index for index, group in enumerate(groups) if group not in test_groups]
    if not train:
        raise ModelInputError("group split leaves no training group")
    return train, test


class HybridDiagnosticModel:
    """Three-branch gated baseline with a stable future-model contract."""

    MODEL_VERSION = "hybrid-gated-v0.2-baseline"

    def __init__(self, *, ridge: float = 1.0) -> None:
        if not np.isfinite(ridge) or ridge <= 0:
            raise ModelInputError("ridge must be positive and finite")
        self.ridge = float(ridge)
        self.status = "NOT_TRAINED"
        self.classes_: np.ndarray | None = None
        self._heads: list[np.ndarray] | None = None
        self._means: list[np.ndarray] | None = None
        self._scales: list[np.ndarray] | None = None
        self._gate_weights: np.ndarray | None = None

    @property
    def architecture(self) -> dict[str, str]:
        return {
            "engineering": "xgboost-compatible feature head (NumPy baseline)",
            "raw": "1D-CNN/TCN-compatible waveform head (NumPy baseline)",
            "time_frequency": "lightweight CNN-compatible STFT head (NumPy baseline)",
            "fusion": "branch-quality weighted gated logits",
        }

    def fit(self, features: Sequence[HybridFeatureSet], labels: Sequence[str],
            records: Sequence[SignalRecord]) -> "HybridDiagnosticModel":
        if len(features) != len(labels) or len(features) != len(records) or len(features) < 4:
            raise ModelInputError("features, labels and records must have equal length (at least 4)")
        if len({feature.sample_id for feature in features}) != len(features):
            raise ModelInputError("duplicate sample_id is not allowed")
        if any(feature.sample_id != record.sample_id for feature, record in zip(features, records)):
            raise ModelInputError("feature and record sample_id values must match")
        labels_array = np.asarray(labels, dtype=str)
        classes = np.unique(labels_array)
        if classes.size < 2:
            raise ModelInputError("at least two fault classes are required")
        matrices = [np.stack([feature.engineering for feature in features]),
                    np.stack([feature.raw for feature in features]),
                    np.stack([feature.time_frequency for feature in features])]
        self._means, self._scales, self._heads = [], [], []
        targets = np.zeros((len(labels), classes.size))
        for index, label in enumerate(labels_array):
            targets[index, np.flatnonzero(classes == label)[0]] = 1.0
        branch_quality: list[float] = []
        for matrix in matrices:
            mean = np.mean(matrix, axis=0)
            scale = np.std(matrix, axis=0)
            scale[scale < 1e-12] = 1.0
            normalized = (matrix - mean) / scale
            augmented = np.column_stack([np.ones(len(normalized)), normalized])
            regularizer = self.ridge * np.eye(augmented.shape[1])
            regularizer[0, 0] = 0.0
            head = np.linalg.solve(augmented.T @ augmented + regularizer, augmented.T @ targets)
            self._heads.append(head)
            self._means.append(mean)
            self._scales.append(scale)
            logits = augmented @ head
            probabilities = np.exp(logits - np.max(logits, axis=1, keepdims=True))
            probabilities /= np.sum(probabilities, axis=1, keepdims=True)
            brier = float(np.mean(np.sum((probabilities - targets) ** 2, axis=1)))
            branch_quality.append(1.0 / max(brier, 1e-12))
        quality = np.asarray(branch_quality, dtype=float)
        self._gate_weights = quality / np.sum(quality)
        self.classes_ = classes
        self.status = "TRAINED_BASELINE"
        return self

    def predict(self, feature: HybridFeatureSet, *,
                branches: Sequence[str] | None = None) -> dict[str, Any]:
        if self.status != "TRAINED_BASELINE" or self._heads is None or self.classes_ is None:
            return {"status": "NOT_TRAINED", "sample_id": feature.sample_id,
                    "model_version": self.MODEL_VERSION}
        branch_names = ("engineering", "raw", "time_frequency")
        selected = set(branch_names if branches is None else branches)
        if not selected or not selected.issubset(branch_names):
            raise ModelInputError("branches must select engineering, raw and/or time_frequency")
        vectors = [feature.engineering, feature.raw, feature.time_frequency]
        logits = []
        for vector, mean, scale, head in zip(vectors, self._means, self._scales, self._heads):
            normalized = (vector - mean) / scale
            logits.append(np.r_[1.0, normalized] @ head)
        branch_logits = np.stack(logits)
        selected_indexes = [index for index, name in enumerate(branch_names) if name in selected]
        weights = self._gate_weights[selected_indexes]
        weights = weights / np.sum(weights)
        fused = np.sum(branch_logits[selected_indexes] * weights[:, None], axis=0)
        probabilities = np.exp(fused - np.max(fused))
        probabilities /= np.sum(probabilities)
        entropy = -float(np.sum(probabilities * np.log(np.clip(probabilities, 1e-12, 1.0))))
        winner = int(np.argmax(probabilities))
        return {
            "status": "INFERRED_BASELINE",
            "sample_id": feature.sample_id,
            "model_version": self.MODEL_VERSION,
            "fault_class": str(self.classes_[winner]),
            "confidence": float(probabilities[winner]),
            "class_probabilities": {str(name): float(probability)
                                    for name, probability in zip(self.classes_, probabilities)},
            "uncertainty": {"entropy": entropy, "max_entropy": float(np.log(self.classes_.size))},
            "branch_contributions": {name: float(np.max(values)) for name, values in
                                     zip(branch_names, branch_logits) if name in selected},
            "gate_weights": {branch_names[index]: float(weight)
                             for index, weight in zip(selected_indexes, weights)},
        }
