from types import SimpleNamespace

import pytest

from ai.models.hybrid import ModelInputError
from ai.models.paderborn_experiment import bearing_folds, select_samples, verify_sample


def _rows():
    rows = []
    for label, bearings in [("healthy", ["K001", "K002"]),
                            ("bearing_outer_race", ["KA01", "KA03"]),
                            ("bearing_inner_race", ["KI01", "KI03"])]:
        for bearing in bearings:
            for run in range(2):
                rows.append({"sample_id": f"{bearing}-{run}", "bearing_code": bearing,
                             "fault_label": label, "split_group": f"paderborn-bearing-{bearing.lower()}",
                             "data_origin": "EXTERNAL_PUBLIC", "dataset": "Paderborn Bearing Data Center",
                             "timebase_processing": "UNCHANGED_UNIFORM_64000_HZ", "source_gap_count": "0",
                             "sampling_rate_hz": "64000", "source_sha256": "a" * 64})
    return rows


def test_bearing_holdout_is_stratified_disjoint_complementary_and_repeatable():
    rows = _rows()
    folds = bearing_folds(rows, 7)
    assert folds == bearing_folds(rows, 7)
    tested = []
    for train, test in folds:
        assert {rows[i]["bearing_code"] for i in train}.isdisjoint(
            {rows[i]["bearing_code"] for i in test})
        assert {rows[i]["fault_label"] for i in train} == {rows[i]["fault_label"] for i in test}
        assert set(train) | set(test) == set(range(len(rows)))
        tested.extend(test)
    assert sorted(tested) == list(range(len(rows)))


def test_gap_exclusion_and_mixed_origin_rejection():
    rows = _rows()
    rows[0]["source_gap_count"] = "1"
    included, excluded = select_samples(rows)
    assert len(included) == 11
    assert excluded == [{"sample_id": rows[0]["sample_id"], "reason": "source_timebase_gap"}]
    rows[1]["data_origin"] = "SIMULATED"
    with pytest.raises(ModelInputError, match="exclusively"):
        select_samples(rows)


def test_manifest_duplicate_and_unknown_audit_fail_closed():
    rows = _rows()
    with pytest.raises(ModelInputError, match="duplicate"):
        select_samples(rows + [rows[0]])
    rows[0]["timebase_processing"] = "UNKNOWN"
    with pytest.raises(ModelInputError, match="audit"):
        select_samples(rows)


def test_bearing_protocol_rejects_missing_groups_and_false_group_identity():
    rows = _rows()
    with pytest.raises(ModelInputError, match="exactly two"):
        bearing_folds(rows[2:])
    rows[0]["split_group"] = "random-window-1"
    with pytest.raises(ModelInputError, match="physical bearing"):
        bearing_folds(rows)


def test_source_identity_and_rate_are_checked_before_extraction():
    row = _rows()[0]
    values = {key: row[key] for key in ("sample_id", "bearing_code", "fault_label", "split_group",
                                       "data_origin", "source_sha256")}
    sample = SimpleNamespace(**values, sampling_rate_hz=64000, source_gap_count=0)
    verify_sample(row, sample)
    sample.sample_id = "wrong-source"
    with pytest.raises(ModelInputError, match="sample_id"):
        verify_sample(row, sample)
    sample.sample_id = row["sample_id"]
    sample.sampling_rate_hz = 1
    with pytest.raises(ModelInputError, match="sampling rate"):
        verify_sample(row, sample)
