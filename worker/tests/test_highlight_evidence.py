from types import SimpleNamespace

import numpy as np

from points_pipeline import build_highlight_evidence


def evidence(crossings=(), bounces=(), landing_sides=()):
    return SimpleNamespace(
        cross=np.asarray(crossings, dtype=float),
        bt_table=np.asarray(bounces, dtype=float),
        bt_table_landings=list(landing_sides),
    )


def card(start=10.0, end=20.0, observed_end=18.5):
    return {
        "t0": start,
        "t1": end,
        "serve_s": start + 0.5,
        "why": "serve",
        "end_evidence_s": observed_end,
    }


def test_records_longest_connected_crossing_chain_and_table_bounces():
    measured = build_highlight_evidence(
        card(),
        evidence(
            crossings=[10.5, 11.2, 12.0, 12.8, 13.7, 17.2, 17.8],
            bounces=[9.8, 10.7, 12.4, 14.0, 20.4],
        ),
        n_hits=6,
        route="serve-anchored",
    )
    assert measured == {
        "v": 2,
        "status": "ready",
        "route": "serve-anchored",
        "n_hits": 6,
        "connected_crossings": 5,
        "table_bounces": 3,
        "alternating_table_landings": 0,
        "first_crossing_s": 10.5,
        "last_crossing_s": 13.7,
        "max_crossing_gap_s": 0.9,
        "observed_end_s": 18.5,
        "end_source": "observed",
        "reasons": [],
    }


def test_crossings_outside_the_card_do_not_count():
    measured = build_highlight_evidence(
        card(),
        evidence(crossings=[9.9, 10.4, 11.0, 19.8, 20.1], bounces=[11.0]),
        n_hits=5,
        route="serve-anchored",
    )
    assert measured["connected_crossings"] == 2
    assert measured["first_crossing_s"] == 10.4
    assert measured["last_crossing_s"] == 11.0


def test_hit_count_is_independent_of_winner_answer():
    measured = build_highlight_evidence(
        card(),
        evidence(crossings=[11, 12, 13, 14], bounces=[11.5, 13.5]),
        n_hits=7,
        route="serve-anchored",
    )
    assert measured["status"] == "ready"
    assert measured["n_hits"] == 7


def test_missing_shot_count_keeps_geometric_evidence_available():
    measured = build_highlight_evidence(
        card(),
        evidence(crossings=[11, 12], bounces=[11.5]),
        n_hits=None,
        route="serve-anchored",
    )
    assert measured["status"] == "ready"
    assert measured["reasons"] == []
    assert measured["n_hits"] is None


def test_alternating_landings_are_the_longest_back_and_forth_run():
    measured = build_highlight_evidence(
        card(), evidence(
            bounces=[11, 12, 13, 14, 15, 16],
            landing_sides=[(11, "near"), (12, "far"), (13, "near"),
                           (14, "near"), (15, "far"), (16, "near")],
        ), n_hits=None,
        route="serve-anchored",
    )
    assert measured["status"] == "ready"
    assert measured["alternating_table_landings"] == 3


def test_alternating_landings_break_across_long_pauses():
    measured = build_highlight_evidence(
        card(start=10, end=30), evidence(
            bounces=[11, 15, 19, 23, 27],
            landing_sides=[(11, "near"), (15, "far"), (19, "near"),
                           (23, "far"), (27, "near")],
        ), n_hits=None, route="serve-anchored",
    )
    assert measured["alternating_table_landings"] == 1


def test_missing_observed_end_is_derived_from_connected_event_chain():
    measured = build_highlight_evidence(
        card(observed_end=None),
        evidence(crossings=[11, 12, 13, 14, 15], bounces=[11.5, 15.8]),
        n_hits=5,
        route="serve-anchored",
    )
    assert measured["status"] == "ready"
    assert measured["observed_end_s"] == 15.8
    assert measured["end_source"] == "event_chain"


def test_missing_observed_end_without_a_chain_is_unavailable():
    measured = build_highlight_evidence(
        card(observed_end=None), evidence(crossings=[11], bounces=[11.5]),
        n_hits=5, route="serve-anchored",
    )
    assert measured["status"] == "unavailable"
    assert measured["reasons"] == ["no_rally_end"]


def test_pipeline_fallback_records_specific_unavailable_reason():
    measured = build_highlight_evidence(
        card(), None, n_hits=None, route=None, unavailable_reason="no_table"
    )
    assert measured == {
        "v": 2,
        "status": "unavailable",
        "route": None,
        "n_hits": None,
        "connected_crossings": None,
        "table_bounces": None,
        "alternating_table_landings": None,
        "first_crossing_s": None,
        "last_crossing_s": None,
        "max_crossing_gap_s": None,
        "observed_end_s": 18.5,
        "end_source": "observed",
        "reasons": ["no_table"],
    }
