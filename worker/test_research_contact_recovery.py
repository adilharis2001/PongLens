import copy
import unittest
from research_contact_recovery import recover_contacts

CORNERS={"A_near_1":[200,800],"B_near_2":[800,800],"C_far_2":[800,200],"D_far_1":[200,200]}
def features(ys=(700,730,760,790,700,670,640,610), candidates=None):
    return dict(idx=1,start=0.,end=1.,fps=30.,width=1000,height=1000,track=[[i/30.,.5,y/1000.] for i,y in enumerate(ys)],candidates=candidates or [])
def contact(t,side="near",x=500,y=790):
    return dict(kind="contact",t=t,side=side,x=x,y=y,u=None,v=None,visual_confidence=.9)

class ContactRecoveryTests(unittest.TestCase):
    def test_split_reversal_recovers_contact_in_source_clock(self):
        # Raw contacts alone lose this visually split but extrapolatable stroke.
        rows=recover_contacts(features(),CORNERS)
        self.assertEqual(len(rows),1)
        for k,v in dict(kind="contact",t=.1,side="near",x=500.,y=790.,origin="split_boundary_hypothesis",boundary_gap_frames=1,original_jump_px=90.,original_jump_limit_px=55.).items():self.assertEqual(rows[0][k],v)
        self.assertAlmostEqual(rows[0]["extrapolation_error_px"],60.)
    def test_far_end_reversal_recovers_far_contact(self):
        rows=recover_contacts(features((300,270,240,210,300,330,360,390)),CORNERS)
        self.assertEqual([(c["t"],c["side"]) for c in rows],[(.1,"far")])
    def test_existing_contact_deduplicates_recovery(self):
        c=contact(.15);self.assertEqual(recover_contacts(features(candidates=[c]),CORNERS),[c])
    def test_contacts_sorted_but_implausible_contacts_not_filtered(self):
        a=contact(.8,x=5000,y=5000);b=contact(.5,"far")
        r=recover_contacts(features(ys=(),candidates=[a,{"kind":"bounce","t":.6},b]),CORNERS)
        self.assertEqual(r,[b,a])
    def test_unavailable_geometry_returns_no_contacts(self):
        self.assertEqual(recover_contacts(features(candidates=[contact(.8)]),{}),[])
    def test_long_occlusion_does_not_create_contact(self):
        f=features();f["track"][4:]=[[p[0]+.2,*p[1:]] for p in f["track"][4:]]
        self.assertEqual(recover_contacts(f,CORNERS),[])
    def test_too_short_legs_do_not_create_contact(self):
        self.assertEqual(recover_contacts(features((770,775,780,785,700,695,690,685)),CORNERS),[])
    def test_inputs_unmodified_and_owner_metadata_ignored(self):
        f=features();saved=copy.deepcopy(f);r=recover_contacts(f,CORNERS);self.assertEqual(f,saved)
        f.update(point_id="poison",winner="far",owner_serve=9999,labels={"contact":9999})
        self.assertEqual(recover_contacts(f,CORNERS),r)
    def test_empty_candidates_and_track_stay_empty(self):
        self.assertEqual(recover_contacts(features(ys=()),CORNERS),[])

if __name__=="__main__":unittest.main()
