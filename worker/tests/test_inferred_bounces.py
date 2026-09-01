import unittest
from dataclasses import replace

import numpy as np

from worker import inferred_bounces


def candidate_fixture():
    return {
        "id": "ib-334.672-serve_first_bounce",
        "time": {
            "estimate_s": 334.672,
            "interval_s": [334.638, 334.705],
            "method": "weak_reversal",
        },
        "table_position": None,
        "context": "serve_first_bounce",
        "confidence": {"score": 0.94, "tier": "high"},
        "hypothesis_comparison": {
            "preferred": "latent_bounce",
            "continuous_airborne_cost": 18.4,
            "latent_bounce_cost": 7.1,
            "margin": 11.3,
        },
        "support": [
            {
                "kind": "weak_visual_reversal",
                "strength": 0.82,
                "detail": "Below the normal five-frame reversal gate.",
            }
        ],
        "vetoes": [],
        "normal_detector_miss": {
            "reason": "below_reversal_threshold",
            "detail": "The visual reversal did not clear the normal gate.",
        },
        "trajectory_constraint": {
            "safe_to_constrain_z0": False,
            "mode": "display_only",
            "reason": "The global shadow constraint gate is disabled.",
        },
    }


def table_homography():
    return np.array([
        [1.0 / 1000.0, 0.0, 0.0],
        [0.0, 1.0 / 300.0, 0.0],
        [0.0, 0.0, 1.0],
    ])


def observations(rows, *, measured=True):
    return tuple(
        inferred_bounces.Observation(t, x, y, 8.0 if measured else None,
                                     measured)
        for t, x, y in rows
    )


def synthetic_card(
    rows,
    *,
    hard_bounces=(),
    crossings=(),
    audio_impacts=(),
    known_contacts=(),
    accepted_serve_bounces=(),
    measured=True,
    homography=None,
    calibration_healthy=True,
):
    return inferred_bounces.CardInput(
        t0=0.0,
        t1=1.2,
        fps=30.0,
        width_px=1920.0,
        height_px=1080.0,
        observations=observations(rows, measured=measured),
        hard_bounces=tuple(hard_bounces),
        crossings=tuple(crossings),
        audio_impacts=tuple(audio_impacts),
        homography=table_homography() if homography is None else homography,
        known_contacts=tuple(known_contacts),
        accepted_serve_bounces=tuple(accepted_serve_bounces),
        calibration_healthy=calibration_healthy,
    )


def flight_homography():
    # Image y carries the weak visual bounce while image x advances along v.
    return np.array([
        [0.0, 1.0 / 300.0, 0.0],
        [1.0 / 300.0, 0.0, 0.0],
        [0.0, 0.0, 1.0],
    ])


def missing_serve_rows(*, occluded=False, outbound_shift_px=0.0):
    rows = []
    for frame in range(3, 30):
        t = frame / 30.0
        if occluded and 0.24 < t < 0.47:
            continue
        x = (150.0 + 50.0 * t if t <= 0.4
             else 170.0 + 650.0 * (t - 0.4))
        if occluded and t >= 0.47:
            x += outbound_shift_px
        y = 200.0 + (20.0 * t if t <= 0.3
                     else 6.0 - 18.0 * (t - 0.3))
        rows.append((t, x, y))
    return rows


def missing_first_serve_card(
    *,
    measured=True,
    occluded=False,
    outbound_shift_px=0.0,
    known_contacts=(),
):
    landing = inferred_bounces.HardBounce(
        1.0, 560.0 + outbound_shift_px, 194.0,
        194.0 / 300.0, (560.0 + outbound_shift_px) / 300.0, True,
    )
    return synthetic_card(
        missing_serve_rows(
            occluded=occluded, outbound_shift_px=outbound_shift_px
        ),
        hard_bounces=(landing,),
        crossings=(0.77,),
        audio_impacts=((0.31 if not occluded else 0.36, 1.0),),
        known_contacts=known_contacts,
        measured=measured,
        homography=flight_homography(),
    )


