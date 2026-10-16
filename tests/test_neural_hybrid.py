"""Optional training-runtime tests; normal API CI need not download PyTorch."""
import numpy as np
import pytest

pytest.importorskip("torch")
pytest.importorskip("xgboost")
pytest.importorskip("scipy.signal")

from ai.models.hybrid import ModelInputError
from ai.models.neural_hybrid import (
    SavedHybridPredictor, WaveformCNN, TimeFrequencyCNN, fit_predict, fuse, normalized_train_test, prepare_windows,
)
import torch
from types import SimpleNamespace


def test_synchronous_segments_and_stft_shapes():
    x = np.random.default_rng(2).normal(size=(3, 4096 * 8))
    x[1] = x[0]
    engineering, raw, image = prepare_windows(x)
    assert engineering.shape == (8, 72)
    assert raw.shape == (8, 3, 4096)
    assert image.shape == (8, 3, 65, 63)
    assert all(np.isfinite(a).all() for a in (engineering, raw, image))
    assert np.allclose(raw[:, 0], raw[:, 1])
    for bad in (x[:2], x[:, :100], x * np.nan):
        with pytest.raises(ModelInputError):
            prepare_windows(bad)


def test_normalization_uses_only_training_channels():
    train = np.arange(48, dtype="float32").reshape(4, 3, 4)
    test = train + 1000
    a, b, mean, scale = normalized_train_test(train, test)
    assert np.allclose(a.mean(axis=(0, 2)), 0, atol=1e-6)
    assert np.all(b.mean(axis=(0, 2)) > 50)
    assert np.allclose(mean, train.mean(axis=(0, 2), keepdims=True))


def test_cnn_logits_and_ablation_probability_conservation():
    assert WaveformCNN(3)(torch.zeros(2, 3, 4096)).shape == (2, 3)
    assert TimeFrequencyCNN(3)(torch.zeros(2, 3, 65, 63)).shape == (2, 3)
    p = np.array([[[.9, .1], [.2, .8], [.4, .6]]])
    w = np.array([[.2, .3, .5]])
    assert np.allclose(fuse(p, w).sum(axis=1), 1)
    assert np.allclose(fuse(p, w, (1,)), p[:, 1])
    with pytest.raises(ModelInputError):
        fuse(p, w, ())


def test_actual_training_smoke_and_seed_reproducibility():
    rng = np.random.default_rng(7)
    inputs = (rng.normal(size=(6, 72)).astype("float32"),
              rng.normal(size=(6, 3, 256)).astype("float32"),
              rng.normal(size=(6, 3, 16, 16)).astype("float32"))
    test = tuple(x[:2].copy() for x in inputs)
    labels = np.array([0, 1, 2, 0, 1, 2])
    p, w, details, models = fit_predict(inputs, labels, test, classes=3, epochs=1)
    p2, w2, _, _ = fit_predict(inputs, labels, test, classes=3, epochs=1)
    assert p.shape == (2, 3, 3) and w.shape == (2, 3)
    assert np.allclose(p.sum(-1), 1) and np.allclose(w.sum(-1), 1)
    assert np.allclose(p, p2) and np.allclose(w, w2)
    assert len(details["training_loss"]["raw"]) == 1
    assert len(models) == 4


def test_saved_predictor_rejects_unaudited_origin_rate_and_gaps_before_inference():
    predictor = SavedHybridPredictor.__new__(SavedHybridPredictor)
    values = dict(data_origin="EXTERNAL_PUBLIC", source_gap_count=0, sampling_rate_hz=64000,
                  sample_id="source-1", source_sha256="a" * 64)
    for change in ({"data_origin": "SIMULATED"}, {"source_gap_count": 1},
                   {"sampling_rate_hz": 100}, {"sample_id": ""}):
        with pytest.raises(ModelInputError):
            predictor.predict(SimpleNamespace(**(values | change)))
