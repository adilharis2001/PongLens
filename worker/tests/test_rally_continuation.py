"""Catch retrieval crossings being allowed to substitute for table play."""
import unittest,copy
import numpy as np
from worker.rally_preservation import join_supported_continuations as guarded_continuations

class GuardTests(unittest.TestCase):
    def setUp(self):
        self.cards=[dict(t0=10.,t1=20.,serve_s=11.,end_evidence_s=19.),dict(t0=21.,t1=30.,serve_s=22.,end_evidence_s=29.)]
        T=np.arange(0.,40.,.1)
        self.args=dict(cards=self.cards,T=T,p=np.full(len(T),.9),near=np.ones(len(T),bool),far=np.ones(len(T),bool),events=[19.8,20.3,20.7,21.2],dead_runs=[])
    def run_rule(self,bt):return guarded_continuations(**self.args,table_bounces=bt)
    def test_crossings_without_table_bounces_keep_cards_separate(self):
        self.assertEqual(self.run_rule([])[0],self.cards)
    def test_bounces_only_before_break_do_not_prove_continuation(self):
        self.assertEqual(self.run_rule([19.8,20.2])[0],self.cards)
    def test_remote_bounces_do_not_bridge_retrieval(self):
        self.assertEqual(self.run_rule([17.,24.])[0],self.cards)
    def test_bounce_gap_cannot_be_filled_by_crossings(self):
        self.assertEqual(self.run_rule([19.7,21.3])[0],self.cards)
    def test_actual_table_play_keeps_outer_edges_and_first_serve(self):
        out,d=self.run_rule([20.3,20.7]);self.assertEqual([(x['t0'],x['t1'],x['serve_s'],x['end_evidence_s']) for x in out],[(10.,30.,11.,29.)]);self.assertTrue(d[0]['accepted'])
    def test_unknown_bounces_cannot_authorize_join(self):
        self.assertEqual(self.run_rule([float('nan'),float('inf')])[0],self.cards)
    def test_old_body_veto_still_applies(self):
        self.args['p'][200:211]=.1
        self.assertEqual(self.run_rule([20.3,20.7])[0],self.cards)
    def test_partial_chain_keeps_all_three_source_cards(self):
        self.cards.append(dict(t0=31.,t1=35.,serve_s=32.,end_evidence_s=34.))
        self.args['events'] += [29.8,30.3,30.7,31.2]
        before=copy.deepcopy(self.cards);out,d=self.run_rule([20.3,20.7])
        self.assertEqual([(x['t0'],x['t1']) for x in out],[(10.,30.),(31.,35.)]);self.assertEqual(self.cards,before);self.assertEqual([x['accepted'] for x in d],[True,False])

if __name__=='__main__':unittest.main()

