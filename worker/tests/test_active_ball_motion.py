import unittest
import numpy as np
import cv2
from worker.active_ball_motion import ball_candidates, motion_candidates, consistent_candidate


class MotionTests(unittest.TestCase):
    def test_ball_candidates_include_stationary_white_and_orange_balls_but_not_line(self):
        frames = [np.zeros((160, 240, 3), np.uint8) for _ in range(3)]
        for frame in frames:
            cv2.circle(frame, (60, 70), 5, (245, 245, 245), -1)
            cv2.circle(frame, (170, 90), 5, (20, 125, 245), -1)
            cv2.line(frame, (20, 130), (220, 130), (255, 255, 255), 3)
        candidates = ball_candidates(frames)
        self.assertTrue(any(np.hypot(c['x'] - 60, c['y'] - 70) < 3 for c in candidates))
        self.assertTrue(any(np.hypot(c['x'] - 170, c['y'] - 90) < 3 for c in candidates))
        self.assertFalse(any(abs(c['y'] - 130) < 3 for c in candidates))

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

    def test_temporal_filter_rejects_slow_logo_and_keeps_fast_straight_flight(self):
        point=lambda x:{'x':x,'y':60.}
        self.assertIsNone(consistent_candidate([point(98)],[point(100)],[point(102)],[0,1/30,2/30],300))
        self.assertEqual(consistent_candidate([point(70)],[point(100)],[point(130)],[0,1/30,2/30],300),point(100))

    def test_two_plausible_balls_are_left_ambiguous(self):
        point=lambda x,y:{'x':x,'y':y}
        self.assertIsNone(consistent_candidate([point(70,60),point(70,100)],[point(100,60),point(100,100)],[point(130,60),point(130,100)],[0,1/30,2/30],300))
