"""Copied-point orchestration invariants; synthetic observations and fixed models."""
import copy
import importlib.util
import unittest


class CopiedPointTests(unittest.TestCase):
    def run_point(self, row=None, **kwargs):
        self.assertIsNotNone(importlib.util.find_spec('research_copied_point'),
                             'Copied-point orchestration has not been implemented')
        from research_copied_point import process_copied_point
        options=dict(proposal=self.proposal(2.), export_bounds={'start':.7,'end':4.4},
                     padding={'pre':.3,'post':.4}, allow_evaluation=True)
        options.update(kwargs)
        return process_copied_point(self.row() if row is None else row,self.artifact(),self.corpus(),**options)

    def row(self):
        return dict(features=dict(start=1.,end=4.,width=200,height=100,fps=30.,
                    track=[[1.,.5,.2,.9],[1.1,.5,.4,.9],[1.2,.5,.6,.9]],
                    candidates=[dict(kind='bounce',t=1.1,x=100.,y=60.,side=None,u=.7625,v=.6,visual_confidence=.9)]),
                    corners=dict(A_near_1=[20,80],B_near_2=[180,80],C_far_2=[140,20],D_far_1=[60,20]),serve_s=None)

    def artifact(self):
        def constant(n,q):
            return dict(preprocess=dict(medians=[0.]*n,means=[0.]*(2*n),scales=[1.]*(2*n)),constant=q)
        return dict(contract='copied-worker-winner-v1',purpose='held_recording_evaluation',pose='none',
                    provenance={'fixture':'synthetic'},contact_model=constant(21,.9),winner_model=constant(66,.9),
                    selection={'threshold':.8},outgoing=dict(model=constant(19,.1),selection={'threshold':.9}))

    def corpus(self):
        return dict(sequences=[],crossings=[],provenance='synthetic complete recording evidence')

    def proposal(self,start):
        return dict(start=start,pair=dict(first=3.,monotonicity=1.,between_machine_contacts=0))

    def test_two_export_proposals_leave_real_scoring_decision_identical(self):
        # Feeding either shortened window into scoring loses every observation.
        a=self.run_point(proposal=self.proposal(1.5));b=self.run_point(proposal=self.proposal(2.5))
        self.assertEqual(a['scoring_decision']['winner'],'near')
        self.assertEqual(a['scoring_decision'],b['scoring_decision'])
        self.assertEqual(a['scoring_window'],{'start':1.,'end':4.})
        self.assertAlmostEqual(a['export_window']['start'],1.2)
        self.assertAlmostEqual(b['export_window']['start'],2.2)

    def test_original_end_and_padding_are_preserved(self):
        r=self.run_point()
        self.assertEqual(r['export_window'],dict(start=1.7,end=4.4,structural_start=2.,structural_end=4.,pre=.3,post=.4))

    def test_missing_or_incoherent_pair_keeps_original_export_start(self):
        for p in [None,{'start':2.,'pair':None},{'start':2.,'pair':{'first':3.,'monotonicity':.1,'between_machine_contacts':0}}]:
            with self.subTest(proposal=p):
                r=self.run_point(proposal=p);self.assertEqual(r['export_window']['start'],.7)
                self.assertEqual(r['scoring_decision']['winner'],'near')

    def test_malformed_export_bounds_raise_instead_of_changing_score(self):
        for b in [None,{},[],{'start':float('nan'),'end':4.4},{'start':-.1,'end':4.4},
                  {'start':1.1,'end':4.4},{'start':.7,'end':3.9},{'start':4.4,'end':.7}]:
            with self.subTest(bounds=b),self.assertRaises(ValueError):self.run_point(export_bounds=b)

    def test_malformed_or_inconsistent_padding_raises(self):
        for pad in [None,{},[],{'pre':True,'post':.4},{'pre':-.1,'post':.4},
                    {'pre':float('inf'),'post':.4},{'pre':.1,'post':.4},{'pre':.3,'post':.1}]:
            with self.subTest(padding=pad),self.assertRaises(ValueError):self.run_point(padding=pad)

    def test_clipped_original_export_bounds_remain_clipped_on_fallback(self):
        r=self.run_point(proposal=None,padding={'pre':.8,'post':.9})
        self.assertEqual(r['export_window']['start'],.7);self.assertEqual(r['export_window']['end'],4.4)
        self.assertEqual(r['export_window']['pre'],.8);self.assertEqual(r['export_window']['post'],.9)

    def test_start_at_or_beyond_original_end_is_an_explicit_error(self):
        for start in [4.,5.]:
            with self.subTest(start=start),self.assertRaises(ValueError):self.run_point(proposal=self.proposal(start))

    def test_no_input_mutation_or_owner_metadata_passthrough(self):
        row=self.row();proposal=self.proposal(2.);bounds={'start':.7,'end':4.4};padding={'pre':.3,'post':.4}
        saved=copy.deepcopy((row,proposal,bounds,padding));expected=self.run_point(row,proposal=proposal,export_bounds=bounds,padding=padding)
        self.assertEqual((row,proposal,bounds,padding),saved)
        row.update(user_winner='POISON',label='POISON',contacts=[{'kind':'contact','t':3.9,'side':'far'}])
        row['features'].update(owner_start=3.9,winner='far');proposal.update(label='POISON',winner='far')
        proposal['pair']['user_winner']='POISON';bounds['label']='POISON';padding['owner_winner']='POISON'
        self.assertEqual(self.run_point(row,proposal=proposal,export_bounds=bounds,padding=padding),expected)

    def test_absent_complete_context_cannot_become_a_model_call(self):
        from research_copied_point import process_copied_point
        r=process_copied_point(self.row(),self.artifact(),None,proposal=self.proposal(2.),
                              export_bounds={'start':.7,'end':4.4},padding={'pre':.3,'post':.4},allow_evaluation=True)
        self.assertIsNone(r['scoring_decision']['winner'])
        self.assertEqual(r['scoring_decision']['abstention_reason'],'upstream_baseline_unavailable')
        self.assertEqual(r['export_window']['start'],1.7)


if __name__=='__main__':unittest.main()
