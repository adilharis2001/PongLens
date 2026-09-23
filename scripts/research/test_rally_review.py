import unittest,importlib.util,copy
from pathlib import Path
spec=importlib.util.spec_from_file_location('rally',Path(__file__).with_name('rally-review.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Mapping(unittest.TestCase):
 def test_post_rally_activity_and_raw_clock(self):
  h={'histories':[{'events':[[1,'bounce_near'],[4,'bounce_far'],[6,'dead_activity']], 'weight':.7},{'events':[[3,'bounce_near']], 'weight':.3}]}
  e={'rawOffset':240,'bounces':[{'t':4.01}]};s={'fps':30,'start':240,'end':250}
  p=m.last_bounce('11111111-1111-4111-8111-111111111111',h,e,s)
  self.assertEqual(p['id'],'detected:0');self.assertEqual(p['rawTime'],244.01);self.assertAlmostEqual(p['agreement'],.7)
 def test_inferred_landing_before_contact_is_not_contact_frame_bounce(self):
  h={'histories':[{'events':[[4,'inferred_landing_then_hit_near']], 'weight':1}]}
  self.assertIsNone(m.last_bounce('11111111-1111-4111-8111-111111111111',h,{'rawOffset':0,'bounces':[]},{'fps':30,'start':0,'end':10}))
 def test_candidate_without_detector_marker_is_explicit_inference(self):
  h={'histories':[{'events':[[4,'bounce_near']], 'weight':1}]}
  p=m.last_bounce('11111111-1111-4111-8111-111111111111',h,{'rawOffset':0,'bounces':[]},{'fps':30,'start':0,'end':10})
  self.assertTrue(p['id'].startswith('added:'));self.assertEqual(p['rawTime'],4);self.assertEqual(p['origin'],'trajectory')
 def test_outside_point_is_not_clamped_into_a_false_bounce(self):
  h={'histories':[{'events':[[14,'bounce_near']], 'weight':1}]}
  self.assertIsNone(m.last_bounce('11111111-1111-4111-8111-111111111111',h,{'rawOffset':0,'bounces':[]},{'fps':30,'start':0,'end':10}))
 def test_human_labels_do_not_enter_predictions(self):
  h={'histories':[{'events':[[4,'bounce_near']], 'weight':1}]};e={'rawOffset':0,'bounces':[{'t':4}]};s={'fps':30,'start':0,'end':10}
  a=m.last_bounce('11111111-1111-4111-8111-111111111111',h,e,s)
  s.update(label={'lastBounce':'POISON'},winner='POISON',tap=999)
  self.assertEqual(a,m.last_bounce('11111111-1111-4111-8111-111111111111',h,e,s))
if __name__=='__main__':unittest.main()
