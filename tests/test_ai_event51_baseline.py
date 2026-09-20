from datetime import datetime

from ai.event51_baseline import COMPONENT_ID, TURBINE_ID, warning_level


def test_integration_ids_remain_neutral() -> None:
    assert TURBINE_ID == "WT02"
    assert COMPONENT_ID == "WT02_COMPONENT_01"


def test_warning_levels_follow_assumed_v01_thresholds() -> None:
    assert warning_level(0.0) == "NORMAL"
    assert warning_level(0.20) == "LOW"
    assert warning_level(0.45) == "MEDIUM"
    assert warning_level(0.75) == "HIGH"


def test_api_timestamp_example_has_explicit_timezone() -> None:
    parsed = datetime.fromisoformat("2023-10-06T01:30:00+00:00")
    assert parsed.tzinfo is not None
