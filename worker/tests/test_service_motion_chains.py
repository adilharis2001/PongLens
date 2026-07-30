import unittest

from worker.service_motion_chains import (
    enumerate_serve_chains,
    fuse_chain_and_motion,
)


def _hypothesis(
    side: str,
    *,
    first_t: float = 1.2,
    second_t: float = 1.6,
    first_v: float | None = None,
    second_v: float | None = None,
    score: float = 6.0,
    audio: float = 0.0,
) -> dict:
    if first_v is None:
        first_v = 0.7 if side == "near" else 2.1
    if second_v is None:
        second_v = 2.1 if side == "near" else 0.7
    return {
        "server_side": side,
        "score": score,
        "status": "ready",
        "hard_reasons": [],
        "shots": [
            {
                "phase": "serve",
                "serve_first_bounce": {
                    "t": first_t,
                    "v": first_v,
                    "confidence": 0.86,
                    "audio_confidence": audio,
                },
                "landing": {
                    "t": second_t,
                    "v": second_v,
                    "confidence": 0.81,
                    "audio_confidence": audio,
                },
            }
        ],
    }


def reconstruction(*hypotheses: dict) -> dict:
    return {
        "hypotheses": {
            hypothesis["server_side"]: hypothesis
            for hypothesis in hypotheses
        }
    }


class ServeChainEnumerationTests(unittest.TestCase):
    def test_enumerates_both_legal_physical_server_hypotheses(self):
        chains = enumerate_serve_chains(
            reconstruction(_hypothesis("near"), _hypothesis("far"))
        )

        self.assertEqual(len(chains), 2)
        self.assertEqual(chains[0]["first_bounce"]["half"], "near")
        self.assertEqual(chains[0]["second_bounce"]["half"], "far")
        self.assertGreaterEqual(chains[0]["rank"], chains[1]["rank"])

    def test_rejects_same_half_bounces_even_with_strong_audio(self):
        chains = enumerate_serve_chains(
            reconstruction(
                _hypothesis(
                    "near",
                    first_v=0.7,
                    second_v=0.9,
                    audio=12.0,
                )
            )
        )

        self.assertEqual(chains, [])

    def test_rejects_pairs_outside_the_frozen_time_window(self):
        too_short = enumerate_serve_chains(
            reconstruction(
                _hypothesis("near", first_t=1.2, second_t=1.49)
            )
        )
        too_long = enumerate_serve_chains(
            reconstruction(
                _hypothesis("near", first_t=1.2, second_t=1.83)
            )
        )

        self.assertEqual(too_short, [])
        self.assertEqual(too_long, [])

    def test_returns_at_most_three_unique_time_pairs(self):
        fixture = reconstruction(
            _hypothesis("near"),
            _hypothesis("far", score=5.9),
        )
        fixture["hypotheses"]["duplicate"] = {
            **_hypothesis("near", score=12.0),
            "server_side": "near",
        }

        chains = enumerate_serve_chains(fixture)

        self.assertEqual(len(chains), 2)
        self.assertEqual(
            len(
                {
                    (
                        item["first_bounce"]["t"],
                        item["second_bounce"]["t"],
                        item["server_hypothesis"],
                    )
                    for item in chains
                }
            ),
            2,
        )


class ServeChainFusionTests(unittest.TestCase):
    def test_pose_side_controls_a_consistent_fused_call(self):
        chain = enumerate_serve_chains(
            reconstruction(_hypothesis("near"))
        )[0]
        motion = {
            "status": "high_confidence",
            "side": "near",
            "confidence": 0.94,
            "scores": {"near": 5.8, "far": 0.8},
            "onset_t": 0.42,
            "contact_t": 1.08,
        }

        result = fuse_chain_and_motion(chain, motion)

        self.assertEqual(result["status"], "high_confidence")
        self.assertEqual(result["side"], "near")
        self.assertEqual(result["onset_t"], 0.42)
        self.assertEqual(result["first_bounce"]["t"], 1.2)
        self.assertEqual(result["second_bounce"]["t"], 1.6)
        self.assertGreater(result["confidence"], 0.8)

    def test_pose_chain_disagreement_is_withheld_when_margin_is_small(self):
        chain = enumerate_serve_chains(
            reconstruction(_hypothesis("near"))
        )[0]
        motion = {
            "status": "high_confidence",
            "side": "far",
            "confidence": 0.82,
            "scores": {"near": 3.4, "far": 3.8},
            "onset_t": 0.5,
            "contact_t": 1.06,
        }

        result = fuse_chain_and_motion(chain, motion)

        self.assertEqual(result["status"], "withheld")
        self.assertIsNone(result["side"])
        self.assertEqual(result["reason"], "chain_pose_disagreement")

    def test_withheld_motion_cannot_be_rescued_by_geometry(self):
        chain = enumerate_serve_chains(
            reconstruction(_hypothesis("near"))
        )[0]
        motion = {
            "status": "withheld",
            "side": None,
            "confidence": 0.0,
            "scores": {"near": 2.0, "far": 1.8},
            "onset_t": None,
            "contact_t": None,
        }

        result = fuse_chain_and_motion(chain, motion)

        self.assertEqual(result["status"], "withheld")
        self.assertIsNone(result["side"])


if __name__ == "__main__":
    unittest.main()
