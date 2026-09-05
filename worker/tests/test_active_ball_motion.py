import unittest
import numpy as np
import cv2
from worker.active_ball_motion import motion_candidates


class MotionTests(unittest.TestCase):
    def test_moving_ball_survives_but_stationary_white_decoy_does_not(self):
        frames=[]
        for x in [70,80,90]:
            image=np.zeros((120,200,3),np.uint8)
            cv2.circle(image,(x,60),3,(245,245,245),-1)
            cv2.circle(image,(150,60),4,(255,255,255),-1)
            frames.append(image)
        candidates=motion_candidates(frames)
        self.assertEqual(len(candidates),1)
        self.assertAlmostEqual(candidates[0]['x'],80,delta=1)
        self.assertAlmostEqual(candidates[0]['y'],60,delta=1)

    def test_no_motion_yields_no_candidates(self):
        image=np.full((120,200,3),200,np.uint8)
        self.assertEqual(motion_candidates([image,image,image]),[])
