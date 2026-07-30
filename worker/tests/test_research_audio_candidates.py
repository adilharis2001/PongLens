import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np

from worker.research_audio_candidates import (
    TARGET_SAMPLE_RATE,
    analyze_samples,
    point_audio_impacts,
)


def _synthetic_impacts(times):
    samples = np.zeros(int(TARGET_SAMPLE_RATE * 1.2), dtype=np.float32)
    burst_size = round(TARGET_SAMPLE_RATE * 0.004)
    window = np.hanning(burst_size)
    phase = np.arange(burst_size) / TARGET_SAMPLE_RATE
    burst = 0.9 * np.sin(2 * np.pi * 14_000 * phase) * window
    for timestamp in times:
        start = round(timestamp * TARGET_SAMPLE_RATE)
        samples[start : start + burst_size] += burst.astype(np.float32)
    return samples


class AudioCandidateTests(unittest.TestCase):
    def test_three_short_high_frequency_impacts_are_returned_in_time_order(self):
        expected = [0.25, 0.52, 0.79]

        result = analyze_samples(_synthetic_impacts(expected))

        times = [
            candidate["time_s"] for candidate in result["candidates"]
        ]
        self.assertEqual(len(times), 3)
        self.assertEqual(times, sorted(times))
        for actual, target in zip(times, expected):
            self.assertLess(abs(actual - target), 0.01)

    def test_point_adapter_uses_placement_reconstruction_schema(self):
        samples = _synthetic_impacts([0.25, 0.52, 0.79])
        pcm = np.clip(samples * 32767, -32768, 32767).astype("<i2")
        with tempfile.TemporaryDirectory() as directory:
            clip_path = Path(directory) / "impacts.wav"
            with wave.open(str(clip_path), "wb") as destination:
                destination.setnchannels(1)
                destination.setsampwidth(2)
                destination.setframerate(TARGET_SAMPLE_RATE)
                destination.writeframes(pcm.tobytes())

            impacts = point_audio_impacts(clip_path)

        self.assertEqual(len(impacts), 3)
        self.assertEqual(set(impacts[0]), {"t", "confidence"})
        self.assertEqual(
            [impact["t"] for impact in impacts],
            sorted(impact["t"] for impact in impacts),
        )

    def test_rejects_an_unexpected_sample_rate(self):
        with self.assertRaisesRegex(ValueError, "sample rate"):
            analyze_samples(
                np.zeros(100, dtype=np.float32),
                sample_rate=16_000,
            )


if __name__ == "__main__":
    unittest.main()
