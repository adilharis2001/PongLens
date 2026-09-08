import copy
import sys
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch

import pytest

import highlight_backfill
from highlight_backfill import (
    build_receipts_from_diagnostic,
    highlight_evidence_refresh_needed,
    highlight_points_are_updating,
    highlight_revision_is_current,
    protected_point_snapshot,
    refresh_match_evidence_for_render,
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
        "confirmed_winner": "you",
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


def test_refresh_waits_for_any_live_edited_rally():
    assert highlight_points_are_updating([
        {"deleted": False, "edited": True},
        {"deleted": True, "edited": True},
    ]) is True
    assert highlight_points_are_updating([
        {"deleted": True, "edited": True},
        {"deleted": False, "edited": False},
    ]) is False


def test_refresh_ignores_ineligible_missing_evidence():
    assert highlight_evidence_refresh_needed([
        {"deleted": False, "edited": False, "is_let": True,
         "clip_path": "point.mp4", "highlight_evidence": None},
        {"deleted": False, "edited": False, "is_let": False,
         "clip_path": None, "highlight_evidence": None},
    ]) is False
    assert highlight_evidence_refresh_needed([
        {"deleted": False, "edited": False, "is_let": False,
         "clip_path": "point.mp4", "highlight_evidence": None},
    ]) is True


def test_revision_guard_rejects_an_edit_started_after_the_snapshot():
    original = point()
    expected = highlight_backfill.points_revision([original])
    assert highlight_revision_is_current(expected, [copy.deepcopy(original)]) is True
    changed = copy.deepcopy(original)
    changed["edited"] = True
    assert highlight_revision_is_current(expected, [changed]) is False


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


def test_joined_point_combines_every_overlapping_diagnostic_card():
    joined = point(start=10, end=30, hits=1)
    receipts = build_receipts_from_diagnostic(
        [joined],
        {
            "meta": {"route": "serve-anchored"},
            "cards": [
                {
                    **diagnostic_card(
                        crossings=[11, 12, 13, 14],
                        bounces=[bounce(11.5, .4), bounce(12.5, 2.1)],
                    ),
                    "t0": 10, "t1": 15,
                },
                {
                    **diagnostic_card(
                        crossings=[14, 15],
                        bounces=[bounce(14.5, .5), bounce(15.5, 2.2)],
                    ),
                    "t0": 14, "t1": 30,
                },
            ],
        },
    )
    receipt = receipts["p1"]
    assert receipt["connected_crossings"] == 5
    assert receipt["table_bounces"] == 4
    assert receipt["last_crossing_s"] == 15


def test_scoring_tap_is_authoritative_when_evidence_is_rebuilt():
    original = point(start=100, end=112)
    original["cut_t0"] = 20.0
    original["scored_at_cut_s"] = 30.5
    original["rally_end_cut_s"] = 29.0
    receipts = build_receipts_from_diagnostic(
        [original],
        {"cards": [{
            **diagnostic_card(crossings=[101, 102, 103, 104, 105]),
            "t0": 100, "t1": 112,
        }]},
    )
    assert receipts["p1"]["observed_end_s"] == 110.5
    assert receipts["p1"]["end_source"] == "tap"


def test_render_refresh_preserves_the_queued_reel_row():
    original = point()
    receipt = {"v": 2, "status": "ready"}
    stored = {**original, "highlight_evidence": receipt}

    class Cursor:
        def __init__(self, statements):
            self.statements = statements

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, statement, params):
            self.statements.append((statement, params))

    class Connection:
        autocommit = True

        def __init__(self):
            self.statements = []

        def cursor(self):
            return Cursor(self.statements)

        def commit(self):
            pass

        def rollback(self):
            pass

    connection = Connection()
    locks = []

    @contextmanager
    def locked_match_version(conn, match_id, processing_version_id):
        assert conn.autocommit is False
        locks.append((match_id, processing_version_id))
        yield

    worker = SimpleNamespace(
        BackfillConsistencyError=RuntimeError,
        locked_match_version=locked_match_version,
    )
    with patch.object(
        highlight_backfill,
        "_prepare_diagnostic",
        return_value=(worker, [original], {"p1": receipt}, "version-a"),
    ) as prepare, patch.object(
        highlight_backfill,
        "_load_points",
        side_effect=[[stored], [stored]],
    ) as load_points:
        result = refresh_match_evidence_for_render(
            connection, "match", processing_version_id="version-a"
        )

    assert result.point_count == 1
    assert locks == [("match", "version-a")]
    prepare.assert_called_once_with(
        connection, "match", processing_version_id="version-a"
    )
    assert [call.kwargs for call in load_points.call_args_list] == [
        {"processing_version_id": "version-a", "for_update": True},
        {"processing_version_id": "version-a"},
    ]
    assert any("update public.points" in sql for sql, _params in connection.statements)
    assert not any("delete from public.match_reels" in sql for sql, _params in connection.statements)
    update_sql, update_params = connection.statements[0]
    assert "processing_version_id = %s" in update_sql
    assert update_params[1:] == ("p1", "match", "version-a")
    assert connection.autocommit is True


def test_diagnostic_rejects_an_obsolete_render_before_media_work():
    class MatchVersionChanged(RuntimeError):
        pass

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, _statement, _params):
            pass

        def fetchone(self):
            return (
                "owner", "r2://media/version-b/cut.mp4", None, {},
                "version-b", "r2://media/version-b/match.json",
            )

    worker = SimpleNamespace(MatchVersionChanged=MatchVersionChanged)
    connection = SimpleNamespace(cursor=Cursor)
    with patch.dict(sys.modules, {"worker": worker}), patch.object(
        highlight_backfill.tempfile, "mkdtemp"
    ) as make_workdir:
        with pytest.raises(MatchVersionChanged):
            highlight_backfill._prepare_diagnostic(
                connection, "match", processing_version_id="version-a"
            )
    make_workdir.assert_not_called()


def test_render_refresh_rejects_publication_before_receipt_write():
    class MatchVersionChanged(RuntimeError):
        pass

    @contextmanager
    def locked_match_version(_conn, _match_id, processing_version_id):
        assert processing_version_id == "version-a"
        raise MatchVersionChanged("active version is now version-b")
        yield

    class Connection:
        autocommit = True
        commits = 0
        rollbacks = 0

        def commit(self):
            self.commits += 1

        def rollback(self):
            self.rollbacks += 1

        def cursor(self):
            raise AssertionError("an obsolete refresh must not write receipts")

    connection = Connection()
    worker = SimpleNamespace(locked_match_version=locked_match_version)
    with patch.object(
        highlight_backfill,
        "_prepare_diagnostic",
        return_value=(worker, [point()], {"p1": {"v": 2}}, "version-a"),
    ):
        with pytest.raises(MatchVersionChanged):
            refresh_match_evidence_for_render(
                connection, "match", processing_version_id="version-a"
            )
    assert connection.commits == 0
    assert connection.rollbacks == 1
    assert connection.autocommit is True


def test_point_loads_are_scoped_to_the_processing_version():
    statements = []

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, statement, params):
            statements.append((statement, params))

        def fetchall(self):
            return [{"id": "p1", "processing_version_id": "version-a"}]

    connection = SimpleNamespace(cursor=lambda **_kwargs: Cursor())
    points = highlight_backfill._load_points(
        connection, "match", processing_version_id="version-a", for_update=True
    )
    assert points == [{"id": "p1", "processing_version_id": "version-a"}]
    statement, params = statements[0]
    assert "where match_id = %s and processing_version_id = %s" in statement
    assert statement.endswith("for update")
    assert params == ("match", "version-a")
