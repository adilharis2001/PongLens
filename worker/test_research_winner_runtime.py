"""Offline runtime contract tests; no private owner fixtures required."""
import copy
import importlib.util
import math
import unittest


class RuntimeContractTests(unittest.TestCase):
    def runtime(self):
        self.assertIsNotNone(importlib.util.find_spec("research_winner_runtime"),
                             "The standalone winner runtime has not been extracted")
        import research_winner_runtime
        return research_winner_runtime

    def row(self):
        return dict(features=dict(start=0., end=1., width=200, height=100, fps=30.,
                    track=[[0., .5, .2, .9], [.1, .5, .4, .9]], candidates=[]),
                    contacts=[], corners=dict(A_near_1=[20,80], B_near_2=[180,80],
                    C_far_2=[140,20], D_far_1=[60,20]), serve_s=None)

    def test_coordinate_contract_rejects_pixels_as_normalized_track(self):
        r=self.row(); r['features']['track'][0][1]=100
        with self.assertRaises(ValueError): self.runtime().normalize_input(r)

    def test_time_order_and_duplicate_times_are_refused(self):
        for times in [[.1,0.],[0.,0.]]:
            r=self.row()
            for p,t in zip(r['features']['track'],times): p[0]=t
            with self.assertRaises(ValueError): self.runtime().normalize_input(r)

    def test_metadata_is_not_allowed_into_features(self):
        r=self.row(); clean=self.runtime().normalize_input(r)
        r.update(truth='far',winner='far',owner_end_s=-999,score=[11,0])
        r['features'].update(server='far',truth='near',tap_s=-999)
        self.assertEqual(self.runtime().normalize_input(r),clean)

    def test_missing_evidence_is_an_explicit_abstention(self):
        r=self.row(); r['features']['track']=[]
        result=self.runtime().score_point(r,{},self.baseline())
        self.assertIsNone(result['winner']); self.assertEqual(result['abstention_reason'],'no_ball_observations')

    def baseline(self):
        return dict(existing_net=None,legacy=None,new_net_association=None,net_veto=False,
                    provenance='synthetic upstream machine rules')

    def test_branch_order_keeps_net_before_out_before_legal_before_association(self):
        choose=self.runtime().combine
        for expected,parts in [('existing_net',dict(existing_net='near',outgoing='far',legacy='far',new_net_association='far',hybrid='far')),
                               ('outgoing',dict(outgoing='near',legacy='far',new_net_association='far',hybrid='far')),
                               ('legacy',dict(legacy='near',new_net_association='far',hybrid='far')),
                               ('new_net_association',dict(new_net_association='near',hybrid='far')),
                               ('hybrid',dict(hybrid='near'))]:
            self.assertEqual(choose(**parts),('near',expected))
        self.assertEqual(choose(),(None,'abstain'))

    def test_model_missing_indicator_and_standardization_match_hand_calculation(self):
        model=dict(preprocess=dict(medians=[4.,6.],means=[1.,2.,.25,.5],scales=[2.,2.,.5,.5]),
                   coefficients=[.2,.3,.4,.5],intercept=-.1)
        # [2, missing] -> [2,6,0,1] -> [.5,2,-.5,1] -> logit .9
        self.assertAlmostEqual(self.runtime().predict_score([2.,None],model),1/(1+math.exp(-.9)),places=14)
        with self.assertRaises(ValueError): self.runtime().predict_score([2.],model)

    def test_missing_upstream_decisions_are_not_silently_assumed_negative(self):
        result=self.runtime().score_point(self.row(),{}, {})
        self.assertEqual(result['abstention_reason'],'upstream_baseline_unavailable')

    def test_eval_model_cannot_be_used_as_unseen_recording_artifact(self):
        with self.assertRaises(ValueError):
            self.runtime().validate_artifact(dict(purpose='held_recording_evaluation'),allow_evaluation=False)


