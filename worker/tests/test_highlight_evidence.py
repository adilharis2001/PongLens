from types import SimpleNamespace

import numpy as np

from points_pipeline import build_highlight_evidence


def evidence(crossings=(), bounces=()):
    return SimpleNamespace(
        cross=np.asarray(crossings, dtype=float),
        bt_table=np.asarray(bounces, dtype=float),
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
        "v": 1,
        "status": "ready",
        "route": "serve-anchored",
        "n_hits": 6,
        "connected_crossings": 5,
        "table_bounces": 3,
        "first_crossing_s": 10.5,
        "last_crossing_s": 13.7,
        "max_crossing_gap_s": 0.9,
        "observed_end_s": 18.5,
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


def test_missing_shot_count_is_unavailable():
    measured = build_highlight_evidence(
        card(),
        evidence(crossings=[11, 12], bounces=[11.5]),
        n_hits=None,
        route="serve-anchored",
    )
    assert measured["status"] == "unavailable"
    assert measured["reasons"] == ["no_shot_count"]
    assert measured["n_hits"] is None


def test_no_crossing_chain_is_unavailable():
    measured = build_highlight_evidence(
        card(), evidence(bounces=[11.5, 13.5]), n_hits=5,
        route="serve-anchored",
    )
    assert measured["status"] == "unavailable"
    assert measured["reasons"] == ["no_crossing_chain"]


def test_missing_observed_end_is_unavailable():
    measured = build_highlight_evidence(
        card(observed_end=None),
        evidence(crossings=[11, 12], bounces=[11.5]),
        n_hits=5,
        route="serve-anchored",
    )
    assert measured["status"] == "unavailable"
    assert measured["reasons"] == ["no_observed_end"]


def test_pipeline_fallback_records_specific_unavailable_reason():
    measured = build_highlight_evidence(
        card(), None, n_hits=None, route=None, unavailable_reason="no_table"
    )
    assert measured == {
        "v": 1,
        "status": "unavailable",
        "route": None,
        "n_hits": None,
        "connected_crossings": None,
        "table_bounces": None,
        "first_crossing_s": None,
        "last_crossing_s": None,
        "max_crossing_gap_s": None,
        "observed_end_s": 18.5,
        "reasons": ["no_table"],
    }
