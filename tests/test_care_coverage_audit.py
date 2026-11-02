from ai.care_coverage_audit import ADMITTED, SEMANTIC_CHANNELS, audit


def test_curated_event_ids_are_unique_within_each_farm():
    for categories in ADMITTED.values():
        ids = [event_id for events in categories.values() for event_id in events]
        assert len(ids) == len(set(ids))


def test_bearing_locations_are_not_falsely_equated():
    assert "C" not in SEMANTIC_CHANNELS["generator_bearing_temperature"]
    assert "A" not in SEMANTIC_CHANNELS["rotor_bearing_temperature"]


def test_metadata_audit_excludes_ambiguous_events(tmp_path):
    for farm in ("A", "B", "C"):
        folder = tmp_path / f"Wind Farm {farm}"
        folder.mkdir()
        selected = next(iter(next(iter(ADMITTED[farm].values()))))
        (folder / "event_info.csv").write_text(
            "asset_id;asset;event_id;event_label;event_description\n"
            f"1;1;{selected};anomaly;curated\n"
            "2;2;999;anomaly;two unrelated failures\n"
            "2;2;998;normal;\n", encoding="utf-8"
        )
        # The full audit correctly rejects incomplete metadata rather than silently
        # accepting a partial catalogue as the complete CARE source.
        (folder / "feature_description.csv").write_text(
            "sensor_name;statistics_type;description;unit\n", encoding="utf-8"
        )
    import pytest
    with pytest.raises(ValueError, match="Curated event IDs absent"):
        audit(tmp_path)
