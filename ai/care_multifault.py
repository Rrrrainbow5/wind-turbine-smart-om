"""Reproducible CARE Farm A SCADA baseline and portable tree inference.

Run: python -m ai.care_multifault --farm PATH --output models/care-multifault
No event identifiers, dates, asset identifiers or labels enter model features.
"""
from __future__ import annotations

import argparse
from array import array
import gzip
import hashlib
import json
from pathlib import Path

MODEL_VERSION = "care-scada-rf-v1"
WINDOW_ROWS = 36
LABELS = {
    "": ("healthy", "正常运行", None),
    "Generator bearing failure": ("generator_bearing", "发电机轴承故障", "GENERATOR"),
    "Gearbox failure": ("gearbox", "齿轮箱故障", "GEARBOX"),
    "Hydraulic group": ("hydraulic", "液压系统故障", "HYDRAULIC"),
    "Gearbox bearings damaged": ("gearbox_bearing", "齿轮箱轴承损坏", "GEARBOX_BEARING"),
    "Transformer failure": ("transformer", "变压器故障", "TRANSFORMER"),
}
# Continuous signals with known semantics; omit angles, counters and metadata.
SIGNALS = (
    ["sensor_0_avg", "wind_speed_3_avg", "wind_speed_4_avg", "sensor_5_avg"]
    + [f"sensor_{i}_avg" for i in [*range(6, 27), *range(31, 42)]]
    + ["sensor_43_avg", "sensor_53_avg", "power_29_avg", "power_30_avg"]
)
FEATURE_NAMES = [f"{name}__{stat}" for stat in ("median", "std", "delta") for name in SIGNALS]
TREND_SIGNALS = {
    "healthy": ("power_30_avg", "并网功率", "kW"),
    "generator_bearing": ("sensor_13_avg", "发电机驱动端轴承温度", "°C"),
    "gearbox": ("sensor_12_avg", "齿轮箱油温", "°C"),
    "hydraulic": ("sensor_41_avg", "液压油温", "°C"),
    "gearbox_bearing": ("sensor_11_avg", "齿轮箱高速轴轴承温度", "°C"),
    "transformer": ("sensor_38_avg", "高压变压器 L1 温度", "°C"),
}


def case_trend(block, label: str) -> dict:
    import numpy as np

    signal, name, unit = TREND_SIGNALS[label]
    values = block[signal].to_numpy(dtype=float)
    if not np.isfinite(values).all():
        raise ValueError(f"Missing trend readings for {signal}; do not fabricate a curve")
    return {"trend": values.tolist(), "trend_signal": signal,
            "trend_label": name, "trend_unit": unit}


def refresh_case_trends(farm: Path, output: Path, frontend_export: Path | None = None):
    """Re-export actual case channels without fitting or changing model weights."""
    import pandas as pd

    manifest = json.loads((output / "cases.json").read_text(encoding="utf-8"))
    if sha256(output / "model.json.gz") != manifest["model_sha256"]:
        raise ValueError("Model hash does not match manifest")
    for sample in manifest["cases"]:
        path = farm / "datasets" / f"{sample['event_id']}.csv"
        if sha256(path) != sample["source_sha256"]:
            raise ValueError(f"Source changed for {sample['id']}")
        signal = TREND_SIGNALS[sample["label"]][0]
        frame = pd.read_csv(path, sep=";", usecols=["time_stamp", signal])
        frame["time_stamp"] = pd.to_datetime(frame.time_stamp)
        block = frame.loc[frame.time_stamp.between(sample["start"], sample["end"])].sort_values("time_stamp")
        expected = pd.date_range(sample["start"], periods=WINDOW_ROWS, freq="10min")
        if len(block) != WINDOW_ROWS or list(block.time_stamp) != list(expected):
            raise ValueError(f"Case timestamps do not match source for {sample['id']}")
        sample.update(case_trend(block, sample["label"]))
    text = json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False)
    (output / "cases.json").write_text(text, encoding="utf-8")
    if frontend_export:
        frontend_export.write_text(text, encoding="utf-8")
    print(f"Refreshed {len(manifest['cases'])} source-channel trends; model unchanged")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def window_features(rows: list[dict]) -> list[float | None]:
    """Same feature contract for training and API; time order is validated by caller."""
    import numpy as np

    values = np.array([[row.get(key, float("nan")) for key in SIGNALS] for row in rows], dtype=float)
    values[~np.isfinite(values)] = np.nan
    with np.errstate(all="ignore"):
        features = np.concatenate([
            np.nanmedian(values, axis=0),
            np.nanstd(values, axis=0),
            values[-1] - values[0],
        ])
    return [float(value) if np.isfinite(value) else None for value in features]