class ContractTests(unittest.TestCase):
    def test_empty_envelope_distinguishes_a_successful_run_with_no_candidates(self):
        self.assertEqual(
            inferred_bounces.empty_envelope(),
            {
                "schema_version": 1,
                "detector_version": "shadow-v1.5",
                "clock": "source_seconds",
                "candidates": [],
            },
        )

    def test_candidate_id_is_stable_at_source_millisecond_precision(self):
        self.assertEqual(
            inferred_bounces.candidate_id(334.6716, "serve_first_bounce"),
            "ib-334.672-serve_first_bounce",
        )

    def test_partial_table_coordinates_are_rejected(self):
        candidate = candidate_fixture()
        candidate["table_position"] = {"u_m": 0.6, "v_m": 2.1}

        with self.assertRaisesRegex(ValueError, "table_position"):
            inferred_bounces.validate_candidate(candidate)

    def test_hard_z0_mode_must_match_the_safety_boolean(self):
        candidate = candidate_fixture()
        candidate["trajectory_constraint"] = {
            "safe_to_constrain_z0": False,
            "mode": "hard_z0",
            "reason": "inconsistent fixture",
        }

        with self.assertRaisesRegex(ValueError, "trajectory_constraint"):
            inferred_bounces.validate_candidate(candidate)

    def test_card_input_sorts_copied_evidence_and_preserves_provenance(self):
        later = inferred_bounces.Observation(1.2, 120.0, 220.0, 8.0, True)
        earlier = inferred_bounces.Observation(1.1, 110.0, 210.0, None, False)
        card = inferred_bounces.CardInput(
            t0=1.0,
            t1=2.0,
            fps=30.0,
            width_px=1920.0,
            height_px=1080.0,
            observations=(later, earlier),
            hard_bounces=(),
            crossings=(1.6, 1.4),
            audio_impacts=((1.8, 0.5), (1.3, 0.7)),
            homography=np.eye(3),
        )

        self.assertEqual([o.t for o in card.observations], [1.1, 1.2])
        self.assertEqual(card.crossings, (1.4, 1.6))
        self.assertEqual(card.audio_impacts, ((1.3, 0.7), (1.8, 0.5)))
        self.assertFalse(card.observations[0].measured)
        self.assertTrue(card.observations[1].measured)

    def test_card_input_rejects_an_observation_outside_its_card(self):
        with self.assertRaisesRegex(ValueError, "outside card"):
            inferred_bounces.CardInput(
                t0=1.0,
                t1=2.0,
                fps=30.0,
                width_px=1920.0,
                height_px=1080.0,
                observations=(
                    inferred_bounces.Observation(
                        2.1, 120.0, 220.0, 8.0, True
                    ),
                ),
                hard_bounces=(),
                crossings=(),
                audio_impacts=(),
                homography=np.eye(3),
            )


