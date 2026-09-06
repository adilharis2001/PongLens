import unittest
import numpy as np
import torch
from worker.active_ball_patches import candidate_multiscale_patch, candidate_patch, candidate_geometry, ActiveBallPatchNet, patch_training_rows, choose_candidate


class PatchTests(unittest.TestCase):
    def test_ambiguous_or_low_scoring_candidates_do_not_force_a_ball(self):
        candidates=[{'x':100.,'y':200.},{'x':400.,'y':300.}]
        self.assertEqual(choose_candidate(candidates,[.95,.91])['state'],'unsure')
        self.assertEqual(choose_candidate(candidates,[.4,.2])['state'],'hidden')
        self.assertEqual(choose_candidate([],[])['state'],'hidden')
        self.assertEqual(choose_candidate(candidates,[.95,.1])['x'],100.)
    def test_training_excludes_unreviewed_and_heldout_samples(self):
        reviewed={'state':'visible','provenance':'assistant_visual_v1'}
        rows=[{'id':'a','split':'train','weak_label':reviewed}, {'id':'b','split':'test','weak_label':reviewed}, {'id':'c','split':'train','weak_label':{'state':'visible','provenance':'local_motion_v0'}}]
        self.assertEqual(patch_training_rows(rows),[])
        self.assertEqual([r['id'] for r in patch_training_rows(rows,allow_assistant=True)],['a'])
    def test_native_center_pixel_is_not_lost_in_full_scene_resize(self):
        frames=[np.zeros((1080,1920,3),np.uint8) for _ in range(3)]
        frames[1][540,960]=255
        patch=candidate_patch(frames,960,540)
        self.assertEqual(tuple(patch.shape),(9,96,96))
        self.assertEqual(float(patch[3,48,48]),1.)
        self.assertEqual(float(patch[0,48,48]),0.)

    def test_edge_crop_is_padded_without_wrapping_opposite_edge(self):
        frames=[np.zeros((100,100,3),np.uint8) for _ in range(3)]
        for frame in frames:frame[:,-1]=255
        patch=candidate_patch(frames,0,50)
        self.assertEqual(float(patch.sum()),0.)

    def test_multiscale_patch_keeps_native_detail_and_wider_context(self):
        frames=[np.zeros((480,640,3),np.uint8) for _ in range(3)]
        frames[1][240,320]=255
        patch=candidate_multiscale_patch(frames,320,240)
        self.assertEqual(tuple(patch.shape),(18,96,96))
        self.assertEqual(float(patch[3,48,48]),1.)

    def test_geometry_scales_with_recording_resolution(self):
        corners=[[100,200],[300,200],[250,100],[150,100]]
        a=candidate_geometry(200,150,corners,1/30)
        b=candidate_geometry(400,300,[[x*2,y*2] for x,y in corners],1/30)
        self.assertTrue(torch.allclose(a,b))

    def test_patch_model_has_finite_gradients(self):
        model=ActiveBallPatchNet();output=model(torch.rand(2,9,96,96),torch.rand(2,4))
        self.assertEqual(tuple(output.shape),(2,));output.square().mean().backward()
        self.assertTrue(all(p.grad is not None and torch.isfinite(p.grad).all() for p in model.parameters()))

    def test_multiscale_model_accepts_eighteen_channels(self):
        model=ActiveBallPatchNet(channels=18)
        self.assertEqual(tuple(model(torch.rand(2,18,96,96),torch.rand(2,4)).shape),(2,))
