"""Experimental XGBoost + 1D CNN + STFT CNN; no production/calibration claim."""

from __future__ import annotations

from pathlib import Path
import numpy as np
import torch
from torch import nn
from scipy import signal
from xgboost import XGBClassifier

from .hybrid import ModelInputError

MODEL_VERSION = "xgb-cnn1d-stftcnn-gate-v0.2-experimental"
FEATURE_VERSION = "synchronous-3ch-4096-stft128-v1"
BRANCHES = ("engineering", "raw", "time_frequency")


def prepare_windows(channels: np.ndarray, *, width: int = 4096, count: int = 8) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Deterministic disjoint segments; no waveform decimation/interpolation.

    Input is three synchronous channels already on the adapter's 64 kHz grid.
    Return engineering vectors, full-rate raw windows, and log power STFT images.
    """
    x = np.asarray(channels, dtype=np.float64)
    if x.ndim != 2 or x.shape[0] != 3 or not np.isfinite(x).all():
        raise ModelInputError("expected three finite synchronous channels")
    if width < 256 or count < 1 or x.shape[1] < width * count:
        raise ModelInputError("insufficient disjoint waveform windows")
    starts = np.linspace(0, x.shape[1] - width, count, dtype=int)
    raw = np.stack([signal.detrend(x[:, start:start + width], axis=-1) for start in starts])
    std = raw.std(axis=-1)
    safe = np.maximum(std, 1e-12)
    rms = np.sqrt(np.mean(raw ** 2, axis=-1))
    peak = np.max(np.abs(raw), axis=-1)
    stats = [raw.mean(axis=-1), raw.var(axis=-1), std, rms,
             np.mean((raw / safe[..., None]) ** 3, axis=-1),
             np.mean((raw / safe[..., None]) ** 4, axis=-1),
             np.ptp(raw, axis=-1), peak / np.maximum(rms, 1e-12)]
    spectrum = np.abs(np.fft.rfft(raw * np.hanning(width), axis=-1)) ** 2
    # 16 absolute log-power bands per channel; no invented bearing-defect Hz values.
    bands = [np.log1p(part.mean(axis=-1)) for part in np.array_split(spectrum, 16, axis=-1)]
    engineering = np.stack(stats + bands, axis=-1).reshape(count, -1)
    _, _, stft = signal.stft(raw, fs=64000, window="hann", nperseg=128,
                             noverlap=64, boundary=None, padded=False, axis=-1)
    images = np.log1p(np.abs(stft) ** 2)
    return engineering.astype("float32"), raw.astype("float32"), images.astype("float32")


class WaveformCNN(nn.Module):
    def __init__(self, classes: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv1d(3, 12, 17, stride=4, padding=8), nn.ReLU(),
            nn.Conv1d(12, 24, 9, stride=4, padding=4), nn.ReLU(),
            nn.Conv1d(24, 32, 5, stride=2, padding=2), nn.ReLU(),
            nn.AdaptiveAvgPool1d(1), nn.Flatten(), nn.Linear(32, classes))

    def forward(self, x):
        return self.net(x)


class TimeFrequencyCNN(nn.Module):
    def __init__(self, classes: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(3, 12, 3, padding=1), nn.ReLU(), nn.AvgPool2d(2),
            nn.Conv2d(12, 24, 3, padding=1), nn.ReLU(), nn.AvgPool2d(2),
            nn.Conv2d(24, 32, 3, padding=1), nn.ReLU(),
            nn.AdaptiveAvgPool2d(1), nn.Flatten(), nn.Linear(32, classes))

    def forward(self, x):
        return self.net(x)


def normalized_train_test(train: np.ndarray, test: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Per-channel scale fitted solely on training windows, shared across records."""
    axes = (0, *range(2, train.ndim))
    mean = train.mean(axis=axes, keepdims=True)
    scale = np.maximum(train.std(axis=axes, keepdims=True), 1e-8)
    return ((train - mean) / scale).astype("float32"), ((test - mean) / scale).astype("float32"), mean, scale


def train_cnn(model: nn.Module, train: np.ndarray, labels: np.ndarray, test: np.ndarray,
              *, epochs: int, seed: int) -> tuple[np.ndarray, np.ndarray, list[float]]:
    x, y = torch.from_numpy(train), torch.from_numpy(labels.astype("int64"))
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    generator = torch.Generator().manual_seed(seed)
    class_counts = np.bincount(labels)
    loss_fn = nn.CrossEntropyLoss(weight=torch.tensor(len(labels) / (len(class_counts) * class_counts), dtype=torch.float32))
    history = []
    for _ in range(epochs):
        model.train()
        order = torch.randperm(len(x), generator=generator)
        total = 0.0
        for batch in order.split(32):
            optimizer.zero_grad()
            loss = loss_fn(model(x[batch]), y[batch])
            loss.backward()
            optimizer.step()
            total += float(loss.detach()) * len(batch)
        history.append(total / len(x))
    model.eval()
    def predict(values):
        with torch.no_grad():
            return torch.cat([model(batch).softmax(-1) for batch in torch.from_numpy(values).split(32)]).numpy()
    return predict(train), predict(test), history