class CandidateGenerationTests(unittest.TestCase):
    def test_overlapping_uncertainty_does_not_merge_distinct_event_times(self):
        seeds = [
            inferred_bounces.CandidateSeed(
                1.0, (0.90, 1.10), "subthreshold_curvature", 0.8
            ),
            inferred_bounces.CandidateSeed(
                1.1, (1.00, 1.20), "subthreshold_curvature", 0.7
            ),
        ]

        kept = inferred_bounces.deduplicate_candidate_seeds(seeds, fps=30.0)

        self.assertEqual([seed.estimate_s for seed in kept], [1.0, 1.1])

    def test_estimates_within_one_frame_keep_the_stronger_source(self):
        seeds = [
            inferred_bounces.CandidateSeed(
                1.0, (0.90, 1.10), "subthreshold_curvature", 0.6
            ),
            inferred_bounces.CandidateSeed(
                1.02, (0.95, 1.08), "weak_reversal", 0.8
            ),
        ]

        kept = inferred_bounces.deduplicate_candidate_seeds(seeds, fps=30.0)

        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0].method, "weak_reversal")

    def test_weak_reversal_below_the_normal_motion_gate_is_offered(self):
        card = synthetic_card([
            (0.00, 100.0, 100.0),
            (0.03, 101.0, 101.0),
            (0.07, 102.0, 101.6),
            (0.10, 103.0, 101.3),
            (0.13, 104.0, 100.8),
        ])

        seeds = inferred_bounces.generate_candidate_seeds(card)

        self.assertEqual(seeds[0].method, "weak_reversal")
        self.assertEqual(seeds[0].interval_s, (0.00, 0.13))

    def test_four_frame_spacing_can_offer_subthreshold_curvature(self):
        rows = []
        for frame in range(0, 25, 4):
            t = frame / 30.0
            rows.append((t, 200.0 + frame, 300.0 - (frame - 12) ** 2 / 8.0))
        card = synthetic_card(rows)

        seeds = inferred_bounces.generate_candidate_seeds(card)

        self.assertEqual(seeds[0].method, "subthreshold_curvature")
        self.assertEqual(
            seeds[0].interval_s,
            (rows[0][0], rows[6][0]),
        )

    def test_five_missing_frames_offer_an_occlusion_interval(self):
        rows = [
            (0.00, 100.0, 120.0),
            (0.03, 105.0, 125.0),
            (0.07, 110.0, 130.0),
            (0.27, 140.0, 126.0),
            (0.30, 145.0, 121.0),
            (0.33, 150.0, 116.0),
        ]
        card = synthetic_card(rows)

        seed = inferred_bounces.generate_candidate_seeds(card)[0]

        self.assertEqual(seed.method, "occlusion_bridge")
        self.assertEqual(seed.interval_s, (0.07, 0.27))

    def test_cross_table_origin_and_opposite_landing_offer_serve_flight_order(self):
        rows = [
            (0.10, 600.0, 180.0),
            (0.20, 610.0, 220.0),
            (0.30, 620.0, 270.0),
            (0.40, 630.0, 330.0),
            (0.50, 640.0, 390.0),
            (0.60, 650.0, 450.0),
            (0.70, 660.0, 510.0),
        ]
        landing = inferred_bounces.HardBounce(
            0.90, 700.0, 630.0, 0.70, 2.10, True
        )
        card = synthetic_card(rows, hard_bounces=(landing,), crossings=(0.55,))

        seeds = inferred_bounces.generate_candidate_seeds(card)

        self.assertIn("serve_flight_order", [seed.method for seed in seeds])

    def test_audio_without_visual_or_physical_seed_creates_nothing(self):
        rows = [
            (frame / 30.0, 100.0 + frame * 4.0, 200.0 + frame * 3.0)
            for frame in range(12)
        ]
        card = synthetic_card(rows, audio_impacts=((0.20, 0.95),))

        self.assertEqual(inferred_bounces.generate_candidate_seeds(card), [])