class InferenceTests(unittest.TestCase):
    runtime = RuntimeContractTests.runtime
    row = RuntimeContractTests.row
    baseline = RuntimeContractTests.baseline

    def artifact(self, q=.9, threshold=.8):
        def constant(n,q):
            return dict(preprocess=dict(medians=[0.]*n,means=[0.]*(2*n),scales=[1.]*(2*n)),constant=q)
        return dict(contract='copied-worker-winner-v1',purpose='held_recording_evaluation',pose='none',
                    provenance={'fixture':'synthetic'},contact_model=constant(21,.9),
                    winner_model=constant(66,q),selection={'threshold':threshold},
                    outgoing=dict(model=constant(19,.1),selection={'threshold':.9}))

    def input_with_bounce(self):
        r=self.row();r['features']['candidates']=[dict(kind='bounce',t=.1,x=100.,y=60.,side=None,
                                                     u=.7625,v=.6,visual_confidence=.9)]
        return r

    def test_full_inference_ignores_poisoned_outcomes_and_preserves_coordinates(self):
        r=self.input_with_bounce();original=copy.deepcopy(r);rt=self.runtime()
        a=rt.score_point(r,self.artifact(),self.baseline(),allow_evaluation=True)
        self.assertEqual(r,original)
        self.assertEqual((a['winner'],a['branch']),('near','hybrid'))
        self.assertEqual(len(a['features']),66)
        r.update(truth='far',score=[0,11],winner='far',owner_end_s=0.)
        r['features'].update(confirmed_winner='far',tap_s=-99.)
        r['features']['candidates'][0].update(owner_label='floor',truth='far')
        b=rt.score_point(r,self.artifact(),self.baseline(),allow_evaluation=True)
        self.assertEqual(a,b)

    def test_frozen_threshold_produces_abstention_without_retuning(self):
        a=self.runtime().score_point(self.input_with_bounce(),self.artifact(q=.7),self.baseline(),allow_evaluation=True)
        self.assertIsNone(a['winner']);self.assertEqual(a['abstention_reason'],'below_frozen_thresholds')
        self.assertEqual(a['raw_score'],.7);self.assertEqual(a['threshold'],.8)

    def test_no_reference_does_not_invent_a_camera_side(self):
        a=self.runtime().score_point(self.row(),self.artifact(),self.baseline(),allow_evaluation=True)
        self.assertIsNone(a['winner']);self.assertEqual(a['abstention_reason'],'no_reference')

    def test_baseline_wins_even_when_hybrid_disagrees(self):
        b=self.baseline();b['existing_net']='far'
        a=self.runtime().score_point(self.input_with_bounce(),self.artifact(),b,allow_evaluation=True)
        self.assertEqual((a['winner'],a['branch']),('far','existing_net'))
        self.assertEqual(a['hybrid_winner'],'near')

    def test_reversed_event_order_is_invalid_instead_of_silently_reordered(self):
        r=self.input_with_bounce();r['features']['candidates'].append(dict(r['features']['candidates'][0],t=0.))
        a=self.runtime().score_point(r,self.artifact(),self.baseline(),allow_evaluation=True)
        self.assertEqual(a['abstention_reason'],'invalid_machine_input')

    def test_mixed_track_confidence_presence_does_not_break_history(self):
        r=self.input_with_bounce()
        expected=self.runtime().score_point(r,self.artifact(),self.baseline(),allow_evaluation=True)
        r['features']['track'][0]=r['features']['track'][0][:3]
        actual=self.runtime().score_point(r,self.artifact(),self.baseline(),allow_evaluation=True)
        self.assertEqual(actual,expected)

    def test_nonmapping_baseline_abstains(self):
        for value in (None,[],['existing_net','legacy','new_net_association','net_veto','provenance'],42):
            with self.subTest(value=value):
                result=self.runtime().score_point(self.row(),self.artifact(),value,allow_evaluation=True)
                self.assertIsNone(result['winner'])
                self.assertEqual(result['abstention_reason'],'upstream_baseline_unavailable')

    def test_malformed_machine_containers_abstain(self):
        cases=[]
        for key,value in [('candidates',[None]),('candidates',None),('candidates',{}),('track',[None]),('track',None),('track',{})]:
            r=self.row();r['features'][key]=value;cases.append(r)
        for key,value in [('features',None),('features',[]),('contacts',[None]),('contacts',None),('contacts',{}),('corners',None)]:
            r=self.row();r[key]=value;cases.append(r)
        cases.extend([None,[],42])
        for value in cases:
            with self.subTest(value=value):
                result=self.runtime().score_point(value,self.artifact(),self.baseline(),allow_evaluation=True)
                self.assertIsNone(result['winner'])
                self.assertEqual(result['abstention_reason'],'invalid_machine_input')


    def test_bounce_in_contact_slot_cannot_become_a_stroke(self):
        r=self.input_with_bounce()
        good=self.runtime().score_point(r,self.artifact(),self.baseline(),allow_evaluation=True)
        self.assertEqual(good['winner'],'near')
        r['contacts']=[dict(kind='bounce',t=.1,x=100.,y=20.,side='far',u=.7625,v=2.2,visual_confidence=.9)]
        result=self.runtime().score_point(r,self.artifact(),self.baseline(),allow_evaluation=True)
        self.assertIsNone(result['winner'])
        self.assertEqual(result['abstention_reason'],'invalid_machine_input')


if __name__=='__main__': unittest.main()
