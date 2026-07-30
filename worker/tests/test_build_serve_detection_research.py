import unittest
from collections import Counter

from worker.build_serve_detection_research import (
    Candidate,
    build_candidates,
    choose_sample,
    point_contexts,
)


MATCH_KEYS = ("vaibhav", "gui", "chris", "faye", "patrick")


def _point(
    idx: int,
    winner: str | None,
    *,
    is_let: bool = False,
    server_override: str | None = None,
    game_end_override: str | None = None,
) -> dict:
    return {
        "id": f"point-{idx}",
        "idx": idx,
        "t0": float(idx),
        "confirmed_winner": winner,
        "is_let": is_let,
        "server_override": server_override,
        "game_end_override": game_end_override,
    }


class PointContextsTest(unittest.TestCase):
    def test_rotation_handles_deuce(self) -> None:
        points = []
        for idx in range(1, 21):
            points.append(
                _point(idx, "user" if idx % 2 else "opponent")
            )
        points.extend([_point(21, "user"), _point(22, "user")])

        contexts = point_contexts(
            {"first_server": "user", "user_side": "near"},
            points,
        )

        self.assertEqual(contexts[21]["server"], "user")
        self.assertEqual(contexts[22]["server"], "opponent")
        self.assertEqual(contexts[22]["game_number"], 1)

    def test_next_game_flips_first_server_and_player_ends(self) -> None:
        points = [_point(idx, "user") for idx in range(1, 13)]

        contexts = point_contexts(
            {"first_server": "user", "user_side": "near"},
            points,
        )

        self.assertEqual(contexts[11]["game_number"], 1)
        self.assertEqual(contexts[12]["game_number"], 2)
        self.assertEqual(contexts[12]["server"], "opponent")
        self.assertEqual(contexts[12]["user_side"], "far")

    def test_let_does_not_advance_serve_rotation(self) -> None:
        contexts = point_contexts(
            {"first_server": "user", "user_side": "near"},
            [
                _point(1, "user"),
                _point(2, None, is_let=True),
                _point(3, "opponent"),
                _point(4, "user"),
            ],
        )

        self.assertEqual(contexts[1]["server"], "user")
        self.assertEqual(contexts[2]["server"], "user")
        self.assertEqual(contexts[3]["server"], "user")
        self.assertEqual(contexts[4]["server"], "opponent")

    def test_server_override_reanchors_rotation(self) -> None:
        contexts = point_contexts(
            {"first_server": "user", "user_side": "near"},
            [
                _point(1, "user"),
                _point(2, "opponent", server_override="opponent"),
                _point(3, "user"),
            ],
        )

        self.assertEqual(contexts[2]["server"], "opponent")
        self.assertEqual(contexts[2]["server_source"], "override")
        self.assertEqual(contexts[3]["server"], "user")

    def test_continue_override_holds_game_open(self) -> None:
        points = [_point(idx, "user") for idx in range(1, 13)]
        points[10]["game_end_override"] = "continue"

        contexts = point_contexts(
            {"first_server": "user", "user_side": "near"},
            points,
        )

        self.assertEqual(contexts[12]["game_number"], 1)


def _candidate(
    match_key: str,
    number: int,
    status: str,
    reason: str,
) -> Candidate:
    return Candidate(
        match_key=match_key,
        match_id=f"{match_key}-match",
        match_label=match_key.title(),
        point_id=f"{match_key}-point-{number:03d}",
        point_idx=number,
        clip_path=f"r2://ponglens-media/{match_key}/{number}.mp4",
        status=status,
        reason=reason,
        proposal={"detector": {"status": status, "reason": reason}},
        gold={"scored_server_side": "near"},
    )


def candidate_fixture() -> list[Candidate]:
    high_counts = {
        "vaibhav": 15,
        "gui": 6,
        "chris": 12,
        "faye": 0,
        "patrick": 12,
    }
    candidates = []
    for match_key in MATCH_KEYS:
        high_count = high_counts[match_key]
        for number in range(1, 31):
            status = "high_confidence" if number <= high_count else "needs_review"
            candidates.append(
                _candidate(
                    match_key,
                    number,
                    status,
                    f"reason-{number % 3}",
                )
            )
        candidates.append(
            _candidate(match_key, 99, "unavailable", "missing")
        )
    return candidates


class ChooseSampleTest(unittest.TestCase):
    def test_sample_is_twenty_per_match_and_status_stratified(self) -> None:
        selected = choose_sample(candidate_fixture())

        self.assertEqual(len(selected), 100)
        self.assertEqual(
            Counter(item.match_key for item in selected),
            Counter({key: 20 for key in MATCH_KEYS}),
        )
        self.assertEqual(
            Counter(item.status for item in selected),
            Counter({"high_confidence": 36, "needs_review": 64}),
        )
        self.assertNotIn("unavailable", {item.status for item in selected})

    def test_selection_is_deterministic(self) -> None:
        candidates = candidate_fixture()

        first = [item.point_id for item in choose_sample(candidates)]
        second = [
            item.point_id for item in choose_sample(list(reversed(candidates)))
        ]

        self.assertEqual(first, second)

    def test_needs_review_selection_represents_each_reason(self) -> None:
        selected = choose_sample(candidate_fixture())
        faye_reasons = {
            item.reason for item in selected if item.match_key == "faye"
        }

        self.assertEqual(
            faye_reasons,
            {"reason-0", "reason-1", "reason-2"},
        )

    def test_match_with_fewer_than_twenty_eligible_points_fails(self) -> None:
        candidates = [
            item
            for item in candidate_fixture()
            if item.match_key != "gui" or item.point_idx <= 19
        ]

        with self.assertRaisesRegex(ValueError, "gui.*20 eligible"):
            choose_sample(candidates)

    def test_detector_receives_only_placement_reconstruction(self) -> None:
        received = []

        def selector(payload):
            received.append(payload)
            return {
                "status": "needs_review",
                "reason": "hypothesis_margin_too_small",
                "server_side": None,
                "confidence": 0.0,
                "serve": {
                    "contact_t": None,
                    "first_bounce": None,
                    "second_bounce": None,
                },
            }

        match = {
            "id": "match-1",
            "match_key": "vaibhav",
            "match_label": "Vaibhav",
            "first_server": "user",
            "user_side": "near",
        }
        point = {
            **_point(1, "user"),
            "placement": {"private": "placement-only"},
            "clip_path": "r2://ponglens-media/point.mp4",
        }

        candidates = build_candidates(match, [point], selector=selector)

        self.assertEqual(received, [{"private": "placement-only"}])
        self.assertEqual(candidates[0].gold["scored_server_side"], "near")


if __name__ == "__main__":
    unittest.main()