def fit_predict(train_inputs, train_labels, test_inputs, *, classes: int, epochs: int = 12, seed: int = 7):
    """Train branches and an input-dependent softmax gate, never using test labels.

    Gate training uses in-sample branch predictions: optimistic and explicitly
    experimental until more physical bearings enable inner grouped validation.
    """
    if epochs < 1 or classes < 2 or set(np.unique(train_labels)) != set(range(classes)):
        raise ModelInputError("positive epochs and all training classes required")
    torch.manual_seed(seed)
    torch.set_num_threads(2)
    torch.use_deterministic_algorithms(True)
    tree = XGBClassifier(n_estimators=80, max_depth=3, learning_rate=.05,
                         objective="multi:softprob", num_class=classes,
                         tree_method="hist", n_jobs=2, random_state=seed)
    counts = np.bincount(train_labels)
    tree.fit(train_inputs[0], train_labels, sample_weight=len(train_labels) / (classes * counts[train_labels]))
    train_probs, test_probs = [tree.predict_proba(train_inputs[0])], [tree.predict_proba(test_inputs[0])]
    histories, normalizers, networks = {}, {}, []
    for name, index, model in (("raw", 1, WaveformCNN(classes)), ("time_frequency", 2, TimeFrequencyCNN(classes))):
        train, test, mean, scale = normalized_train_test(train_inputs[index], test_inputs[index])
        tr, te, history = train_cnn(model, train, train_labels, test, epochs=epochs, seed=seed)
        train_probs.append(tr)
        test_probs.append(te)
        histories[name] = history
        normalizers[name] = {"mean": mean.tolist(), "scale": scale.tolist()}
        networks.append(model)
    train_tensor = torch.tensor(np.stack(train_probs, axis=1))
    test_tensor = torch.tensor(np.stack(test_probs, axis=1))
    gate = nn.Sequential(nn.Linear(3 * classes, 12), nn.ReLU(), nn.Linear(12, 3))
    optimizer = torch.optim.Adam(gate.parameters(), lr=.01)
    truth = torch.tensor(train_labels, dtype=torch.long)
    for _ in range(100):
        optimizer.zero_grad()
        weights = gate(train_tensor.flatten(1)).softmax(-1)
        fused = (weights[..., None] * train_tensor).sum(1)
        loss = nn.functional.nll_loss(fused.clamp_min(1e-8).log(), truth)
        loss.backward()
        optimizer.step()
    with torch.no_grad():
        weights = gate(test_tensor.flatten(1)).softmax(-1).numpy()
    return np.stack(test_probs, axis=1), weights, {
        "training_loss": histories, "normalizers": normalizers,
        "gate_training": "in-sample branch predictions; no independent calibration",
        "epochs": epochs, "xgboost": {"n_estimators": 80, "max_depth": 3, "learning_rate": .05},
    }, (tree, *networks, gate)


def fuse(probabilities: np.ndarray, weights: np.ndarray, selected=(0, 1, 2)) -> np.ndarray:
    selected = list(selected)
    if not selected or len(set(selected)) != len(selected) or any(i not in (0, 1, 2) for i in selected):
        raise ModelInputError("invalid fusion branches")
    w = weights[:, selected]
    w = w / np.maximum(w.sum(axis=1, keepdims=True), 1e-12)
    return np.sum(probabilities[:, selected] * w[..., None], axis=1)


class SavedHybridPredictor:
    """Reload a local fold artifact for research inference, not field diagnosis."""

    def __init__(self, folder: str | Path):
        folder = Path(folder)
        checkpoint = torch.load(folder / "networks.pt", map_location="cpu", weights_only=True)
        if checkpoint["model_version"] != MODEL_VERSION or checkpoint["feature_version"] != FEATURE_VERSION:
            raise ModelInputError("incompatible saved model/feature version")
        self.classes = checkpoint["classes"]
        self.normalizers = checkpoint["normalizers"]
        self.tree = XGBClassifier()
        self.tree.load_model(folder / "engineering.ubj")
        self.raw = WaveformCNN(len(self.classes))
        self.tf = TimeFrequencyCNN(len(self.classes))
        self.gate = nn.Sequential(nn.Linear(3 * len(self.classes), 12), nn.ReLU(), nn.Linear(12, 3))
        for model, key in ((self.raw, "raw_state_dict"), (self.tf, "tf_state_dict"), (self.gate, "gate_state_dict")):
            model.load_state_dict(checkpoint[key])
            model.eval()

    def predict(self, sample) -> dict:
        if sample.data_origin != "EXTERNAL_PUBLIC" or sample.source_gap_count:
            raise ModelInputError("predictor requires audited public data without source gaps")
        if sample.sampling_rate_hz != 64000 or not sample.sample_id or not sample.source_sha256:
            raise ModelInputError("predictor requires source identity and the audited 64000 Hz grid")
        engineering, raw, image = prepare_windows(np.stack([sample.channels[name] for name in
                                                           ("vibration_1", "phase_current_1", "phase_current_2")]))
        probabilities = [self.tree.predict_proba(engineering)]
        with torch.no_grad():
            for name, data, model in (("raw", raw, self.raw), ("time_frequency", image, self.tf)):
                norm = self.normalizers[name]
                data = ((data - np.asarray(norm["mean"])) / np.asarray(norm["scale"])).astype("float32")
                probabilities.append(model(torch.from_numpy(data)).softmax(-1).numpy())
            probabilities = np.stack(probabilities, axis=1)
            weights = self.gate(torch.tensor(probabilities).flatten(1)).softmax(-1).numpy()
        p = fuse(probabilities, weights).mean(0)
        return {"sample_id": sample.sample_id, "data_origin": sample.data_origin,
                "source_sha256": sample.source_sha256, "status": "INFERRED_EXPERIMENTAL",
                "model_version": MODEL_VERSION, "feature_version": FEATURE_VERSION,
                "fault_class": self.classes[int(p.argmax())], "confidence": float(p.max()),
                "class_probabilities": dict(zip(self.classes, map(float, p))),
                "uncertainty": {"entropy": float(-np.sum(p * np.log(np.maximum(p, 1e-12))))},
                "gate_weights": dict(zip(BRANCHES, map(float, weights.mean(0)))),
                "component_key": None, "component_mapping_status": "UNMAPPED",
                "warning": "Uncalibrated laboratory research model; not a maintenance decision."}
