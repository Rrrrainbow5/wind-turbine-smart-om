"""Generate the reproducible v0.2 UI contract example."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ai.signal_pipeline import simulate_coupled_sample


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = simulate_coupled_sample(
        sample_id="SIM-WT02-0001", fault_type="bearing_outer_race",
        severity=0.5, sampling_rate_hz=2000, duration_s=0.032, seed=7,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
