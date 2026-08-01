import tempfile
import unittest
from pathlib import Path

import torch

from worker.temporal_serve_model import (
    PairedServeGRU,
    decode_point_likelihood,
    multiple_instance_loss,
)


class ModelTests(unittest.TestCase):
    def test_paired_production_model_is_equivariant_to_swapping_players(self):
        torch.manual_seed(5)
        model = PairedServeGRU(feature_width=125).eval()
        features = torch.randn(2, 9, 125)
        mask = torch.ones(2, 9, dtype=torch.bool)
        original = model(features, mask)["logits"]

        swapped = features.clone()
        swapped[:, :, :59] = features[:, :, 59:118]
        swapped[:, :, 59:118] = features[:, :, :59]
        swapped_output = model(swapped, mask)["logits"]

        self.assertTrue(
            torch.allclose(original[:, :, 0], swapped_output[:, :, 1], atol=1e-6)
        )
        self.assertTrue(
            torch.allclose(original[:, :, 1], swapped_output[:, :, 0], atol=1e-6)
        )

    def test_forward_returns_two_player_window_scores_and_masks_attention(self):
        torch.manual_seed(7)
        model = PairedServeGRU(feature_width=48)
        mask = torch.tensor(
            [[1] * 72, [1] * 36 + [0] * 36],
            dtype=torch.bool,
        )
        output = model(torch.zeros(2, 72, 48), mask)

        self.assertEqual(tuple(output["logits"].shape), (2, 72, 2))
        self.assertEqual(tuple(output["attention"].shape), (2, 72))
        self.assertTrue(torch.isfinite(output["attention"]).all())
        self.assertAlmostEqual(float(output["attention"][1, 36:].sum()), 0.0, places=6)
        self.assertAlmostEqual(float(output["attention"][1, :36].sum()), 1.0, places=6)

    def test_loss_rewards_the_true_server_peak(self):
        output = {
            "logits": torch.tensor([[[4.0, -2.0], [3.0, -1.0]]]),
            "mask": torch.ones(1, 2, dtype=torch.bool),
        }
        correct = multiple_instance_loss(output, torch.tensor([0]))
        reversed_loss = multiple_instance_loss(output, torch.tensor([1]))
        self.assertLess(float(correct), float(reversed_loss))

    def test_loss_ignores_padding_and_penalizes_clean_negative_frames(self):
        output = {
            "logits": torch.tensor([[[3.0, -2.0], [-2.0, -2.0], [50.0, 50.0]]]),
            "mask": torch.tensor([[1, 1, 0]], dtype=torch.bool),
        }
        baseline = multiple_instance_loss(output, torch.tensor([0]))
        penalized = multiple_instance_loss(
            output,
            torch.tensor([0]),
            clean_negative_mask=torch.tensor([[0, 1, 0]], dtype=torch.bool),
        )
        self.assertGreater(float(penalized), float(baseline))

    def test_decode_picks_side_and_exact_peak_time(self):
        output = {
            "logits": torch.tensor(
                [[[-3.0, -4.0], [-2.0, 1.0], [-1.0, 5.0], [-4.0, -3.0]]]
            ),
            "attention": torch.tensor([[0.1, 0.2, 0.6, 0.1]]),
            "mask": torch.ones(1, 4, dtype=torch.bool),
        }
        decoded = decode_point_likelihood(output, [0.0, 0.1, 0.2, 0.3])

        self.assertEqual(decoded["predicted_side"], "far")
        self.assertEqual(decoded["peak_index"], 2)
        self.assertAlmostEqual(decoded["onset_t"], 0.2)
        self.assertGreater(decoded["confidence"], 0.9)
        self.assertNotIn("target", decoded)

    def test_state_dict_round_trip_is_identical(self):
        torch.manual_seed(11)
        model = PairedServeGRU(feature_width=8).eval()
        features = torch.randn(1, 5, 8)
        mask = torch.ones(1, 5, dtype=torch.bool)
        expected = model(features, mask)["logits"]

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.pt"
            torch.save(model.state_dict(), path)
            restored = PairedServeGRU(feature_width=8).eval()
            restored.load_state_dict(torch.load(path, weights_only=True))

        actual = restored(features, mask)["logits"]
        self.assertTrue(torch.equal(expected, actual))


if __name__ == "__main__":
    unittest.main()
