"""Unconfirmed internal serves must not interrupt a continuous body rally."""
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
from worker import body_points as bp


class AgreementIntegration(unittest.TestCase):
    def assemble(self, contacts, dead, version='v2'):
        T=np.arange(0.,40.,.1)
        raw={'near':[{} for _ in T], 'far':[{} for _ in T]}
        model=dict(version=version, sha='fixture',
                   cfg=dict(pad0=0.,pad1=.8,ball_floor=.6,gap_min=.6))
        evidence=SimpleNamespace(cross=[11.,15.,22.,28.],bt_table=[12.,23.],serves=[11.,20.])
        # Only the expensive body observation/decoder stages are replaced;
        # real refinement, overlap resolution and policy integration run.
        with patch.object(bp,'read_players',return_value=(T,raw,1.)), \
             patch.object(bp,'play_probability',return_value=(np.full(len(T),.9),None)), \
             patch.object(bp,'segments',return_value=[(10.,29.2)]):
            return bp.assemble({}, {}, evidence, 40., model=model,
                               v3_serves=contacts,v3_dead=dead)

    def test_unconfirmed_second_serve_does_not_split_long_rally(self):
        cards,info=self.assemble([11.],[])
        self.assertEqual([(c['t0'],c['t1']) for c in cards],[(10.,30.)])
        self.assertEqual(info['rally_policy']['status'],'used')

    def test_confirmed_second_serve_still_splits(self):
        self.assertEqual(len(self.assemble([11.,20.4],[])[0]),2)

    def test_missing_detector_is_not_successful_empty_detector(self):
        self.assertEqual(len(self.assemble(None,None)[0]),2)
        self.assertEqual(len(self.assemble([],[])[0]),1)

    def test_missing_dead_runs_preserves_previous_cards(self):
        self.assertEqual(len(self.assemble([11.],None)[0]),2)

    def test_old_model_retains_original_behavior(self):
        self.assertEqual(len(self.assemble([11.],[],version='v1')[0]),2)


if __name__ == '__main__':
    unittest.main()