class HypothesisTests(unittest.TestCase):
    def test_continuous_model_wins_on_one_smooth_quadratic(self):
        rows = []
        for frame in range(31):
            t = frame / 30.0
            rows.append((t, 300.0 + 80.0 * t,
                         200.0 + 40.0 * t + 15.0 * t * t))

        comparison = inferred_bounces.compare_hypotheses(
            observations(rows), candidate_t=0.5,
            width_px=1920.0, height_px=1080.0,
        )

        self.assertEqual(comparison.preferred, "continuous_airborne")
        self.assertLess(comparison.margin, 0.0)

    def test_latent_model_wins_on_a_masked_velocity_reversal(self):
        rows = []
        for frame in range(31):
            t = frame / 30.0
            y = 200.0 + (80.0 * t if t <= 0.5 else 40.0 - 65.0 * (t - 0.5))
            rows.append((t, 300.0 + 60.0 * t, y))

        comparison = inferred_bounces.compare_hypotheses(
            observations(rows), candidate_t=0.5,
            width_px=1920.0, height_px=1080.0,
        )

        self.assertEqual(comparison.preferred, "latent_bounce")
        self.assertGreater(comparison.margin, 2.0)

    def test_interval_scan_never_evaluates_past_the_hidden_window(self):
        rows = []
        bounce_t = 0.5002
        for frame in range(31):
            t = frame / 30.0
            y = (200.0 + 80.0 * t if t <= bounce_t else
                 200.0 + 80.0 * bounce_t - 65.0 * (t - bounce_t))
            rows.append((t, 300.0 + 60.0 * t, y))

        comparison = inferred_bounces.compare_hypotheses(
            observations(rows),
            candidate_t=0.4,
            width_px=1920.0,
            height_px=1080.0,
            interval_s=(0.3, 0.5),
            fps=29.976,
        )

        self.assertGreaterEqual(comparison.estimate_s, 0.3)
        self.assertLessEqual(comparison.estimate_s, 0.5)
        self.assertLessEqual(comparison.interval_s[1], 0.5)


def support_kinds(candidate):
    return {item["kind"] for item in candidate["support"]}


def veto_kinds(candidate):
    return {item["kind"] for item in candidate["vetoes"]}


