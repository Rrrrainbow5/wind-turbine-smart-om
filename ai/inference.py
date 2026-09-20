"""Stable inference entry point for the B module."""

from __future__ import annotations

from pathlib import Path

from ai.event51_baseline import build_event51_result


def predict(farm_dir: str | Path) -> dict[str, object]:
    """Return one API-contract payload generated from CARE Event 51."""
    return build_event51_result(Path(farm_dir)).payload
