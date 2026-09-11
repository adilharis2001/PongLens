import copy

from highlight_backfill import (
    build_receipts_from_diagnostic,
    protected_point_snapshot,
)
from highlights import qualifies


def point(point_id="p1", *, start=10.0, end=20.0, hits=1):
    return {
        "id": point_id,
        "idx": 1,
        "t0": start,
        "t1": end,
        "cut_t0": 4.0,
        "rally_end_cut_s": None,
        "clip_path": "r2://ponglens-media/points/u/m/01.mp4",
        "deleted": False,
        "edited": False,
        "is_let": False,
        "confirmed_winner": "user",
        "suggestion": {"n_hits": hits},
        "highlight_evidence": None,
    }


def diagnostic_card(*, crossings=(), bounces=()):
    return {
        "t0": 10.0,
        "t1": 20.0,
        "crossings": list(crossings),
        "bounces": list(bounces),
    }


def bounce(t, v, on_surface=True):
    return {"t": t, "u": 0.7, "v": v, "onSurface": on_surface}


def test_diagnostic_crossing_chain_recovers_end_on_rally():
    original = point()
    receipts = build_receipts_from_diagnostic(
        [original],
        {
            "meta": {"route": "end-on"},
            "cards": [diagnostic_card(
                crossings=[11, 12, 13, 14, 15],
                bounces=[bounce(11.5, 0.5), bounce(15.7, 2.1)],
            )],
        },
    )
    recovered = {**original, "highlight_evidence": receipts["p1"]}
    assert receipts["p1"]["end_source"] == "event_chain"
    assert receipts["p1"]["observed_end_s"] == 15.7
    assert qualifies(recovered)


def test_diagnostic_alternating_landings_are_a_second_path():
    original = point(hits=1)
    receipts = build_receipts_from_diagnostic(
        [original],
        {
            "meta": {"route": "serve-anchored"},
            "cards": [diagnostic_card(
                crossings=[],
                bounces=[
                    bounce(11, 0.4), bounce(12, 2.2), bounce(13, 0.5),
                    bounce(14, 2.1), bounce(15, 0.6),
                ],
            )],
        },
    )
    recovered = {**original, "highlight_evidence": receipts["p1"]}
    assert receipts["p1"]["alternating_table_landings"] == 5
    assert qualifies(recovered)


def test_rebuild_changes_only_highlight_evidence():
    original = point()
    before = protected_point_snapshot(original)
    receipts = build_receipts_from_diagnostic(
        [original],
        {"cards": [diagnostic_card(
            crossings=[11, 12, 13, 14, 15],
            bounces=[bounce(11.5, 0.5), bounce(15.5, 2.0)],
        )]},
    )
    updated = copy.deepcopy(original)
    updated["highlight_evidence"] = receipts["p1"]
    assert protected_point_snapshot(updated) == before


def test_a_missing_card_is_recorded_unavailable_not_guessed():
    receipts = build_receipts_from_diagnostic([point()], {"cards": []})
    assert receipts["p1"]["status"] == "unavailable"
    assert receipts["p1"]["reasons"] == ["no_matching_diagnostic_card"]


def test_cut_clock_fallback_translates_receipt_back_to_source_time():
    original = point(start=100, end=110)
    original["cut_t0"] = 20.0
    receipts = build_receipts_from_diagnostic(
        [original],
        {"cards": [{
            **diagnostic_card(crossings=[21, 22, 23, 24, 25],
                              bounces=[bounce(21.5, .4), bounce(25.5, 2.1)]),
            "t0": 20.0, "t1": 30.0,
        }]},
        diagnostic_clock="cut",
    )
    assert receipts["p1"]["observed_end_s"] == 105.5
