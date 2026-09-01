import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from worker import research_serve_misses
from worker.inferred_bounces import KnownContact


def blob_fixture():
    track = []
    for frame in range(3, 31):
        t = frame / 30.0
        x = (150.0 + 50.0 * t if t <= 0.4
             else 170.0 + 650.0 * (t - 0.4))
        y = 200.0 + (20.0 * t if t <= 0.3
                     else 6.0 - 18.0 * (t - 0.3))
        track.append([t, x, y])
    return {
        "match_id": "shadow-fixture",
        "w": 1000.0,
        "h": 600.0,
        "fps": 30.0,
        "duration": 1.2,
        "quad": {
            "A_near_1": [0.0, 300.0],
            "B_near_2": [1000.0, 300.0],
            "C_far_2": [1000.0, 0.0],
            "D_far_1": [0.0, 0.0],
        },
        "track": track,
        "bounces": [[1.0, 1]],
        "crossings": [0.77],
        "cards": [[0.0, 1.2]],
        "audio": {
            "bin_s": 0.01,
            "wave": [0.0] * 121,
            "impacts": [[0.31, 1.0]],
        },
        "route": "v2",
        "serves_per_min": 0.0,
        "camera": 1.0,
        "calibration": {"healthy": True},
    }


def measured_confidence(blob):
    fps = float(blob["fps"])
    return {int(round(float(row[0]) * fps)): 8.0 for row in blob["track"]}


def support_strength(card, kind):
    candidate = card["inferred_bounce_evidence"]["candidates"][0]
    return next(item["strength"] for item in candidate["support"]
                if item["kind"] == kind)


def without_shadow(page):
    value = copy.deepcopy(page)
    for card in value["cards"]:
        card.pop("inferred_bounce_evidence", None)
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


class BuilderIntegrationTests(unittest.TestCase):
    def test_include_all_attaches_a_successful_shadow_envelope(self):
        blob = blob_fixture()

        page = research_serve_misses.build(
            blob,
            include_all=True,
            observation_confidence=measured_confidence(blob),
            confidence_provenance="measured",
        )

        envelope = page["cards"][0]["inferred_bounce_evidence"]
        self.assertEqual(envelope["schema_version"], 1)
        self.assertGreater(len(envelope["candidates"]), 0)

    def test_research_page_build_does_not_attach_shadow_evidence(self):
        page = research_serve_misses.build(blob_fixture(), include_all=False)

        self.assertTrue(all(
            "inferred_bounce_evidence" not in card for card in page["cards"]
        ))

    def test_measured_confidence_reaches_real_detector_observations(self):
        blob = blob_fixture()
        measured = research_serve_misses.build(
            blob,
            include_all=True,
            observation_confidence=measured_confidence(blob),
            confidence_provenance="measured",
        )
        missing = research_serve_misses.build(
            blob,
            include_all=True,
            observation_confidence=None,
            confidence_provenance="missing",
        )

        self.assertEqual(
            support_strength(measured["cards"][0], "two_sided_track"), 1.0
        )
        self.assertEqual(
            support_strength(missing["cards"][0], "two_sided_track"), 0.35
        )

    def test_optional_research_contacts_reach_only_their_card(self):
        blob = blob_fixture()
        blob["cards"] = [[0.0, 0.6], [0.6, 1.2]]
        seen = []

        def capture(card):
            seen.append(card.known_contacts)
            return {
                "schema_version": 1,
                "detector_version": "shadow-v1",
                "clock": "source_seconds",
                "candidates": [],
            }

        with mock.patch.object(
            research_serve_misses, "infer_card_bounces", side_effect=capture
        ):
            research_serve_misses.build(
                blob,
                include_all=True,
                known_contacts=(KnownContact(0.31, "paddle", 0.95),),
            )

        self.assertEqual(seen[0], (KnownContact(0.31, "paddle", 0.95),))
        self.assertEqual(seen[1], ())

    def test_detector_failure_omits_only_that_cards_envelope(self):
        blob = blob_fixture()
        blob["cards"] = [[0.0, 0.6], [0.6, 1.2]]

        with mock.patch.object(
            research_serve_misses,
            "infer_card_bounces",
            side_effect=[RuntimeError("unexpected shadow bug"), {"schema_version": 1,
                         "detector_version": "shadow-v1",
                         "clock": "source_seconds", "candidates": []}],
        ):
            page = research_serve_misses.build(
                blob,
                include_all=True,
                observation_confidence=measured_confidence(blob),
                confidence_provenance="measured",
            )

        self.assertNotIn("inferred_bounce_evidence", page["cards"][0])
        self.assertEqual(
            page["cards"][1]["inferred_bounce_evidence"]["candidates"], []
        )

    def test_removing_the_additive_field_is_byte_equivalent(self):
        blob = blob_fixture()
        research = research_serve_misses.build(blob, include_all=False)
        admin = research_serve_misses.build(
            blob,
            include_all=True,
            observation_confidence=measured_confidence(blob),
            confidence_provenance="measured",
        )

        self.assertEqual(without_shadow(admin), without_shadow(research))


class WorkerPublisherIntegrationTests(unittest.TestCase):
    def setUp(self):
        self._pad = research_serve_misses.points_v2.PAIR_SURFACE_PAD_M
        self._cluster = research_serve_misses.points_v2.CLUSTER_S
        self.addCleanup(self._restore_serve_settings)

    def _restore_serve_settings(self):
        research_serve_misses.points_v2.PAIR_SURFACE_PAD_M = self._pad
        research_serve_misses.points_v2.CLUSTER_S = self._cluster

    def test_future_upload_publisher_builds_shadow_with_measured_confidence(self):
        from worker import worker

        blob = blob_fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "evidence.json").write_text(json.dumps(blob))
            blurball = root / "blurball.jsonl"
            blurball.write_text("".join(
                json.dumps({
                    "f": int(round(float(t) * blob["fps"])),
                    "x": x,
                    "y": y,
                    "conf": 8.0,
                }) + "\n"
                for t, x, y in blob["track"]
            ))

            class NoUpload:
                def upload_file(self, *_args, **_kwargs):
                    return None

            with mock.patch.object(worker, "r2", return_value=NoUpload()):
                worker.publish_card_diagnosis(
                    str(root), "points/test/shadow-fixture",
                    blurball_out=str(blurball),
                )

            page = json.loads((root / "serves.json").read_text())

        self.assertEqual(
            support_strength(page["cards"][0], "two_sided_track"), 1.0
        )


if __name__ == "__main__":
    unittest.main()