def predict_portable(model: dict, features: list[float | None]) -> dict[str, float]:
    """Read a JSON tree ensemble, never deserialize executable pickle objects."""
    if len(features) != len(model["feature_names"]):
        raise ValueError("Feature count does not match model")
    values = array("f", [median if value is None else value for value, median in zip(features, model["medians"])])
    totals = [0.0] * len(model["classes"])
    for tree in model["trees"]:
        node = 0
        while tree["left"][node] != -1:
            node = tree["left"][node] if values[tree["feature"][node]] <= tree["threshold"][node] else tree["right"][node]
        for index, probability in enumerate(tree["value"][node]):
            totals[index] += probability
    return {label: value / len(model["trees"]) for label, value in zip(model["classes"], totals)}


def load_model(path: Path) -> dict:
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        return json.load(stream)


def build_windows(farm: Path) -> tuple[list[dict], list[dict], dict]:
    import numpy as np
    import pandas as pd

    events = pd.read_csv(farm / "event_info.csv", sep=";").fillna("")
    events["start"] = pd.to_datetime(events.event_start)
    events["end"] = pd.to_datetime(events.event_end)
    windows, sources = [], []
    rejected = {"overlapping_labels": 0, "incomplete_windows": 0, "missing_signals": 0}
    for _, event in events.sort_values("event_id").iterrows():
        label, _, _ = LABELS[event.event_description]
        path = farm / "datasets" / f"{event.event_id}.csv"
        frame = pd.read_csv(path, sep=";", usecols=["time_stamp", "train_test", *SIGNALS])
        frame["time_stamp"] = pd.to_datetime(frame.time_stamp)
        # Only explicitly labeled event intervals, never the whole anomalous file.
        frame = frame.loc[
            frame.time_stamp.between(event.start, event.end)
            & frame.train_test.ne("train")
        ].sort_values("time_stamp").drop_duplicates("time_stamp")
        conflicting = events.loc[(events.asset == event.asset) & (events.event_id != event.event_id)]
        for _, other in conflicting.iterrows():
            other_label = LABELS[other.event_description][0]
            if other_label != label:
                overlap = frame.time_stamp.between(other.start, other.end)
                rejected["overlapping_labels"] += int(overlap.sum())
                frame = frame.loc[~overlap]
        for start, block in frame.groupby(frame.time_stamp.dt.floor("6h")):
            expected = pd.date_range(start, periods=WINDOW_ROWS, freq="10min")
            if len(block) != WINDOW_ROWS or not np.array_equal(block.time_stamp.to_numpy(), expected.to_numpy()):
                rejected["incomplete_windows"] += 1
                continue
            if block[SIGNALS].notna().mean().min() < .8:
                rejected["missing_signals"] += 1
                continue
            rows = block[SIGNALS].to_dict("records")
            features = window_features(rows)
            medians = block[SIGNALS].median()
            windows.append({
                "sample_id": f"CARE-A-{event.event_id}-{start.strftime('%Y%m%dT%H%M')}",
                "event_id": int(event.event_id), "asset": int(event.asset), "label": label,
                "description": event.event_description or "Normal operation",
                "start": str(start), "end": str(block.time_stamp.iloc[-1]),
                "event_start": str(event.start), "event_end": str(event.end),
                "features": features,
                "telemetry": {key: float(value) for key, value in medians.items()},
                **case_trend(block, label),
            })
        sources.append({"event_id": int(event.event_id), "asset": int(event.asset),
                        "label": label, "sha256": sha256(path), "file": path.name})
        print(f"Extracted event {event.event_id}: {label}; total windows={len(windows)}", flush=True)
    # Same physical timestamp must not appear twice, even under the same label.
    unique = {(row["asset"], row["start"]): row for row in windows}
    return list(unique.values()), sources, rejected


