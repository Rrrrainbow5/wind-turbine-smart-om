"""Reproducible real-data evaluation of the explicitly labelled NumPy baseline.

No random window split, hyperparameter search or test-set calibration is used.
Run with --help; raw licensed waveforms are never written into the report.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import platform
from typing import Any, Sequence

import numpy as np

from ai.signal_pipeline.paderborn import file_sha256, load_paderborn_sample
from .evaluation import _aligned_probabilities, _metrics
from .hybrid import HybridDiagnosticModel, ModelInputError, SignalRecord, extract_features


CONFIGURATIONS = {
    "hybrid": ("engineering", "raw", "time_frequency"),
    "engineering_only": ("engineering",),
    "raw_only": ("raw",),
    "time_frequency_only": ("time_frequency",),
    "without_engineering": ("raw", "time_frequency"),
    "without_raw": ("engineering", "time_frequency"),
    "without_time_frequency": ("engineering", "raw"),
}


def select_samples(rows: Sequence[dict[str, str]]) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """Fail closed on mixed origins, duplicates, or unrecognized timebase audits."""
    included, excluded = [], []
    seen: set[str] = set()
    for row in rows:
        sample_id = row["sample_id"]
        if not sample_id or sample_id in seen:
            raise ModelInputError("empty or duplicate sample_id in manifest")
        seen.add(sample_id)
        if row["data_origin"] != "EXTERNAL_PUBLIC" or row["dataset"] != "Paderborn Bearing Data Center":
            raise ModelInputError("experiment requires exclusively EXTERNAL_PUBLIC Paderborn data")
        flag = row["timebase_processing"]
        if flag == "SOURCE_TIMEBASE_GAP_RESAMPLED" or int(row["source_gap_count"]) > 0:
            excluded.append({"sample_id": sample_id, "reason": "source_timebase_gap"})
        elif flag in {"UNCHANGED_UNIFORM_64000_HZ", "RESAMPLED_TO_UNIFORM_64000_HZ"}:
            included.append(row)
        else:
            raise ModelInputError("unrecognized timebase audit")
    return included, excluded


def bearing_folds(rows: Sequence[dict[str, str]], seed: int = 7) -> list[tuple[list[int], list[int]]]:
    """Two complementary folds: exactly two physical bearings per class required."""
    groups: dict[str, str] = {}
    for row in rows:
        group, label = row["split_group"], row["fault_label"]
        if group != f"paderborn-bearing-{row['bearing_code'].lower()}":
            raise ModelInputError("split_group must identify the physical bearing")
        if group in groups and groups[group] != label:
            raise ModelInputError("physical bearing has conflicting labels")
        groups[group] = label
    if len(set(groups.values())) < 2:
        raise ModelInputError("at least two classes required")
    rng = np.random.default_rng(seed)
    first_test = set()
    for label in sorted(set(groups.values())):
        candidates = sorted(group for group, value in groups.items() if value == label)
        if len(candidates) != 2:
            raise ModelInputError("two-fold protocol requires exactly two bearings per class")
        first_test.add(candidates[int(rng.integers(2))])
    folds = []
    for test_groups in (first_test, set(groups) - first_test):
        test = [i for i, row in enumerate(rows) if row["split_group"] in test_groups]
        train = [i for i, row in enumerate(rows) if row["split_group"] not in test_groups]
        folds.append((train, test))
    return folds


def verify_sample(row: dict[str, str], sample: Any) -> None:
    """The manifest cannot silently relabel a loaded source measurement."""
    for name in ("sample_id", "bearing_code", "fault_label", "split_group", "data_origin", "source_sha256"):
        if row[name] != getattr(sample, name):
            raise ModelInputError(f"manifest/source mismatch: {name}")
    if float(row["sampling_rate_hz"]) != sample.sampling_rate_hz or sample.source_gap_count:
        raise ModelInputError("sampling rate or gap audit mismatch")


def run_experiment(manifest: Path, raw_root: Path, *, seed: int = 7) -> dict[str, Any]:
    import scipy

    manifest_hash = file_sha256(manifest)
    with manifest.open(encoding="utf-8-sig", newline="") as stream:
        rows, excluded = select_samples(list(csv.DictReader(stream)))
    folds = bearing_folds(rows, seed)
    features, records = [], []
    for i, row in enumerate(rows):
        # Only the two final path elements may address the separately supplied raw root.
        source = raw_root / row["bearing_code"] / Path(row["source_path"]).name
        sample = load_paderborn_sample(source, expected_sha256=row["source_sha256"])
        verify_sample(row, sample)
        record = SignalRecord(sample.sample_id, sample.split_group, sample.split_group,
                              "unknown-source-time", sample.sampling_rate_hz,
                              sample.channels["vibration_1"], sample.channels["phase_current_1"])
        features.append(extract_features(record))
        # fit() needs identity only; avoid retaining all large source arrays in RAM.
        records.append(SignalRecord(record.sample_id, record.turbine_id, record.event_id,
                                    record.timestamp, record.sampling_rate_hz,
                                    record.vibration[:16].copy(), record.current[:16].copy()))
        if (i + 1) % 20 == 0 or i + 1 == len(rows):
            print(f"Extracted {i + 1}/{len(rows)} verified measurements", flush=True)
    labels = [row["fault_label"] for row in rows]
    classes = sorted(set(labels))
    predictions: list[dict[str, Any] | None] = [None] * len(rows)
    pooled = {name: np.zeros((len(rows), len(classes))) for name in CONFIGURATIONS}
    fold_reports = []
    for fold_id, (train, test) in enumerate(folds, start=1):
        model = HybridDiagnosticModel().fit([features[i] for i in train],
                                          [labels[i] for i in train], [records[i] for i in train])
        reports = {}
        for name, branches in CONFIGURATIONS.items():
            results = [model.predict(features[i], branches=branches) for i in test]
            probabilities = np.stack([_aligned_probabilities(result, classes) for result in results])
            pooled[name][test] = probabilities
            reports[name] = _metrics([labels[i] for i in test], probabilities, classes)
            if name == "hybrid":
                for i, result in zip(test, results):
                    predictions[i] = {**result, "fold": fold_id, "true_label": labels[i],
                                      "split_group": rows[i]["split_group"],
                                      "source_sha256": rows[i]["source_sha256"],
                                      "data_origin": rows[i]["data_origin"]}
        fold_reports.append({
            "fold": fold_id,
            "train_bearings": sorted({rows[i]["bearing_code"] for i in train}),
            "test_bearings": sorted({rows[i]["bearing_code"] for i in test}),
            "train_sample_ids": [rows[i]["sample_id"] for i in train],
            "test_sample_ids": [rows[i]["sample_id"] for i in test],
            "metrics": reports["hybrid"], "ablations": reports,
        })
    return {
        "schema_version": "paderborn-bearing-evaluation.v0.2",
        "model_version": HybridDiagnosticModel.MODEL_VERSION,
        "feature_version": "hybrid-contract-features-v0.2",
        "backend": "numpy_baseline", "random_seed": seed,
        "runtime": {"python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__},
        "manifest_sha256": manifest_hash, "data_origin": "EXTERNAL_PUBLIC",
        "sample_count": len(rows), "excluded": excluded,
        "protocol": "two complementary stratified physical-bearing holdouts; one prediction per source record",
        "processing": {"source_hash_verified": True, "timebase": "adapter uniform nominal 64000 Hz",
                       "channels_used": ["vibration_1", "phase_current_1"],
                       "channels_not_used": ["phase_current_2"],
                       "window": "entire record; no overlapping training windows",
                       "engineering": "9 raw statistics plus top 3 demeaned FFT peaks per channel",
                       "raw": "128 interpolated standardized points per channel (not anti-aliased decimation)",
                       "time_frequency": "64-point Hann STFT, log magnitude, sampled flattened vector; vibration only",
                       "normalization": "branch mean/std fitted on training fold only",
                       "ridge": 1.0, "gating": "inverse training Brier; not independently calibrated"},
        "metrics": _metrics(labels, pooled["hybrid"], classes),
        "ablations": {name: _metrics(labels, values, classes) for name, values in pooled.items()},
        "folds": fold_reports, "predictions": predictions,
        "limitations": [
            "NumPy ridge heads, NOT XGBoost, 1D CNN/TCN or time-frequency CNN.",
            "Only two physical bearings per class and one operating condition; exploratory, not field validation.",
            "Complementary folds are not independent experiments; pooled scores have no claimed confidence interval.",
            "No independent validation/calibration set; scores are uncalibrated and gates use training error.",
            "Paderborn laboratory bearings are not a wind-turbine field dataset; no turbine/event chronology available.",
            "No final deployment model is fitted or exported; all predictions are held-out baseline predictions.",
            "Raw interpolation and flattened STFT are contract features, not production neural preprocessing.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("docs/data/signal-sample-manifest.csv"))
    parser.add_argument("--raw-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    report = run_experiment(args.manifest, args.raw_root, seed=args.seed)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"samples": report["sample_count"], "excluded": len(report["excluded"]),
                      "macro_f1": report["metrics"]["macro_f1"], "output": str(args.output)}))


if __name__ == "__main__":
    main()
