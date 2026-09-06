import copy

import pytest

from highlights import (
    XFADE_S,
    build_manifest,
    points_revision,
    qualifies,
    select_highlights,
)


def point(
    point_id: str,
    *,
    idx: int = 1,
    hits: int = 5,
    crossings: int = 4,
    bounces: int = 2,
    seconds: float = 8.0,
) -> dict:
    t0 = idx * 20.0
    cut_t0 = idx * 10.0
    observed_end = t0 + seconds - 1.0
    return {
        "id": point_id,
        "idx": idx,
        "t0": t0,
        "t1": t0 + seconds,
        "cut_t0": cut_t0,
        "rally_end_cut_s": cut_t0 + seconds - 1.0,
        "clip_path": f"r2://bucket/{point_id}.mp4",
        "deleted": False,
        "edited": False,
        "is_let": False,
        "highlight_evidence": {
            "v": 1,
            "status": "ready",
            "route": "serve-anchored",
            "n_hits": hits,
            "connected_crossings": crossings,
            "table_bounces": bounces,
            "first_crossing_s": t0 + 1.0,
            "last_crossing_s": observed_end - 0.2,
            "max_crossing_gap_s": 1.0,
            "observed_end_s": observed_end,
            "reasons": [],
        },
    }


def test_exact_v1_threshold_qualifies():
    assert qualifies(point("p"))


@pytest.mark.parametrize(
    ("field", "value"),
    [("n_hits", 4), ("connected_crossings", 3), ("table_bounces", 1)],
)
def test_each_threshold_fails_closed(field, value):
    p = point("p")
    p["highlight_evidence"][field] = value
    assert not qualifies(p)


@pytest.mark.parametrize(
    "field",
    [
        "n_hits",
        "connected_crossings",
        "table_bounces",
        "observed_end_s",
    ],
)
def test_missing_required_measurement_fails_closed(field):
    p = point("p")
    p["highlight_evidence"].pop(field)
    assert not qualifies(p)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("deleted", True),
        ("edited", True),
        ("is_let", True),
        ("clip_path", None),
        ("cut_t0", None),
        ("rally_end_cut_s", None),
    ],
)
def test_unplayable_or_changed_point_fails_closed(field, value):
    p = point("p")
    p[field] = value
    assert not qualifies(p)


def test_unavailable_and_legacy_evidence_fail_closed():
    unavailable = point("unavailable")
    unavailable["highlight_evidence"]["status"] = "unavailable"
    assert not qualifies(unavailable)
    legacy = point("legacy")
    legacy["highlight_evidence"] = None
    assert not qualifies(legacy)


def test_observed_end_must_be_inside_source_point():
    before = point("before")
    before["highlight_evidence"]["observed_end_s"] = before["t0"] - 0.01
    after = point("after")
    after["highlight_evidence"]["observed_end_s"] = after["t1"] + 0.01
    assert not qualifies(before)
    assert not qualifies(after)


def test_never_fills_budget_with_unqualified_point():
    strong = point("strong", idx=1, hits=8, crossings=7, bounces=4, seconds=12)
    weak = point("weak", idx=2, hits=2, crossings=1, bounces=1, seconds=8)
    result = select_highlights([strong, weak], 60)
    assert [p["id"] for p in result] == ["strong"]


def test_budget_is_a_ceiling_and_can_leave_unused_time():
    a = point("a", idx=1, hits=9, crossings=8, bounces=5, seconds=13)
    b = point("b", idx=2, hits=8, crossings=7, bounces=4, seconds=12)
    c = point("c", idx=3, hits=7, crossings=6, bounces=3, seconds=11)
    result = select_highlights([a, b, c], 20)
    assert [p["id"] for p in result] == ["a"]


def test_long_qualified_point_can_step_aside_for_shorter_qualified_point():
    best_too_long = point(
        "best", idx=1, hits=12, crossings=11, bounces=6, seconds=30
    )
    shorter = point(
        "shorter", idx=2, hits=8, crossings=7, bounces=4, seconds=10
    )
    result = select_highlights([best_too_long, shorter], 12)
    assert [p["id"] for p in result] == ["shorter"]


def test_selection_returns_to_match_order_after_quality_ranking():
    early = point("early", idx=1, hits=5, crossings=4, bounces=2, seconds=7)
    late = point("late", idx=2, hits=10, crossings=9, bounces=5, seconds=10)
    result = select_highlights([late, early], 60)
    assert [p["id"] for p in result] == ["early", "late"]


def test_manifest_output_positions_include_crossfade_overlap():
    first = point("first", idx=1, seconds=8)
    second = point("second", idx=2, seconds=7)
    manifest = build_manifest([first, second], 60)
    a, b = manifest["points"]
    assert a["cut_start_s"] == 10.0
    assert a["cut_end_s"] == 17.75
    assert a["output_start_s"] == 0.0
    assert a["output_end_s"] == 7.75
    assert b["output_start_s"] == pytest.approx(7.75 - XFADE_S)
    assert b["output_end_s"] == pytest.approx(7.75 - XFADE_S + 6.75)
    assert manifest["duration_s"] == pytest.approx(b["output_end_s"])


def test_revision_is_deterministic_and_changes_with_membership_bounds_or_version():
    points = [point("a", idx=1), point("b", idx=2)]
    first = points_revision(points)
    assert first == points_revision(copy.deepcopy(points))

    moved = copy.deepcopy(points)
    moved[0]["cut_t0"] += 0.1
    assert points_revision(moved) != first

    changed_version = copy.deepcopy(points)
    changed_version[0]["highlight_evidence"]["v"] = 2
    assert points_revision(changed_version) != first


def test_same_inputs_make_same_manifest():
    points = [point("a", idx=1), point("b", idx=2)]
    assert build_manifest(points, 150) == build_manifest(copy.deepcopy(points), 150)
