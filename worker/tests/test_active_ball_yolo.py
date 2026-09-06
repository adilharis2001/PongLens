import unittest

import cv2
import numpy as np

from worker.active_ball_yolo import focus_selected_table, yolo_label


class ActiveBallYoloTests(unittest.TestCase):
    def test_selected_table_focus_dims_far_background(self):
        image=np.full((200,300,3),200,np.uint8)
        corners=[[110,140],[190,140],[175,100],[125,100]]
        focused=focus_selected_table(image,corners)
        self.assertEqual(tuple(focused.shape),tuple(image.shape))
        self.assertLess(int(focused[10,10,0]),int(focused[120,150,0]))

    def test_visible_label_becomes_clipped_normalized_box(self):
        line=yolo_label({'state':'visible','x':100,'y':50},200,100,box_px=32)
        values=[float(value) for value in line.split()[1:]]
        self.assertEqual(line.split()[0],'0')
        self.assertAlmostEqual(values[0],.5)
        self.assertAlmostEqual(values[1],.5)
        self.assertAlmostEqual(values[2],.16)
        self.assertAlmostEqual(values[3],.32)
        self.assertEqual(yolo_label({'state':'hidden','x':None,'y':None},200,100),'')


if __name__=='__main__':unittest.main()
