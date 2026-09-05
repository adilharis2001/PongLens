import unittest
import torch
from worker.train_active_ball import select_training, loss_for
from worker.active_ball_model import ball_target


class TrainingTests(unittest.TestCase):
    def test_weak_bootstrap_never_uses_validation_or_test_frames(self):
        rows=[{'id':s,'split':s,'label':None,'weak_label':{'state':'visible','x':5,'y':5,'provenance':'local_motion_v0'}} for s in ['train','validation','test']]
        self.assertEqual([r['id'] for r in select_training(rows,weak=True)],['train'])
        self.assertEqual(select_training(rows,weak=False),[])

    def test_human_label_overrides_weak_guess(self):
        r={'split':'train','label':{'state':'hidden','provenance':'human'},'weak_label':{'state':'visible','provenance':'local_motion_v0'}}
        self.assertEqual(select_training([r],weak=True)[0]['label']['state'],'hidden')

    def test_missing_visible_ball_costs_more_than_dim_empty_background(self):
        target=ball_target({'state':'visible','x':960,'y':540},1920,1080,320,192)[None,None]
        missed=loss_for(torch.full_like(target,-10),torch.tensor([10.]),target,torch.ones(1))
        empty=loss_for(torch.full_like(target,-2.2),torch.tensor([-10.]),torch.zeros_like(target),torch.zeros(1))
        self.assertGreater(float(missed),float(empty)*10)
