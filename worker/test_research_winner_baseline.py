"""Synthetic machine evidence tests; no private data or score labels."""
import copy
import unittest


class BaselineTests(unittest.TestCase):
    def row(self):
        return dict(features=dict(start=0.,end=5.,width=200,height=100,fps=30.,
                    track=[[0.,.5,.5],[.1,.5,.6]],candidates=[]),
                    corners=dict(A_near_1=[20,80],B_near_2=[180,80],
                                 C_far_2=[140,20],D_far_1=[60,20]),serve_s=None)
    def corpus(self):
        return dict(sequences=[],crossings=[],provenance='synthetic whole-recording machine evidence')
    def sequence(self):
        return dict(first=2.,last=3.,n_bounces=3,half='near',arcs=[],
                    bounces=[dict(t=t,v=.5,half='near') for t in [2.,2.4,3.]],
                    net_motion=dict(t=1.8,absorbed=True,reversed=False,in_wps=1.,out_wps=0.))
    def run_rule(self,row=None,corpus=None):
        from research_winner_baseline import decide
        return decide(self.row() if row is None else row,self.corpus() if corpus is None else corpus)
    def test_known_empty_evidence_is_valid_abstention(self):
        r=self.run_rule();self.assertEqual(r['status'],'available')
        self.assertEqual([r[k] for k in ['existing_net','legacy','new_net_association']],[None]*3)
        self.assertFalse(r['net_veto'])
    def test_missing_corpus_cannot_become_negative_net_evidence(self):
        from research_winner_baseline import decide
        for c in [None,{},dict(sequences=None,crossings=[],provenance='x')]:
            r=decide(self.row(),c);self.assertEqual(r['status'],'unavailable');self.assertNotIn('existing_net',r)
    def test_terminal_near_net_sequence_awards_far(self):
        c=self.corpus();c['sequences']=[self.sequence()];r=self.run_rule(corpus=c)
        self.assertEqual(r['existing_net'],'far');self.assertEqual(r['new_net_association'],'far')
    def test_crossing_after_net_motion_vetoes_stale_event(self):
        c=self.corpus();c['sequences']=[self.sequence()];c['crossings']=[1.95];r=self.run_rule(corpus=c)
        self.assertIsNone(r['existing_net']);self.assertIsNone(r['new_net_association']);self.assertTrue(r['net_veto'])
    def test_labels_ids_and_owner_serves_never_change_decision(self):
        row=self.row();c=self.corpus();c['sequences']=[self.sequence()]
        expected=self.run_rule(copy.deepcopy(row),copy.deepcopy(c))
        original=copy.deepcopy((row,c));self.run_rule(row,c);self.assertEqual((row,c),original)
        row.update(point_id='POISON',winner='near',tap_s=-999,score=[11,0]);row['features'].update(idx='POISON',server='near',owner_end_s=-999)
        c['serves']=[1.,2.,3.];c['sequences'][0]['owner_label']='POISON'
        self.assertEqual(self.run_rule(row,c),expected)
    def test_broken_nested_sequence_abstains(self):
        for s in [None,{},dict(self.sequence(),bounces=[None]),dict(self.sequence(),half='unknown')]:
            c=self.corpus();c['sequences']=[s];r=self.run_rule(corpus=c);self.assertEqual(r['status'],'unavailable')
    def test_singular_calibration_is_unavailable(self):
        row=self.row()
        row['corners']=dict(A_near_1=[20,80],B_near_2=[180,80],C_far_2=[100,80],D_far_1=[140,80])
        self.assertEqual(self.run_rule(row)['status'],'unavailable')
    def test_frame_departure_requires_two_consistent_outward_steps(self):
        from research_winner_baseline.frame_exit import departure
        points=[dict(t=i/30,x=x,y=50) for i,x in enumerate([170,180,190])]
        self.assertEqual(departure(points,200,100,30)['edge'],'right');points[0]['x']=195
        self.assertIsNone(departure(points,200,100,30))

if __name__=='__main__':unittest.main()
