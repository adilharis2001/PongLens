import unittest
import torch
from worker.predict_active_ball import decode_prediction


class PredictionTests(unittest.TestCase):
    def test_peak_maps_back_to_source_pixels(self):
        heat=torch.zeros(32,48);heat[16,12]=20
        p=decode_prediction(heat,torch.tensor(10.),1920,1080)
        self.assertEqual((p['state'],p['x'],p['y']),('visible',480.,540.))

    def test_hidden_prediction_has_no_fabricated_coordinate(self):
        p=decode_prediction(torch.zeros(32,48),torch.tensor(-10.),1920,1080)
        self.assertEqual((p['state'],p['x'],p['y']),('hidden',None,None))
