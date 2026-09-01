import unittest

import numpy as np

from worker.research_audio_candidates import (
    analyze_samples,
    merge_detector_candidates,
)


SAMPLE_RATE = 48_000


def burst(samples, *, time_s, frequency_hz, duration_s, amplitude=1.0):
    start = round(time_s * SAMPLE_RATE)
    length = round(duration_s * SAMPLE_RATE)
    phase = np.arange(length, dtype=np.float64) / SAMPLE_RATE
    window = np.hanning(length)
    samples[start:start + length] += (
        amplitude * np.sin(2 * np.pi * frequency_hz * phase) * window
    ).astype(np.float32)


class DualBandDetectionTests(unittest.TestCase):
    def test_high_click_and_low_stomp_keep_distinct_detector_provenance(self):
        samples = np.zeros(SAMPLE_RATE * 2, dtype=np.float32)
        burst(
            samples,
            time_s=0.5,
            frequency_hz=12_000,
            duration_s=0.008,
        )
        burst(
            samples,
            time_s=1.0,
            frequency_hz=120,
            duration_s=0.06,
        )

        result = analyze_samples(samples, SAMPLE_RATE)
        high = min(result["uncapped_candidates"], key=lambda item: abs(item["time_s"] - 0.5))
        low = min(result["uncapped_candidates"], key=lambda item: abs(item["time_s"] - 1.0))

        self.assertLess(abs(high["time_s"] - 0.5), 0.02)
        self.assertIn("high_frequency", high["detector_origins"])
        self.assertLess(abs(low["time_s"] - 1.0), 0.04)
        self.assertIn("low_frequency", low["detector_origins"])
        self.assertEqual(result["sample_rate"], SAMPLE_RATE)
        self.assertEqual(result["native_sample_rate"], SAMPLE_RATE)

    def test_nearby_dual_band_detections_merge_with_both_raw_scores(self):
        merged = merge_detector_candidates(
            [
                {
                    "time_s": 1.0,
                    "detector": "high_frequency",
                    "score": 4.0,
                    "energy": 0.4,
                },
                {
                    "time_s": 1.03,
                    "detector": "low_frequency",
                    "score": 7.0,
                    "energy": 0.7,
                },
                {
                    "time_s": 1.08,
                    "detector": "low_frequency",
                    "score": 3.0,
                    "energy": 0.3,
                },
            ],
            tolerance_s=0.035,
        )

        self.assertEqual(len(merged), 2)
        self.assertEqual(
            merged[0]["detector_origins"],
            ["high_frequency", "low_frequency"],
        )
        self.assertEqual(
            merged[0]["detector_scores"],
            {"high_frequency": 4.0, "low_frequency": 7.0},
        )
        self.assertEqual(merged[0]["time_s"], 1.03)

    def test_candidate_ids_and_control_sampling_are_deterministic_and_bounded(self):
        samples = np.zeros(SAMPLE_RATE * 3, dtype=np.float32)
        for index, time_s in enumerate([0.3, 0.7, 1.1, 1.5, 1.9, 2.3, 2.7]):
            burst(
                samples,
                time_s=time_s,
                frequency_hz=12_000 if index % 2 == 0 else 120,
                duration_s=0.01 if index % 2 == 0 else 0.05,
            )

        first = analyze_samples(samples, SAMPLE_RATE)
        second = analyze_samples(samples, SAMPLE_RATE)

        self.assertEqual(first["candidates"], second["candidates"])
        self.assertGreaterEqual(len(first["candidates"]), 9)
        self.assertLessEqual(len(first["candidates"]), 14)
        self.assertTrue(
            any(
                item["detector_origins"] == ["control"]
                for item in first["candidates"]
            )
        )
        self.assertTrue(
            all("semantic_class" not in item for item in first["candidates"])
        )

    def test_candidate_ids_bind_source_and_detector_version(self):
        samples = np.zeros(SAMPLE_RATE, dtype=np.float32)

        first = analyze_samples(samples, SAMPLE_RATE, source_id="source-a")
        second = analyze_samples(samples, SAMPLE_RATE, source_id="source-b")

        self.assertNotEqual(
            [item["id"] for item in first["candidates"]],
            [item["id"] for item in second["candidates"]],
        )

    def test_native_44100_hz_audio_is_not_claimed_as_resampled(self):
        sample_rate = 44_100
        samples = np.zeros(sample_rate, dtype=np.float32)

        result = analyze_samples(samples, sample_rate)

        self.assertEqual(result["sample_rate"], sample_rate)
        self.assertEqual(result["duration_s"], 1.0)
        self.assertEqual(result["waveform_bin_ms"], 10)


if __name__ == "__main__":
    unittest.main()
