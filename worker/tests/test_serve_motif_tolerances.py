"""The two tolerances that decide whether a serve is found at all.

A serve is accepted only when both of its bounces land on the playing
surface, and "on the surface" is known only to within the error the pipeline
carries — the homography maps the ball's CENTRE, a radius above the plane,
and the quad's corners are themselves a few pixels out. The old 0.15 m was
smaller than that error, so real serves were discarded before any of the six
pair rules ran: 45 of 914 cards on the review corpus lost their anchor.

Two things are pinned here and both were nearly shipped wrong.

The first is that the tolerances are read at CALL time. `on_surface` used to
take `pad=PAIR_SURFACE_PAD_M` as a default argument, which Python evaluates
once at import — so overriding the module constant from app_config would have
changed nothing at all, silently, and the config key would have looked like
it worked.

The second is that the two settings travel together. Widening the surface
alone lets 7 mid-rally readings through on the review corpus; the merge is
what caps them at 4. Loosening one without the other is the regression this
file exists to catch.

Record: docs/superpowers/specs/2026-08-28-serve-surface-slack-design.md
"""

import contextlib
import json
import os
import sys
import unittest
from unittest import mock

# Repo root FIRST so `worker` resolves to the package rather than to
# worker/worker.py, and the worker directory APPENDED so points_v2 — which
# imports table_coordinates as a top-level module — can find its neighbours.
# Inserting the worker directory at the front instead shadows the package and
# breaks the import below.
# Import worker.py through the package BEFORE putting worker/ on the path.
# Both are needed — the modules under worker/ import each other flat — but
# once worker/ is on the path, worker.py is also a top-level module named
# `worker`, and a real module beats the namespace package of the same name.
# Importing it first binds the right one and the append is then harmless.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from worker import worker  # noqa: E402,F401
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

import points_v2  # noqa: E402
from points_v2 import homography_from_corners, serve_motifs  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "serve_slack.json")
W_M, L_M = points_v2.W_M, points_v2.L_M


class Tolerances(unittest.TestCase):
    def setUp(self):
        self._pad = points_v2.PAIR_SURFACE_PAD_M
        self._cluster = points_v2.CLUSTER_S
        self.addCleanup(self._restore)

    def _restore(self):
        points_v2.PAIR_SURFACE_PAD_M = self._pad
        points_v2.CLUSTER_S = self._cluster


class ShippedValues(Tolerances):
    """What production runs when app_config says nothing."""

    def test_the_module_states_the_current_rule(self):
        self.assertEqual(points_v2.PAIR_SURFACE_PAD_M, 0.45)
        self.assertEqual(points_v2.CLUSTER_S, 2.5)

    def test_the_worker_falls_back_to_the_old_rule_not_the_new_one(self):
        # A missing config row has to reproduce yesterday's behaviour, which
        # is what lets the code deploy and the setting flip at different
        # moments. Mirroring points_v2 here would collapse the two events.
        self.assertEqual(worker.SERVE_SURFACE_PAD_DEFAULT, "0.15")
        self.assertEqual(worker.SERVE_MERGE_S_DEFAULT, "1.5")


class SurfaceToleranceIsReadAtCallTime(Tolerances):
    """The trap: a default argument would have frozen the import-time value."""

    def test_overriding_the_module_constant_changes_the_answer(self):
        just_outside = (W_M / 2.0, L_M + 0.25)
        points_v2.PAIR_SURFACE_PAD_M = 0.15
        self.assertFalse(points_v2.on_surface(just_outside))
        points_v2.PAIR_SURFACE_PAD_M = 0.45
        self.assertTrue(points_v2.on_surface(just_outside))

    def test_an_explicit_pad_still_wins(self):
        points_v2.PAIR_SURFACE_PAD_M = 0.45
        self.assertFalse(points_v2.on_surface((W_M / 2.0, L_M + 0.25), pad=0.15))


class TheToleranceIsTheSameOnAllFourSides(Tolerances):
    """Widening only the far end was the careful-looking version and it
    recovered less than half as much. The geometry argument is right about
    which edge is worst and wrong about which edges are affected."""

    def setUp(self):
        super().setUp()
        points_v2.PAIR_SURFACE_PAD_M = 0.45

    def test_forty_centimetres_past_every_edge_is_still_a_contact(self):
        for name, point in (
            ("far end", (W_M / 2.0, L_M + 0.40)),
            ("near end", (W_M / 2.0, -0.40)),
            ("left sideline", (-0.40, L_M / 2.0)),
            ("right sideline", (W_M + 0.40, L_M / 2.0)),
        ):
            with self.subTest(edge=name):
                self.assertTrue(points_v2.on_surface(point))

    def test_fifty_centimetres_past_any_edge_is_not(self):
        for name, point in (
            ("far end", (W_M / 2.0, L_M + 0.50)),
            ("near end", (W_M / 2.0, -0.50)),
            ("left sideline", (-0.50, L_M / 2.0)),
            ("right sideline", (W_M + 0.50, L_M / 2.0)),
        ):
            with self.subTest(edge=name):
                self.assertFalse(points_v2.on_surface(point))


