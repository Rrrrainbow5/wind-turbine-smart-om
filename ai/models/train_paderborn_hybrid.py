"""CPU experiment CLI for the actual three-branch hybrid, not a deployment API."""
from __future__ import annotations

import argparse
import csv
import json
import platform
from pathlib import Path

import numpy as np
import scipy
import torch
import xgboost

from ai.signal_pipeline.paderborn import file_sha256, load_paderborn_sample
from .evaluation import _metrics
from .paderborn_experiment import CONFIGURATIONS, bearing_folds, select_samples, verify_sample
from .neural_hybrid import BRANCHES, FEATURE_VERSION, MODEL_VERSION, SavedHybridPredictor, fit_predict, fuse, prepare_windows


def run(manifest: Path, raw_root: Path, *, epochs: int, seed: int, artifact_dir: Path | None = None):
    with manifest.open(encoding="utf-8-sig", newline="") as stream:
        rows, excluded = select_samples(list(csv.DictReader(stream)))
    folds = bearing_folds(rows, seed)
    inputs = [[], [], []]
    for i, row in enumerate(rows):
        sample = load_paderborn_sample(raw_root / row["bearing_code"] / Path(row["source_path"]).name,
                                      expected_sha256=row["source_sha256"])
        verify_sample(row, sample)
        values = prepare_windows(np.stack([sample.channels[name] for name in
                                           ("vibration_1", "phase_current_1", "phase_current_2")]))
        for target, value in zip(inputs, values):
            target.append(value)
        if (i + 1) % 20 == 0 or i + 1 == len(rows):
            print(f"Prepared {i + 1}/{len(rows)} measurements", flush=True)
    arrays = [np.stack(value) for value in inputs]
    classes = sorted({row["fault_label"] for row in rows})
    labels = np.array([classes.index(row["fault_label"]) for row in rows])
    count = arrays[0].shape[1]
    pooled = {name: np.zeros((len(rows), len(classes))) for name in CONFIGURATIONS}
    predictions, fold_reports = [None] * len(rows), []
    for fold, (train, test) in enumerate(folds, start=1):
        print(f"Training fold {fold}/2: {len(train) * count} windows; {epochs} epochs", flush=True)
        train_inputs = [a[train].reshape(-1, *a.shape[2:]) for a in arrays]
        test_inputs = [a[test].reshape(-1, *a.shape[2:]) for a in arrays]
        probs, weights, details, models = fit_predict(
            train_inputs, np.repeat(labels[train], count), test_inputs,
            classes=len(classes), epochs=epochs, seed=seed + fold)
        reports = {}
        for name, branches in CONFIGURATIONS.items():
            window_probs = fuse(probs, weights, [BRANCHES.index(b) for b in branches])
            sample_probs = window_probs.reshape(len(test), count, -1).mean(axis=1)
            pooled[name][test] = sample_probs
            reports[name] = _metrics([classes[i] for i in labels[test]], sample_probs, classes)
        mean_weights = weights.reshape(len(test), count, 3).mean(axis=1)
        for j, i in enumerate(test):
            p = pooled["hybrid"][i]
            predictions[i] = {"sample_id": rows[i]["sample_id"], "fold": fold,
                              "data_origin": "EXTERNAL_PUBLIC", "status": "INFERRED_EXPERIMENTAL",
                              "source_sha256": rows[i]["source_sha256"], "split_group": rows[i]["split_group"],
                              "model_version": MODEL_VERSION, "true_label": classes[labels[i]],
                              "fault_class": classes[int(p.argmax())], "confidence": float(p.max()),
                              "class_probabilities": dict(zip(classes, map(float, p))),
                              "uncertainty": {"entropy": float(-np.sum(p * np.log(np.maximum(p, 1e-12)))),
                                              "max_entropy": float(np.log(len(classes)))},
                              "gate_weights": dict(zip(BRANCHES, map(float, mean_weights[j]))),
                              "window_count": count}
        artifacts = []
        if artifact_dir is not None:
            folder = artifact_dir / f"fold-{fold}"
            folder.mkdir(parents=True, exist_ok=True)
            tree_path, neural_path = folder / "engineering.ubj", folder / "networks.pt"
            models[0].save_model(tree_path)
            torch.save({"model_version": MODEL_VERSION, "feature_version": FEATURE_VERSION,
                        "classes": classes, "normalizers": details["normalizers"],
                        "raw_state_dict": models[1].state_dict(), "tf_state_dict": models[2].state_dict(),
                        "gate_state_dict": models[3].state_dict()}, neural_path)
            artifacts = [{"file": f"fold-{fold}/{p.name}", "sha256": file_sha256(p)} for p in (tree_path, neural_path)]
            # Verify that persisted weights reproduce a held-out source's prediction.
            row = rows[test[0]]
            source = load_paderborn_sample(raw_root / row["bearing_code"] / Path(row["source_path"]).name,
                                           expected_sha256=row["source_sha256"])
            restored = SavedHybridPredictor(folder).predict(source)
            if not np.allclose([restored["class_probabilities"][c] for c in classes],
                               pooled["hybrid"][test[0]], atol=1e-6):
                raise RuntimeError("saved artifact inference does not reproduce held-out prediction")
            details["artifact_roundtrip_verified_sample_id"] = source.sample_id
        fold_reports.append({"fold": fold, "seed": seed + fold,
                             "train_bearings": sorted({rows[i]["bearing_code"] for i in train}),
                             "test_bearings": sorted({rows[i]["bearing_code"] for i in test}),
                             "train_sample_ids": [rows[i]["sample_id"] for i in train],
                             "test_sample_ids": [rows[i]["sample_id"] for i in test],
                             "metrics": reports["hybrid"], "ablations": reports,
                             "training": details, "artifacts": artifacts})
        print(f"Fold {fold} Macro-F1: {reports['hybrid']['macro_f1']:.4f}", flush=True)
    truth = [row["fault_label"] for row in rows]
    return {"schema_version": "neural-hybrid-evaluation.v0.2", "model_version": MODEL_VERSION,
            "feature_version": FEATURE_VERSION, "data_origin": "EXTERNAL_PUBLIC",
            "manifest_sha256": file_sha256(manifest), "random_seed": seed,
            "runtime": {"python": platform.python_version(), "numpy": np.__version__,
                        "scipy": scipy.__version__, "torch": torch.__version__, "xgboost": xgboost.__version__},
            "sample_count": len(rows), "excluded": excluded,
            "protocol": "two complementary physical-bearing holdouts; average 8 window predictions per source sample",
            "processing": {"channels": ["vibration_1", "phase_current_1", "phase_current_2"],
                           "sampling_rate_hz": 64000, "window_samples": 4096, "windows_per_sample": count,
                           "window_selection": "8 evenly spaced disjoint segments; no waveform downsampling",
                           "preprocessing": "linear detrend each channel/window; train-only per-channel scaling for CNNs",
                           "stft": {"window": "hann", "nperseg": 128, "noverlap": 64, "power": "log1p(abs(STFT)**2)"},
                           "engineering": "8 statistics and 16 log power bands per channel; 72 features",
                           "optimizer": "CNN Adam lr=0.001 batch=32; gate Adam lr=0.01 full-batch 100 steps",
                           "calibration": "none; confidence is an uncalibrated model score"},
            "metrics": _metrics(truth, pooled["hybrid"], classes),
            "ablations": {name: _metrics(truth, p, classes) for name, p in pooled.items()},
            "folds": fold_reports, "predictions": predictions,
            "limitations": ["Only two bearings per class, one laboratory operating condition; not wind-turbine field validation.",
                            "No independent validation/calibration bearings; fixed hyperparameters, no test-guided selection.",
                            "Gate fits in-sample branch scores and can overfit; requires inner grouped OOF training with more bearings.",
                            "CNNs see 8 short segments, not the entire waveform; short STFT has limited frequency resolution.",
                            "Whole source timebases may be resampled by the audited adapter; 5 gap records are excluded.",
                            "No turbine/event chronology is available; grouping uses physical bearing as the strongest available identity.",
                            "Two complementary folds are not independent; no confidence interval or diagnostic readiness claim.",
                            "Saved fold models are research artifacts, not a final all-data deployment model."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("docs/data/signal-sample-manifest.csv"))
    parser.add_argument("--raw-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--artifact-dir", type=Path)
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    if args.epochs < 1:
        parser.error("epochs must be positive")
    report = run(args.manifest, args.raw_root, epochs=args.epochs, seed=args.seed, artifact_dir=args.artifact_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"macro_f1": report["metrics"]["macro_f1"], "accuracy": report["metrics"]["accuracy"]}))


if __name__ == "__main__":
    main()