class InferenceTests(unittest.TestCase):
    def test_detector_timestamp_jitter_does_not_reemit_a_hard_bounce(self):
        base = missing_first_serve_card()
        detected = inferred_bounces.HardBounce(
            0.3 + 1.1 / 30.0, 165.0, 206.0, 0.69, 0.55, True
        )
        card = replace(
            base, hard_bounces=(detected,) + base.hard_bounces
        )

        candidates = inferred_bounces.infer_card_bounces(card)["candidates"]

        self.assertFalse(any(abs(candidate["time"]["estimate_s"] - 0.3)
                             < 0.08 for candidate in candidates))

    def test_cross_table_origin_plus_opposite_landing_is_serve_first_context(self):
        envelope = inferred_bounces.infer_card_bounces(
            missing_first_serve_card()
        )

        candidate = min(
            envelope["candidates"],
            key=lambda item: abs(item["time"]["estimate_s"] - 0.3),
        )
        self.assertEqual(candidate["context"], "serve_first_bounce")
        self.assertIn("opposite_half_landing", support_kinds(candidate))

    def test_active_crossing_chain_classifies_a_later_bounce_as_mid_rally(self):
        card = synthetic_card(
            missing_serve_rows(),
            crossings=(0.2, 0.77),
            audio_impacts=((0.31, 1.0),),
            accepted_serve_bounces=(0.1,),
            homography=flight_homography(),
        )

        envelope = inferred_bounces.infer_card_bounces(card)
        candidate = min(
            envelope["candidates"],
            key=lambda item: abs(item["time"]["estimate_s"] - 0.3),
        )

        self.assertEqual(candidate["context"], "mid_rally")

    def test_one_prior_crossing_does_not_override_cross_table_serve_order(self):
        card = replace(
            missing_first_serve_card(),
            crossings=(0.2, 0.77),
        )

        candidate = min(
            inferred_bounces.infer_card_bounces(card)["candidates"],
            key=lambda item: abs(item["time"]["estimate_s"] - 0.3),
        )

        self.assertEqual(candidate["context"], "serve_first_bounce")

    def test_old_unrelated_table_bounce_does_not_mark_the_serve_as_mid_rally(self):
        base = missing_first_serve_card()
        old = inferred_bounces.HardBounce(
            -1.5, 600.0, 194.0, 0.6467, 2.0, True
        )
        card = replace(
            base,
            t0=-2.0,
            hard_bounces=(old,) + base.hard_bounces,
        )

        candidate = inferred_bounces.infer_card_bounces(card)["candidates"][0]

        self.assertEqual(candidate["context"], "serve_first_bounce")

    def test_paddle_contact_veto_caps_tier_and_prevents_constraint(self):
        contact = inferred_bounces.KnownContact(0.3, "paddle", 0.95)

        candidate = inferred_bounces.infer_card_bounces(
            missing_first_serve_card(known_contacts=(contact,))
        )["candidates"][0]

        self.assertIn("paddle_contact", veto_kinds(candidate))
        self.assertNotEqual(candidate["confidence"]["tier"], "high")
        self.assertFalse(
            candidate["trajectory_constraint"]["safe_to_constrain_z0"]
        )

    def test_strong_event_can_have_no_defensible_coordinate(self):
        card = missing_first_serve_card(
            occluded=True, outbound_shift_px=80.0
        )

        candidate = inferred_bounces.infer_card_bounces(card)["candidates"][0]

        self.assertEqual(candidate["confidence"]["tier"], "high")
        self.assertIsNone(candidate["table_position"])
        self.assertFalse(
            candidate["trajectory_constraint"]["safe_to_constrain_z0"]
        )

    def test_stamped_confidence_is_always_display_only(self):
        candidate = inferred_bounces.infer_card_bounces(
            missing_first_serve_card(measured=False),
            constraint_gate_enabled=True,
        )["candidates"][0]

        self.assertFalse(
            candidate["trajectory_constraint"]["safe_to_constrain_z0"]
        )
        self.assertIn(
            "measured", candidate["trajectory_constraint"]["reason"]
        )

    def test_global_gate_keeps_even_a_high_coordinate_candidate_display_only(self):
        candidate = inferred_bounces.infer_card_bounces(
            missing_first_serve_card()
        )["candidates"][0]

        self.assertEqual(candidate["confidence"]["tier"], "high")
        self.assertIsNotNone(candidate["table_position"])
        self.assertEqual(
            candidate["trajectory_constraint"],
            {
                "safe_to_constrain_z0": False,
                "mode": "display_only",
                "reason": "The global shadow constraint gate is disabled.",
            },
        )
        self.assertLessEqual(candidate["time"]["interval_s"][0], 7 / 30)
        self.assertGreaterEqual(candidate["time"]["interval_s"][1], 11 / 30)

    def test_holdout_wins_are_serialized_as_explainable_support(self):
        candidate = inferred_bounces.infer_card_bounces(
            missing_first_serve_card()
        )["candidates"][0]
        support = {item["kind"]: item["strength"]
                   for item in candidate["support"]}

        self.assertEqual(support["inbound_holdout_win"], 1.0)
        self.assertEqual(support["outbound_holdout_win"], 1.0)

    def test_unhealthy_calibration_is_vetoed_and_has_no_coordinate(self):
        card = synthetic_card(
            missing_serve_rows(),
            crossings=(0.77,),
            calibration_healthy=False,
            homography=flight_homography(),
        )

        candidate = inferred_bounces.infer_card_bounces(card)["candidates"][0]

        self.assertIn("unhealthy_calibration", veto_kinds(candidate))
        self.assertIsNone(candidate["table_position"])

    def test_net_contact_explains_the_reversal_instead_of_a_table_bounce(self):
        contact = inferred_bounces.KnownContact(0.3, "net", 0.9)

        candidate = inferred_bounces.infer_card_bounces(
            missing_first_serve_card(known_contacts=(contact,))
        )["candidates"][0]

        self.assertIn("net_contact", veto_kinds(candidate))
        self.assertNotEqual(candidate["confidence"]["tier"], "high")

    def test_pass_followed_by_reverse_crossing_is_retained_as_handoff_diagnostic(self):
        card = replace(
            missing_first_serve_card(),
            t1=2.3,
            crossings=(0.77, 2.10),
        )

        candidate = inferred_bounces.infer_card_bounces(card)["candidates"][0]

        self.assertIn("possible_handoff_reverse_flight", veto_kinds(candidate))
        self.assertEqual(candidate["trajectory_constraint"]["mode"],
                         "display_only")

    def test_quick_receiver_return_is_not_mislabeled_as_a_handoff(self):
        card = replace(
            missing_first_serve_card(),
            crossings=(0.77, 1.10),
        )

        candidate = inferred_bounces.infer_card_bounces(card)["candidates"][0]

        self.assertNotIn("possible_handoff_reverse_flight",
                         veto_kinds(candidate))

    def test_quick_return_takes_precedence_over_a_later_crossing(self):
        card = replace(
            missing_first_serve_card(),
            t1=2.3,
            crossings=(0.77, 1.10, 2.10),
        )

        candidate = inferred_bounces.infer_card_bounces(card)["candidates"][0]

        self.assertNotIn("possible_handoff_reverse_flight",
                         veto_kinds(candidate))

    def test_contiguous_neighbouring_ball_jump_is_vetoed(self):
        rows = missing_serve_rows()
        jumped = []
        for t, x, y in rows:
            jumped.append((t, x + (500.0 if abs(t - 0.5) < 0.01 else 0.0), y))
        landing = inferred_bounces.HardBounce(
            1.0, 560.0, 194.0, 194.0 / 300.0, 560.0 / 300.0, True
        )
        card = synthetic_card(
            jumped,
            hard_bounces=(landing,),
            crossings=(0.77,),
            audio_impacts=((0.31, 1.0),),
            homography=flight_homography(),
        )

        candidate = inferred_bounces.infer_card_bounces(card)["candidates"][0]

        self.assertIn("identity_jump", veto_kinds(candidate))

    def test_identity_jump_late_in_the_rally_does_not_veto_an_earlier_bounce(self):
        rows = missing_serve_rows()
        jumped = []
        for t, x, y in rows:
            jumped.append((t, x + (500.0 if abs(t - 0.9) < 0.01 else 0.0), y))
        landing = inferred_bounces.HardBounce(
            1.0, 560.0, 194.0, 194.0 / 300.0, 560.0 / 300.0, True
        )
        card = synthetic_card(
            jumped,
            hard_bounces=(landing,),
            crossings=(0.77,),
            audio_impacts=((0.31, 1.0),),
            homography=flight_homography(),
        )

        candidate = inferred_bounces.infer_card_bounces(card)["candidates"][0]

        self.assertNotIn("identity_jump", veto_kinds(candidate))

    def test_airborne_plane_projection_does_not_create_a_speed_veto(self):
        rows = []
        for frame in range(3, 28):
            t = frame / 30.0
            x = 10.0 + 2.0 * t + (60.0 if t >= 0.6 else 0.0)
            y = 200.0 + (20.0 * t if t <= 0.3
                         else 6.0 - 18.0 * (t - 0.3))
            rows.append((t, x, y))
        speed_homography = np.array([
            [0.0, 1.0 / 300.0, 0.0],
            [0.02, 0.0, 0.0],
            [0.0, 0.0, 1.0],
        ])
        card = synthetic_card(rows, homography=speed_homography)

        candidate = inferred_bounces.infer_card_bounces(card)["candidates"][0]

        self.assertNotIn("impossible_speed", veto_kinds(candidate))

    def test_impossible_speed_between_two_surface_events_is_vetoed(self):
        landing = inferred_bounces.HardBounce(
            0.355, 810.0, 194.0, 0.6467, 2.70, True
        )
        card = synthetic_card(
            missing_serve_rows(),
            hard_bounces=(landing,),
            crossings=(0.34,),
            audio_impacts=((0.31, 1.0),),
            homography=flight_homography(),
        )

        candidate = min(
            inferred_bounces.infer_card_bounces(card)["candidates"],
            key=lambda item: abs(item["time"]["estimate_s"] - 0.3),
        )

        self.assertIn("impossible_speed", veto_kinds(candidate))


if __name__ == "__main__":
    unittest.main()
