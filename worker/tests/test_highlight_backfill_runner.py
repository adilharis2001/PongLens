from types import SimpleNamespace
from unittest.mock import Mock, call

import pytest

from backfill_highlights import run_rollout
from worker import BackfillConsistencyError


CANARY = "10000000-0000-0000-0000-000000000001"
OTHER = "10000000-0000-0000-0000-000000000002"
ELIGIBLE = [
    {"match_id": CANARY, "point_count": 40},
    {"match_id": OTHER, "point_count": 60},
]


def snapshot(_conn, match_id):
    return {"match": match_id, "protected": "unchanged"}


def test_dry_run_never_calls_the_writer():
    writer = Mock()
    analyzer = Mock(return_value=SimpleNamespace(point_count=1, qualifying=3))
    summary = run_rollout(
        object(), CANARY, all_matches=True, dry_run=True,
        backfill=writer, analyzer=analyzer, eligible=ELIGIBLE,
        snapshotter=snapshot,
    )
    assert summary.matches == 2
    assert summary.points == 100
    assert summary.qualifying == 6
    writer.assert_not_called()
    assert analyzer.call_count == 2


def test_canary_is_verified_before_the_rest_of_the_rollout():
    writer = Mock(return_value=SimpleNamespace(point_count=1, qualifying=1))
    connection = object()
    summary = run_rollout(
        connection, CANARY, all_matches=True, backfill=writer,
        eligible=ELIGIBLE, snapshotter=snapshot,
    )
    assert writer.call_args_list == [call(connection, CANARY), call(connection, OTHER)]
    assert summary.succeeded == 2


def test_protected_field_change_aborts_the_rollout():
    calls = 0

    def changed(_conn, match_id):
        nonlocal calls
        calls += 1
        return {"match": match_id, "protected": calls}

    writer = Mock(return_value=SimpleNamespace(point_count=1, qualifying=1))
    with pytest.raises(BackfillConsistencyError, match="protected fields changed"):
        run_rollout(
            object(), CANARY, all_matches=True, backfill=writer,
            eligible=ELIGIBLE, snapshotter=changed,
        )
    writer.assert_called_once()


def test_zero_qualifier_canary_stops_before_other_writes():
    writer = Mock(return_value=SimpleNamespace(point_count=1, qualifying=0))
    with pytest.raises(RuntimeError, match="canary produced no qualifying"):
        run_rollout(
            object(), CANARY, all_matches=True, backfill=writer,
            eligible=ELIGIBLE, snapshotter=snapshot,
        )
    writer.assert_called_once()
