import unittest
from research_serve_start import correct_start

class CorrectionTests(unittest.TestCase):
    def decide(self, monotonicity=1., between=0, contacts=(9.8,10.8), serve=None, pair=True):
        return correct_start(5.,8., {"first":10.,"monotonicity":monotonicity,"between_machine_contacts":between} if pair else None,list(contacts),serve)
    def test_backtracking_pair_keeps_existing_start(self):
        # Removing motion check would trim an unresolved backtracking attempt.
        self.assertEqual(self.decide(monotonicity=.2)["start"],5.)
    def test_contact_between_bounces_is_not_a_serve_pair(self):
        self.assertEqual(self.decide(between=1)["start"],5.)
    def test_smooth_pair_long_after_final_contact_is_uncertain(self):
        self.assertEqual(self.decide(contacts=(6.,7.))["start"],5.)
    def test_coherent_pair_with_later_receiver_contact_keeps_cut(self):
        self.assertEqual(self.decide(contacts=(6.,10.8))["start"],8.)
    def test_nearby_machine_serve_prevents_stale_veto(self):
        self.assertEqual(self.decide(contacts=(6.,7.),serve=9.6)["start"],8.)
    def test_absent_contacts_are_not_evidence_of_staleness(self):
        self.assertEqual(self.decide(contacts=())["start"],8.)
    def test_exact_thresholds_do_not_trigger(self):
        self.assertEqual(self.decide(monotonicity=.85,contacts=(8.8,))["start"],8.)
    def test_no_pair_returns_existing_start(self):
        self.assertEqual(self.decide(pair=False)["start"],5.)
    def test_no_later_start_and_no_earlier_than_original(self):
        for mono in [0.,.85,1.]:
            r=correct_start(5.,3.,{"first":10.,"monotonicity":mono,"between_machine_contacts":0},[10.5])
            self.assertEqual(r["start"],5.)
    def test_offset_translation_preserves_decision(self):
        a=self.decide(contacts=(6.,7.));b=correct_start(105.,108.,{"first":110.,"monotonicity":1.,"between_machine_contacts":0},[106.,107.])
        self.assertEqual(b["start"]-100.,a["start"])

class InputValidationTests(unittest.TestCase):
    def call(self, **overrides):
        args=dict(existing_start=5.,proposed_start=8.,pair={"first":10.,"monotonicity":1.,"between_machine_contacts":0},contacts=[10.8],serve_s=None)
        args.update(overrides)
        return correct_start(**args)
    def assert_fallback(self, **overrides):
        try:r=self.call(**overrides)
        except Exception as e:self.fail(f"Malformed evidence must preserve start, raised {e!r}")
        self.assertEqual(r["start"],5.)
        self.assertEqual(r["reasons"],["invalid_evidence"])
    def test_invalid_original_cannot_be_used_as_fallback(self):
        for x in [None,True,"5",float("nan"),float("inf"),-1.]:
            with self.subTest(value=x),self.assertRaises(ValueError):self.call(existing_start=x)
    def test_nonfinite_or_malformed_proposal_preserves_start(self):
        for x in [None,True,"8",float("nan"),float("inf"),-1.]:
            with self.subTest(value=x):self.assert_fallback(proposed_start=x)
    def test_missing_or_malformed_pair_fields_preserve_start(self):
        for p in [{},[],{"first":10.,"monotonicity":1.}, {"first":float("nan"),"monotonicity":1.,"between_machine_contacts":0}, {"first":10.,"monotonicity":float("nan"),"between_machine_contacts":0}, {"first":10.,"monotonicity":1.,"between_machine_contacts":-1}, {"first":10.,"monotonicity":1.,"between_machine_contacts":.5}, {"first":10.,"monotonicity":1.,"between_machine_contacts":True}]:
            with self.subTest(pair=p):self.assert_fallback(pair=p)
    def test_missing_contacts_differ_from_known_empty_contacts(self):
        self.assert_fallback(contacts=None)
        self.assertEqual(self.call(contacts=[])["start"],8.)
    def test_bad_contact_or_anchor_does_not_enable_trim(self):
        for contacts in [[float("nan")],[float("inf")],["9"],[True],"10"]:
            with self.subTest(contacts=contacts):self.assert_fallback(contacts=contacts)
        for serve in [float("nan"),float("inf"),"9",True]:
            with self.subTest(serve=serve):self.assert_fallback(serve_s=serve)
    def test_metadata_is_ignored(self):
        p={"first":10.,"monotonicity":1.,"between_machine_contacts":0,"point_id":"poison","winner":"near","owner_serve_start":9999}
        self.assertEqual(self.call(pair=p),self.call())
    def test_input_does_not_mutate(self):
        p={"first":10.,"monotonicity":.1,"between_machine_contacts":0};cs=[8.,10.8]
        self.call(pair=p,contacts=cs)
        self.assertEqual(p,{"first":10.,"monotonicity":.1,"between_machine_contacts":0});self.assertEqual(cs,[8.,10.8])

if __name__=="__main__":unittest.main()
