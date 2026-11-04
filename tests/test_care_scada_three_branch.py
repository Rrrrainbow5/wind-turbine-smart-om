import numpy as np
import torch

from ai.care_scada_three_branch import CLASSES, Gate, Temporal, fit_gate, relations, weights_for


def test_relations_are_scale_and_offset_invariant_and_finite():
    x = np.random.default_rng(4).normal(size=(3, 36, 4)).astype(np.float32)
    np.testing.assert_allclose(relations(x), relations(x * 3 + 20), atol=1e-5)
    assert np.isfinite(relations(np.zeros_like(x))).all()
    assert relations(x).shape == (3, 6)


def test_weights_balance_classes_and_events():
    y = np.array([0, 0, 0, 1])
    events = np.array([10, 10, 11, 12])
    w = weights_for(y, events)
    np.testing.assert_allclose(w[y == 0].sum(), w[y == 1].sum())
    np.testing.assert_allclose(w[events == 10].sum(), w[events == 11].sum())


def test_gate_uses_probabilities_and_discloses_impossible_targets():
    p = np.zeros((4, 3, len(CLASSES)), dtype=np.float32)
    p[:, :, 0] = .8
    p[:, :, 1] = .2
    gate, excluded = fit_gate(p, np.array([0, 1, 0, 2]), np.arange(4), epochs=2)
    assert excluded == 1
    fused, weights = gate(torch.tensor(p))
    np.testing.assert_allclose(fused.detach().numpy(), p.mean(1), atol=1e-6)
    np.testing.assert_allclose(weights.sum(1).detach().numpy(), 1, atol=1e-6)


def test_temporal_checkpoint_roundtrip(tmp_path):
    torch.manual_seed(3)
    model = Temporal(4, len(CLASSES)).eval()
    x = torch.randn(2, 36, 4)
    path = tmp_path / 'weights.pt'
    torch.save(model.state_dict(), path)
    restored = Temporal(4, len(CLASSES)).eval()
    restored.load_state_dict(torch.load(path, weights_only=True))
    torch.testing.assert_close(model(x), restored(x))
