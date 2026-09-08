import unittest
from worker.active_ball_benchmark import score

class BenchmarkTests(unittest.TestCase):
    def test_visible_misses_stay_in_recall_denominator(self):
        rows=[{'id':'a','label':{'state':'visible','x':100,'y':100}}, {'id':'b','label':{'state':'visible','x':100,'y':100}}, {'id':'c','label':{'state':'absent','x':None,'y':None}}]
        predictions={'a':{'state':'visible','x':103,'y':104},'b':{'state':'hidden','x':None,'y':None},'c':{'state':'visible','x':50,'y':50}}
        s=score(rows,predictions)
        self.assertEqual(s['visible_reference'],2)
        self.assertEqual(s['within_20px'],1)
        self.assertEqual(s['visible_missed'],1)
        self.assertEqual(s['false_visible'],1)
        self.assertEqual(s['state_agreement'],1)
        self.assertEqual(s['median_error_when_both_visible_px'],5)
    def test_missing_api_responses_are_not_counted_as_absent_or_success(self):
        s=score([{'id':'x','label':{'state':'absent','x':None,'y':None}}],{})
        self.assertEqual(s['invalid_or_missing'],1)
        self.assertEqual(s['state_agreement'],0)
    def test_far_away_visible_mark_is_a_location_error_even_if_state_agrees(self):
        s=score([{'id':'x','label':{'state':'visible','x':0,'y':0}}],{'x':{'state':'visible','x':300,'y':400}})
        self.assertEqual(s['within_40px'],0)
        self.assertEqual(s['state_agreement'],1)
        self.assertEqual(s['median_error_when_both_visible_px'],500)

if __name__=='__main__':unittest.main()
