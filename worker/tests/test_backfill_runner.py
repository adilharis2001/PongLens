import unittest
from types import SimpleNamespace
from unittest.mock import Mock, call

from worker.backfill_placement_v3 import run_rollout


CANARY_ID = "10000000-0000-0000-0000-000000000001"
OTHER_ID = "10000000-0000-0000-0000-000000000002"
ELIGIBLE = [
    {"match_id": CANARY_ID, "point_count": 40},
    {"match_id": OTHER_ID, "point_count": 60},
]
RESULT = SimpleNamespace(
    match_id=CANARY_ID,
    point_count=40,
    ready=20,
    review=15,
    unavailable=5,
)


def unchanged_snapshot(connection, match_id):
    return {"match_id": match_id, "non_placement": "unchanged"}


class CanaryRolloutTests(unittest.TestCase):
    def test_dry_run_reports_scope_without_calling_backfill(self):
        backfill = Mock()

        summary = run_rollout(
            object(),
            CANARY_ID,
            all_matches=True,
            dry_run=True,
            backfill=backfill,
            eligible_loader=lambda connection: ELIGIBLE,
            snapshotter=unchanged_snapshot,
        )

        self.assertEqual(summary.eligible, 2)
        self.assertEqual(summary.eligible_points, 100)
        self.assertEqual(summary.succeeded, 0)
        backfill.assert_not_called()

    def test_canary_failure_stops_before_other_matches(self):
        backfill = Mock(side_effect=RuntimeError("canary failed"))

        with self.assertRaisesRegex(RuntimeError, "canary failed"):
            run_rollout(
                object(),
                CANARY_ID,
                all_matches=True,
                backfill=backfill,
                eligible_loader=lambda connection: ELIGIBLE,
                snapshotter=unchanged_snapshot,
            )

        backfill.assert_called_once_with(unittest.mock.ANY, CANARY_ID)

    def test_remaining_matches_run_only_after_canary_invariants_pass(self):
        results = {
            CANARY_ID: RESULT,
            OTHER_ID: SimpleNamespace(
                match_id=OTHER_ID,
                point_count=60,
                ready=30,
                review=20,
                unavailable=10,
            ),
        }
        backfill = Mock(side_effect=lambda connection, match_id: results[match_id])

        summary = run_rollout(
            object(),
            CANARY_ID,
            all_matches=True,
            backfill=backfill,
            eligible_loader=lambda connection: ELIGIBLE,
            snapshotter=unchanged_snapshot,
        )

        self.assertEqual(
            backfill.call_args_list,
            [call(unittest.mock.ANY, CANARY_ID), call(unittest.mock.ANY, OTHER_ID)],
        )
        self.assertEqual(summary.succeeded, 2)
        self.assertEqual(summary.updated_points, 100)
        self.assertEqual(summary.failed_match_ids, ())

    def test_canary_invariant_change_stops_rollout(self):
        calls = {CANARY_ID: 0}

        def changing_snapshot(connection, match_id):
            calls[match_id] = calls.get(match_id, 0) + 1
            return {
                "match_id": match_id,
                "non_placement": calls[match_id],
            }

        backfill = Mock(return_value=RESULT)

        with self.assertRaisesRegex(RuntimeError, "non-placement invariants"):
            run_rollout(
                object(),
                CANARY_ID,
                all_matches=True,
                backfill=backfill,
                eligible_loader=lambda connection: ELIGIBLE,
                snapshotter=changing_snapshot,
            )

        backfill.assert_called_once_with(unittest.mock.ANY, CANARY_ID)


if __name__ == "__main__":
    unittest.main()