def prepare(farm: Path, cache: Path | None = None) -> tuple[list[dict], list[dict], dict]:
    if cache and cache.exists():
        payload = json.loads(cache.read_text(encoding="utf-8"))
        if payload["schema"] != 2 or payload["features"] != FEATURE_NAMES or payload["metadata_sha256"] != sha256(farm / "event_info.csv"):
            raise ValueError("Feature cache does not match extraction schema or metadata")
        if any(sha256(farm / "datasets" / source["file"]) != source["sha256"] for source in payload["sources"]):
            raise ValueError("CARE source files changed since feature extraction")
        return payload["rows"], payload["sources"], payload["rejected"]
    rows, sources, rejected = build_windows(farm)
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({
            "schema": 2, "features": FEATURE_NAMES, "metadata_sha256": sha256(farm / "event_info.csv"),
            "rows": rows, "sources": sources, "rejected": rejected,
        }, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    return rows, sources, rejected


def train(farm: Path, output: Path, frontend_export: Path | None = None, cache: Path | None = None) -> dict:
    import numpy as np
    import sklearn
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.impute import SimpleImputer
    from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
    from sklearn.model_selection import LeaveOneGroupOut

    output.mkdir(parents=True, exist_ok=True)
    rows, sources, rejected = prepare(farm, cache)
    x = np.array([[np.nan if value is None else value for value in row["features"]] for row in rows])
    y = np.array([row["label"] for row in rows])
    groups = np.array([row["asset"] for row in rows])
    event_ids = np.array([row["event_id"] for row in rows])
    classes = sorted(set(y))
    config = dict(n_estimators=240, max_depth=12, min_samples_leaf=2,
                  max_features="sqrt", random_state=20261029, n_jobs=4)

    def fit(indices):
        imputer = SimpleImputer(strategy="median", keep_empty_features=True)
        matrix = imputer.fit_transform(x[indices])
        # Equal class contribution, then equal event contribution within each class.
        weights = np.zeros(len(indices))
        for label in classes:
            label_events = set(event_ids[indices][y[indices] == label])
            for event in label_events:
                mask = event_ids[indices] == event
                weights[mask] = 1 / (len(label_events) * mask.sum())
        classifier = RandomForestClassifier(**config).fit(matrix, y[indices], sample_weight=weights)
        return imputer, classifier

    probabilities = np.zeros((len(rows), len(classes)))
    folds = []
    for train_idx, test_idx in LeaveOneGroupOut().split(x, y, groups):
        imputer, classifier = fit(train_idx)
        result = classifier.predict_proba(imputer.transform(x[test_idx]))
        for index, label in enumerate(classifier.classes_):
            probabilities[test_idx, classes.index(label)] = result[:, index]
        folds.append({
            "test_assets": sorted(set(groups[test_idx].tolist())),
            "train_assets": sorted(set(groups[train_idx].tolist())),
            "missing_train_classes": sorted(set(y[test_idx]) - set(y[train_idx])),
            "test_windows": len(test_idx),
        })
        print(f"Completed held-out asset {groups[test_idx][0]}", flush=True)
    predictions = np.array(classes)[probabilities.argmax(axis=1)]
    imputer, classifier = fit(np.arange(len(rows)))
    portable = {
        "model_version": MODEL_VERSION, "classes": classifier.classes_.tolist(),
        "signals": SIGNALS, "feature_names": FEATURE_NAMES,
        "medians": imputer.statistics_.tolist(),
        "trees": [{
            "left": tree.tree_.children_left.tolist(), "right": tree.tree_.children_right.tolist(),
            "feature": tree.tree_.feature.tolist(), "threshold": tree.tree_.threshold.tolist(),
            "value": (tree.tree_.value[:, 0] / tree.tree_.value[:, 0].sum(axis=1, keepdims=True)).tolist(),
        } for tree in classifier.estimators_],
    }
    model_path = output / "model.json.gz"
    with gzip.open(model_path, "wt", encoding="utf-8") as stream:
        json.dump(portable, stream, separators=(",", ":"), allow_nan=False)
    full_probabilities = classifier.predict_proba(imputer.transform(x))
    # Verify portable inference after loading the saved model, including held-out windows.
    loaded = load_model(model_path)
    for index in np.linspace(0, len(rows) - 1, min(40, len(rows)), dtype=int):
        assert np.allclose(list(predict_portable(loaded, rows[index]["features"]).values()),
                           full_probabilities[index], atol=1e-12)
    label_info = {value[0]: {"name": value[1], "category": value[2]} for value in LABELS.values()}
    cases = []
    for event in sorted(set(event_ids)):
        candidates = [index for index, row in enumerate(rows) if row["event_id"] == event]
        # Deterministic midpoint, never select by whether the model was correct.
        index = candidates[len(candidates) // 2]
        row = rows[index]
        label = row["label"]
        independent_assets = sorted({item["asset"] for item in rows if item["label"] == label})
        cases.append({
            "id": f"A-{event}", "sample_id": row["sample_id"], "event_id": int(event),
            "source_asset": row["asset"], "label": label, "name": label_info[label]["name"],
            "category": label_info[label]["category"], "description": row["description"],
            "start": row["start"], "end": row["end"], "row_count": WINDOW_ROWS,
            "source_sha256": next(s["sha256"] for s in sources if s["event_id"] == event),
            "prediction": classifier.classes_[full_probabilities[index].argmax()],
            "probabilities": dict(zip(classifier.classes_, full_probabilities[index].tolist())),
            "held_out_prediction": str(predictions[index]),
            "held_out_probabilities": dict(zip(classes, probabilities[index].tolist())),
            "independent_class_assets": len(independent_assets),
            "validation": "single_asset_replay" if len(independent_assets) < 2 else "asset_held_out_available",
            "features": row["features"], "telemetry": row["telemetry"],
            **{key: row[key] for key in ("trend", "trend_signal", "trend_label", "trend_unit")},
        })
    report = {
        "model_version": MODEL_VERSION, "method": "6h SCADA median/std/endpoint delta + RandomForest",
        "sklearn_version": sklearn.__version__, "config": config,
        "windows": len(rows), "features": len(FEATURE_NAMES), "assets": sorted(set(groups.tolist())),
        "events": len(sources), "classes": label_info, "sources": sources,
        "class_support": {
            label: {
                "windows": int((y == label).sum()),
                "assets": sorted(set(groups[y == label].tolist())),
                "events": sorted(set(event_ids[y == label].tolist())),
            } for label in classes
        },
        "excluded": rejected, "folds": folds,
        "evaluation": {
            "protocol": "leave one physical asset out; train-only imputation; no parameter search",
            "accuracy": accuracy_score(y, predictions),
            "macro_f1": f1_score(y, predictions, labels=classes, average="macro", zero_division=0),
            "per_class": classification_report(y, predictions, labels=classes, output_dict=True, zero_division=0),
            "confusion_labels": classes, "confusion_matrix": confusion_matrix(y, predictions, labels=classes).tolist(),
        },
        "model_sha256": sha256(model_path),
        "limits": [
            "Historical labeled interval classification, not early warning or remaining life estimation.",
            "Transformer and gearbox-bearing each have only one independent asset/event; no validated generalization.",
            "Final model replay includes its training samples; held-out predictions are shown separately.",
            "Farm A only; no claim of transfer to other farms, turbine types or live field units.",
            "Anomaly score = 1 - normal class score; health display = 100 * normal score; not calibrated risk.",
            "Conflicting same-asset event intervals are excluded from both labels.",
        ],
    }
    export = {"model_version": MODEL_VERSION, "model_sha256": report["model_sha256"],
              "classes": label_info, "evaluation": report["evaluation"], "cases": cases,
              "limits": report["limits"], "training_windows": len(rows)}
    for path, payload in [(output / "report.json", report), (output / "cases.json", export)]:
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    if frontend_export:
        frontend_export.parent.mkdir(parents=True, exist_ok=True)
        frontend_export.write_text(json.dumps(export, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps(report["evaluation"], indent=2), flush=True)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--farm", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("models/care-multifault"))
    parser.add_argument("--frontend-export", type=Path)
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--refresh-trends", action="store_true")
    args = parser.parse_args()
    if args.refresh_trends:
        refresh_case_trends(args.farm, args.output, args.frontend_export)
    elif args.prepare_only:
        prepare(args.farm, args.cache)
    else:
        train(args.farm, args.output, args.frontend_export, args.cache)
