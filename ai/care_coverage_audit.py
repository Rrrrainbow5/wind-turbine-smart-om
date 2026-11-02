"""Audit independent-asset coverage from CARE event metadata, without relabeling ambiguous events.

Usage: python -m ai.care_coverage_audit --data-root D:/.../care-data --output report.json
This is a dataset admission audit, not a trained diagnostic model.
"""
from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path


# Explicit event IDs are intentional: free-text keyword matching would turn
# multi-fault and uncertain events into false single-component ground truth.
ADMITTED = {
    "A": {
        "gearbox": {10}, "gearbox_bearing": {51},
        "generator_bearing": {0, 40}, "transformer_thermal": {68},
        "hydraulic": {22, 26, 42, 45, 73, 84},
    },
    "B": {
        "rotor_or_main_bearing": {53, 27, 77},
        "transformer_thermal": {34, 7, 19},
    },
    "C": {
        # These are subsystem/event labels, not proof of a particular part failure.
        "pitch_system_event": {66, 15, 30, 70, 16, 76},
        "transformer_event": {67},
        "converter_event": {81},
        "gear_oil_pump_coupling_event": {49},
    },
}

SEMANTIC_CHANNELS = {
    "ambient_temperature": {"A": "sensor_0_avg", "B": "sensor_8_avg", "C": "sensor_7_avg"},
    "wind_speed": {"A": "wind_speed_3_avg", "B": "wind_speed_61_avg", "C": "wind_speed_235_avg"},
    "active_power": {"A": "power_30_avg", "B": "power_62_avg", "C": "power_2_avg"},
    "gearbox_oil_temperature": {"A": "sensor_12_avg", "B": "sensor_38_avg", "C": "sensor_186_avg"},
    "generator_bearing_temperature": {"A": "sensor_13_avg", "B": "sensor_32_avg"},
    "rotor_bearing_temperature": {"C": "sensor_196_avg"},
    "transformer_temperature": {"A": "sensor_38_avg", "B": "sensor_41_avg", "C": "sensor_191_avg"},
}


def audit(root: Path) -> dict:
    coverage = defaultdict(lambda: {"assets": set(), "events": [], "farms": set()})
    exclusions = []
    source_counts = {}
    for farm in ("A", "B", "C"):
        folder = root / f"Wind Farm {farm}"
        with (folder / "event_info.csv").open(encoding="utf-8-sig", newline="") as stream:
            events = list(csv.DictReader(stream, delimiter=";"))
        source_counts[farm] = {"events": len(events), "normal": sum(row["event_label"] == "normal" for row in events)}
        reverse = {event_id: category for category, ids in ADMITTED[farm].items() for event_id in ids}
        observed = set()
        for row in events:
            event_id = int(row["event_id"])
            if row["event_label"] == "normal":
                category = "healthy"
            else:
                category = reverse.get(event_id)
                if category is None:
                    exclusions.append({"farm": farm, "event_id": event_id, "asset_id": row.get("asset_id", row.get("asset")), "reason": "mixed, uncertain, or unmapped event"})
                    continue
                observed.add(event_id)
            asset = f"{farm}:{row.get('asset_id', row.get('asset'))}"
            entry = coverage[category]
            entry["assets"].add(asset)
            entry["farms"].add(farm)
            entry["events"].append({"farm": farm, "event_id": event_id, "asset_id": asset})
        missing = set(reverse) - observed
        if missing:
            raise ValueError(f"Curated event IDs absent or not anomalous in farm {farm}: {sorted(missing)}")
        with (folder / "feature_description.csv").open(encoding="utf-8-sig", newline="") as stream:
            features = {row["sensor_name"]: row for row in csv.DictReader(stream, delimiter=";")}
        for semantic, mapping in SEMANTIC_CHANNELS.items():
            if farm not in mapping:
                continue
            raw = mapping[farm].removesuffix("_avg")
            if raw not in features or "average" not in features[raw]["statistics_type"].split(","):
                raise ValueError(f"Missing average channel {farm}:{mapping[farm]} for {semantic}")
    categories = {}
    for name, entry in sorted(coverage.items()):
        count = len(entry["assets"])
        categories[name] = {
            "independent_assets": count, "assets": sorted(entry["assets"]),
            "farms": sorted(entry["farms"]), "events": sorted(entry["events"], key=lambda row: (row["farm"], row["event_id"])),
            "asset_holdout_eligible": count >= 2,
        }
    return {
        "status": "METADATA_AUDIT_NOT_MODEL_VALIDATION",
        "source_counts": source_counts,
        "semantic_channels": SEMANTIC_CHANNELS,
        "categories": categories,
        "excluded_anomaly_events": sorted(exclusions, key=lambda row: (row["farm"], row["event_id"])),
        "limits": [
            "Independent asset count is necessary but not sufficient: time-series availability, aligned units, clean event intervals and class separability require separate checks.",
            "Pitch, converter and gear-oil pump events are not interchangeable with gearbox, bearing or transformer failure modes.",
            "CARE channels are ten-minute SCADA aggregates, not high-frequency raw vibration/current signals.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = audit(args.data_root)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for name, value in report["categories"].items():
        print(f"{name}: {value['independent_assets']} independent assets, {len(value['events'])} events")
    print(f"excluded ambiguous/unmapped anomaly events: {len(report['excluded_anomaly_events'])}")


if __name__ == "__main__":
    main()
