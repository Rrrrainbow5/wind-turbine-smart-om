import pytest

from ai.models.grouped_validation import audit_groups, nested_bearing_plan
from ai.models.hybrid import ModelInputError


def rows(counts):
    return [{"sample_id": f"{label}-{bearing}-{run}", "fault_label": label,
             "bearing_code": f"{label}{bearing}", "split_group": f"paderborn-bearing-{label}{bearing}"}
            for label, count in zip(("a", "b", "c"), counts)
            for bearing in range(count) for run in range(2)]


def test_two_bearings_block_nested_gate_even_with_many_records():
    data = rows((2, 2, 2))
    assert audit_groups(data)["additional_bearings_minimum"] == {"a": 1, "b": 1, "c": 1}
    with pytest.raises(ModelInputError, match="three physical"):
        nested_bearing_plan(data)


@pytest.mark.parametrize("counts", [(3, 3, 3), (3, 4, 5), (4, 5, 7)])
def test_nested_plan_disjoint_groups_all_classes_exact_oof_coverage(counts):
    data = rows(counts)
    plan = nested_bearing_plan(data)
    assert plan == nested_bearing_plan(data)
    groups = lambda indexes: {data[i]["split_group"] for i in indexes}
    labels = lambda indexes: {data[i]["fault_label"] for i in indexes}
    outer_seen = []
    for outer in plan:
        assert groups(outer["train"]).isdisjoint(groups(outer["test"]))
        assert labels(outer["test"]) == {"a", "b", "c"}
        outer_seen.extend(outer["test"])
        inner_seen = []
        for inner in outer["inner"]:
            assert groups(inner["train"]).isdisjoint(groups(inner["validation"]))
            assert set(inner["train"] + inner["validation"]) == set(outer["train"])
            assert labels(inner["train"]) == labels(inner["validation"]) == {"a", "b", "c"}
            inner_seen.extend(inner["validation"])
        assert sorted(inner_seen) == sorted(outer["train"])
    assert sorted(outer_seen) == list(range(len(data)))


def test_false_groups_and_duplicate_ids_rejected():
    data = rows((3, 3, 3))
    with pytest.raises(ModelInputError, match="duplicate"):
        audit_groups(data + [data[0]])
    data[0]["split_group"] = "random-window"
    with pytest.raises(ModelInputError, match="physical bearing"):
        audit_groups(data)
