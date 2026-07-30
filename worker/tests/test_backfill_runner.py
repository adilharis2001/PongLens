import unittest
from types import SimpleNamespace
from unittest.mock import Mock, call

from worker.backfill_placement_v3 import run_rollout
from worker.worker import BackfillConsistencyError


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
    def test_explicit_targets_run_only_after_the_canary(self):
        third_id = "10000000-0000-0000-0000-000000000003"
        eligible = [
            *ELIGIBLE,
            {"match_id": third_id, "point_count": 20},
        ]
        results = {
            CANARY_ID: RESULT,
            OTHER_ID: SimpleNamespace(point_count=60),
        }
        backfill = Mock(side_effect=lambda connection, match_id: results[match_id])

        summary = run_rollout(
            object(),
            CANARY_ID,
            all_matches=False,
            target_match_ids=(OTHER_ID, OTHER_ID),
            backfill=backfill,
            eligible_loader=lambda connection: eligible,
            snapshotter=unchanged_snapshot,
        )

        self.assertEqual(
            backfill.call_args_list,
            [call(unittest.mock.ANY, CANARY_ID), call(unittest.mock.ANY, OTHER_ID)],
        )
        self.assertEqual(summary.eligible, 2)
        self.assertEqual(summary.eligible_points, 100)

    def test_explicit_ineligible_target_fails_before_any_write(self):
        backfill = Mock()

        with self.assertRaisesRegex(RuntimeError, "is not eligible"):
            run_rollout(
                object(),
                CANARY_ID,
                all_matches=False,
                target_match_ids=("missing",),
                backfill=backfill,
                eligible_loader=lambda connection: ELIGIBLE,
                snapshotter=unchanged_snapshot,
            )

        backfill.assert_not_called()

    def test_explicit_target_dry_run_reports_only_selected_scope(self):
        third_id = "10000000-0000-0000-0000-000000000003"
        eligible = [
            *ELIGIBLE,
            {"match_id": third_id, "point_count": 20},
        ]
        backfill = Mock()

        summary = run_rollout(
            object(),
            CANARY_ID,
            all_matches=False,
            target_match_ids=(OTHER_ID,),
            dry_run=True,
            backfill=backfill,
            eligible_loader=lambda connection: eligible,
            snapshotter=unchanged_snapshot,
        )

        self.assertEqual(summary.eligible, 2)
        self.assertEqual(summary.eligible_points, 100)
        backfill.assert_not_called()

    def test_all_matches_and_explicit_targets_are_mutually_exclusive(self):
        backfill = Mock()

        with self.assertRaisesRegex(ValueError, "mutually exclusive"):
            run_rollout(
                object(),
                CANARY_ID,
                all_matches=True,
                target_match_ids=(OTHER_ID,),
                backfill=backfill,
                eligible_loader=lambda connection: ELIGIBLE,
                snapshotter=unchanged_snapshot,
            )

        backfill.assert_not_called()

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

    def test_consistency_failure_on_later_match_halts_rollout(self):
        third_id = "10000000-0000-0000-0000-000000000003"
        eligible = [
            *ELIGIBLE,
            {"match_id": third_id, "point_count": 20},
        ]
        backfill = Mock(
            side_effect=[
                RESULT,
                BackfillConsistencyError("cross-store mismatch"),
                SimpleNamespace(point_count=20),
            ]
        )

        with self.assertRaisesRegex(
            BackfillConsistencyError,
            "cross-store mismatch",
        ):
            run_rollout(
                object(),
                CANARY_ID,
                all_matches=True,
                backfill=backfill,
                eligible_loader=lambda connection: eligible,
                snapshotter=unchanged_snapshot,
            )

        self.assertEqual(len(backfill.call_args_list), 2)

    def test_later_post_mutation_invariant_change_halts_rollout(self):
        third_id = "10000000-0000-0000-0000-000000000003"
        eligible = [
            *ELIGIBLE,
            {"match_id": third_id, "point_count": 20},
        ]
        snapshots = {}

        def changed_second_match(connection, match_id):
            snapshots[match_id] = snapshots.get(match_id, 0) + 1
            changed = match_id == OTHER_ID and snapshots[match_id] == 2
            return {
                "match_id": match_id,
                "non_placement": "changed" if changed else "unchanged",
            }

        backfill = Mock(
            side_effect=[
                RESULT,
                SimpleNamespace(point_count=60),
                SimpleNamespace(point_count=20),
            ]
        )

        with self.assertRaisesRegex(
            BackfillConsistencyError,
            "non-placement invariants",
        ):
            run_rollout(
                object(),
                CANARY_ID,
                all_matches=True,
                backfill=backfill,
                eligible_loader=lambda connection: eligible,
                snapshotter=changed_second_match,
            )

        self.assertEqual(len(backfill.call_args_list), 2)


if __name__ == "__main__":
    unittest.main()