class RealServesFromTheCorpus(Tolerances):
    """Six neighbourhoods of real ball track, trimmed out of the review
    bundles. Synthetic points can pin the arithmetic; only real track pins
    the claim that these serves exist and were being thrown away."""

    @classmethod
    def setUpClass(cls):
        with open(FIXTURE) as fh:
            cls.cases = json.load(fh)["cases"]

    def _count(self, case, pad, cluster):
        points_v2.PAIR_SURFACE_PAD_M = pad
        points_v2.CLUSTER_S = cluster
        H = homography_from_corners({k: tuple(v) for k, v in case["quad"].items()})
        track = {int(f): (x, y) for f, x, y in case["track"]}
        bounces = [(int(f), x, y) for f, x, y in case["bounces"]]
        # The apex test is measured in pixels and scaled by the video's
        # width. Passing 1.0 for a 640-wide match judges its serves against
        # a bar three times too high — that mistake cost 14 serves on the
        # one 360p video in the corpus before it was caught.
        return len(serve_motifs(track, bounces, H, case["fps"],
                                case.get("scale", 1.0), case["cross"]))

    def test_every_case_matches_what_was_measured(self):
        self.assertTrue(self.cases, "fixture is empty")
        for case in self.cases:
            for setting, expected in case["expect"].items():
                pad, cluster = (float(x) for x in setting.split("/"))
                with self.subTest(case=case["name"], setting=setting):
                    self.assertEqual(self._count(case, pad, cluster), expected)

    def test_the_old_tolerance_finds_nothing_in_the_recovered_cases(self):
        recovered = [c for c in self.cases if "recovered" in c["name"]]
        self.assertTrue(recovered, "fixture carries no recovered serves")
        for case in recovered:
            with self.subTest(case=case["name"]):
                self.assertEqual(self._count(case, 0.15, 1.5), 0)
                self.assertEqual(self._count(case, 0.45, 2.5), 1)

    def test_the_merge_collapses_two_readings_of_one_serve(self):
        pairs = [c for c in self.cases if "two readings" in c["name"]]
        self.assertTrue(pairs, "fixture carries no duplicate readings")
        for case in pairs:
            with self.subTest(case=case["name"]):
                self.assertEqual(self._count(case, 0.45, 1.5), 2)
                self.assertEqual(self._count(case, 0.45, 2.5), 1)


class ConfigReadIsForgiving(unittest.TestCase):
    """A typo in one config row costs the tolerance it was meant to set, not
    every upload on the platform. The fallback is the rule the match would
    have got anyway, so failing open here loses nothing."""

    def _settings(self, values):
        def fake(_conn, key):
            if isinstance(values, Exception):
                raise values
            return values.get(key)
        with mock.patch.object(worker, "get_config", side_effect=fake):
            return worker.serve_motif_settings(object())

    def test_the_configured_values_are_used(self):
        self.assertEqual(
            self._settings({"serve_surface_pad_m": "0.45",
                            "serve_merge_s": "2.5"}),
            ("0.45", "2.5"))

    def test_a_missing_row_falls_back(self):
        self.assertEqual(self._settings({}), ("0.15", "1.5"))

    def test_a_value_that_is_not_a_number_falls_back(self):
        self.assertEqual(
            self._settings({"serve_surface_pad_m": "wide",
                            "serve_merge_s": ""}),
            ("0.15", "1.5"))

    def test_one_bad_row_does_not_take_the_other_down(self):
        self.assertEqual(
            self._settings({"serve_surface_pad_m": "0.45",
                            "serve_merge_s": "soon"}),
            ("0.45", "1.5"))

    def test_a_failing_read_falls_back(self):
        self.assertEqual(self._settings(RuntimeError("no database")),
                         ("0.15", "1.5"))


class TheSettingsReachTheChild(unittest.TestCase):
    """The plumbing, which is the half that fails quietly. A tolerance read
    correctly and then never passed produces a normal-looking match built
    under the wrong rule, with nothing anywhere saying so."""

    def _cmd(self, **kwargs):
        seen = {}

        def fake_run(cmd, *_a, **_kw):
            seen["cmd"] = list(cmd)

        with mock.patch.object(worker.subprocess, "run", side_effect=fake_run), \
                mock.patch.object(worker, "points_child_env",
                                  return_value=({}, "/tmp/usage.json")), \
                mock.patch.object(worker, "record_vision_usage_sidecar"), \
                mock.patch.object(worker.COST_METER, "timed_stage",
                                  lambda *a, **k: contextlib.nullcontext()):
            worker.run_points_subprocess(
                "in.mp4", "b.jsonl", "/tmp/points-tolerance-test", {}, **kwargs)
        return seen["cmd"]

    def test_v2_passes_both_tolerances_through(self):
        cmd = self._cmd(pipeline="v2", serve_surface_pad="0.45",
                        serve_merge_s="2.5")
        self.assertEqual(cmd[cmd.index("--serve-surface-pad") + 1], "0.45")
        self.assertEqual(cmd[cmd.index("--serve-merge-s") + 1], "2.5")

    def test_the_defaults_are_the_old_rule(self):
        cmd = self._cmd(pipeline="v2")
        self.assertEqual(cmd[cmd.index("--serve-surface-pad") + 1], "0.15")
        self.assertEqual(cmd[cmd.index("--serve-merge-s") + 1], "1.5")

    def test_v1_is_untouched(self):
        cmd = self._cmd(pipeline="v1")
        self.assertNotIn("--serve-surface-pad", cmd)
        self.assertNotIn("--serve-merge-s", cmd)


if __name__ == "__main__":
    unittest.main()
