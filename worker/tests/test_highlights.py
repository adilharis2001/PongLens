import copy
from decimal import Decimal

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
    crossings: int = 5,
    alternating_landings: int = 2,
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
        "confirmed_winner": "user",
        "highlight_evidence": {
            "v": 2,
            "status": "ready",
            "route": "serve-anchored",
            "n_hits": hits,
            "connected_crossings": crossings,
            "table_bounces": bounces,
            "alternating_table_landings": alternating_landings,
            "first_crossing_s": t0 + 1.0,
            "last_crossing_s": observed_end - 0.2,
            "max_crossing_gap_s": 1.0,
            "observed_end_s": observed_end,
            "reasons": [],
        },
    }


def test_exact_crossing_threshold_qualifies():
    assert qualifies(point("p"))


def test_unscored_rally_never_qualifies():
    p = point("unscored")
    p["confirmed_winner"] = None
    assert not qualifies(p)


def test_postgres_numeric_timestamps_qualify():
    p = point("postgres")
    for field in ("t0", "t1", "cut_t0", "rally_end_cut_s"):
        p[field] = Decimal(str(p[field]))
    assert qualifies(p)


def test_five_alternating_landings_qualify_without_crossings_or_hits():
    p = point("p", hits=None, crossings=0, alternating_landings=5, bounces=5)
    assert qualifies(p)
    manifest_point = build_manifest([p])["points"][0]
    assert manifest_point["n_hits"] == 0
    assert manifest_point["connected_crossings"] == 0


def test_five_hits_need_independent_trajectory_support():
    assert qualifies(point("cross-supported", hits=5, crossings=2,
                           alternating_landings=2))
    assert qualifies(point("landing-supported", hits=5, crossings=1,
                           alternating_landings=3, bounces=3))
    assert not qualifies(point("unsupported", hits=5, crossings=1,
                               alternating_landings=2))


@pytest.mark.parametrize("signal", ["crossings", "alternating", "hits"])
def test_four_exchange_rally_never_qualifies(signal):
    values = {"hits": 0, "crossings": 0, "alternating_landings": 0,
              "bounces": 2}
    if signal == "crossings":
        values["crossings"] = 4
    elif signal == "alternating":
        values["alternating_landings"] = 4
        values["bounces"] = 4
    else:
        values.update(hits=4, crossings=2)
    assert not qualifies(point("p", **values))


def test_shared_table_contact_threshold_fails_closed():
    assert not qualifies(point("p", crossings=8, bounces=1))


@pytest.mark.parametrize(
    "field",
    [
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


def test_evidence_end_maps_to_cut_clock_without_rewriting_point_bounds():
    p = point("derived")
    p["rally_end_cut_s"] = None
    assert qualifies(p)
    manifest_point = build_manifest([p])["points"][0]
    expected = p["cut_t0"] + (
        p["highlight_evidence"]["observed_end_s"] - p["t0"]
    ) + 0.25
    assert manifest_point["cut_end_s"] == expected


def test_scoring_tap_is_the_authoritative_highlight_end():
    p = point("scored")
    p["scored_at_cut_s"] = 15.4
    manifest_point = build_manifest([p])["points"][0]
    assert manifest_point["cut_end_s"] == 15.6


def test_detector_end_gets_quarter_second_when_no_scoring_tap_exists():
    p = point("unscored")
    p["scored_at_cut_s"] = None
    manifest_point = build_manifest([p])["points"][0]
    assert manifest_point["cut_end_s"] == 17.25


def test_scoring_tap_before_the_point_fails_closed():
    p = point("stale-tap")
    p["scored_at_cut_s"] = p["cut_t0"] - 0.01
    assert not qualifies(p)


def test_observed_end_must_be_inside_source_point():
    before = point("before")
    before["highlight_evidence"]["observed_end_s"] = before["t0"] - 0.01
    after = point("after")
    after["highlight_evidence"]["observed_end_s"] = after["t1"] + 0.01
    assert not qualifies(before)
    assert not qualifies(after)


def test_never_fills_budget_with_unqualified_point():
    strong = point("strong", idx=1, hits=8, crossings=7, bounces=4, seconds=12)
    weak = point("weak", idx=2, hits=2, crossings=1, bounces=2, seconds=8)
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


def test_selection_uses_source_chronology_after_a_point_split():
    late = point("late", idx=2)
    early_split = point("early-split", idx=99)
    early_split.update(t0=10.0, t1=18.0, cut_t0=5.0,
                       rally_end_cut_s=12.0)
    early_split["highlight_evidence"]["observed_end_s"] = 17.0
    result = select_highlights([late, early_split], 60)
    assert [p["id"] for p in result] == ["early-split", "late"]


def test_manifest_output_positions_include_crossfade_overlap():
    first = point("first", idx=1, seconds=8)
    second = point("second", idx=2, seconds=7)
    manifest = build_manifest([first, second], 60)
    a, b = manifest["points"]
    assert a["cut_start_s"] == 10.0
    assert a["cut_end_s"] == 17.25
    assert a["output_start_s"] == 0.0
    assert a["output_end_s"] == 7.25
    assert b["output_start_s"] == pytest.approx(7.25 - XFADE_S)
    assert b["output_end_s"] == pytest.approx(7.25 - XFADE_S + 6.25)
    assert manifest["duration_s"] == pytest.approx(b["output_end_s"])
    assert manifest["scored_only"] is True


def test_revision_is_deterministic_and_changes_with_membership_bounds_or_version():
    points = [point("a", idx=1), point("b", idx=2)]
    first = points_revision(points)
    assert first == points_revision(copy.deepcopy(points))

    moved = copy.deepcopy(points)
    moved[0]["cut_t0"] += 0.1
    assert points_revision(moved) != first

    changed_version = copy.deepcopy(points)
    changed_version[0]["highlight_evidence"]["v"] = 3
    assert points_revision(changed_version) != first


def test_revision_changes_with_alternating_landing_measurement():
    points = [point("a")]
    first = points_revision(points)
    points[0]["highlight_evidence"]["alternating_table_landings"] += 1
    assert points_revision(points) != first


def test_revision_changes_when_a_scoring_tap_is_added():
    points = [point("a")]
    first = points_revision(points)
    points[0]["scored_at_cut_s"] = 16.2
    assert points_revision(points) != first


def test_scored_only_revision_changes_when_a_point_is_unscored():
    points = [point("a")]
    first = points_revision(points, scored_only=True)
    points[0]["confirmed_winner"] = None
    assert points_revision(points, scored_only=True) != first


def test_scored_only_revision_ignores_which_player_won():
    points = [point("a")]
    first = points_revision(points, scored_only=True)
    points[0]["confirmed_winner"] = "opponent"
    assert points_revision(points, scored_only=True) == first


def test_same_inputs_make_same_manifest():
    points = [point("a", idx=1), point("b", idx=2)]
    assert build_manifest(points, 150) == build_manifest(copy.deepcopy(points), 150)
