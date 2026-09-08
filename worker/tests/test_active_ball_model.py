import unittest
import torch
from worker.active_ball_model import ActiveBallNet, ball_target


class ModelTests(unittest.TestCase):
    def test_visible_target_stays_at_source_coordinate_after_resize(self):
        target=ball_target({'state':'visible','x':960,'y':540},1920,1080,48,32)
        self.assertEqual(tuple(torch.nonzero(target == target.max())[0].tolist()), (16,24))

    def test_hidden_target_has_no_invented_positive(self):
        target=ball_target({'state':'hidden','x':None,'y':None},1920,1080,48,32)
        self.assertEqual(float(target.sum()),0)

    def test_temporal_model_backpropagates_finite_loss(self):
        model=ActiveBallNet()
        x=torch.rand(2,11,64,96)
        heat,visible=model(x)
        self.assertEqual(tuple(heat.shape),(2,1,32,48))
        self.assertEqual(tuple(visible.shape),(2,))
        loss=heat.square().mean()+visible.square().mean();loss.backward()
        self.assertTrue(all(p.grad is not None and torch.isfinite(p.grad).all() for p in model.parameters()))


if __name__ == '__main__':unittest.main()
