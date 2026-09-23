"""Offline generator checks; PONGLENS_EXPERIMENT supplies the frozen feature module."""
import copy
import importlib.util
import os
from pathlib import Path
import unittest

SCRIPT = Path(__file__).with_name('generate-point-ending-suggestions.py')

class SuggestionsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if SCRIPT.exists():
            spec = importlib.util.spec_from_file_location('suggestions', SCRIPT)
            cls.s = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.s)
            cls.s.configure(Path(os.environ['PONGLENS_EXPERIMENT']))

    def test_generator_exists(self):
        self.assertTrue(SCRIPT.exists(), 'Offline suggestion generator must exist')

    def test_classifier_learns_geometry_and_does_not_call_rare_class(self):
        if not SCRIPT.exists(): self.skipTest('Generator not implemented')
        samples = [dict(x=[-4 + i*.02], y='table', slug=str(i%2), point_id=str(i)) for i in range(12)]
        samples += [dict(x=[4 + i*.02], y='floor', slug=str(i%2), point_id=str(i+12)) for i in range(12)]
        samples += [dict(x=[0], y='ceiling', slug='0', point_id='rare')]
        model = self.s.fit_classes(samples)
        self.assertEqual(self.s.classify([-4], model)[0], 'table')
        self.assertEqual(self.s.classify([4], model)[0], 'floor')
        self.assertNotIn('ceiling', model['models'])

    def test_classifier_abstains_without_two_supported_classes(self):
        if not SCRIPT.exists(): self.skipTest('Generator not implemented')
        samples = [dict(x=[i], y='table', slug=str(i%2), point_id=str(i)) for i in range(12)]
        self.assertIsNone(self.s.classify([0], self.s.fit_classes(samples))[0])

    def test_last_paddle_never_falls_back_to_bounce_or_bad_geometry(self):
        if not SCRIPT.exists(): self.skipTest('Generator not implemented')
        r = dict(corners={'A_near_1':[0,100], 'B_near_2':[100,100], 'C_far_2':[100,0], 'D_far_1':[0,0]}, contacts=[])
        self.assertIsNone(self.s.last_paddle(r))
        r['contacts'] = [dict(t=1, x=50, y=90, side='near'), dict(t=2, x=50, y=90, side='far')]
        self.assertEqual(self.s.last_paddle(r)['side'], 'near')
        r['contacts'].append(dict(t=3,x=500,y=0,side='far'))
        self.assertEqual(self.s.last_paddle(r)['side'], 'near')

    def test_alignment_preserves_stored_indices_and_rejects_mismatch(self):
        if not SCRIPT.exists(): self.skipTest('Generator not implemented')
        r=dict(features=dict(fps=30, candidates=[dict(kind='bounce',t=1,x=40,y=20),dict(kind='bounce',t=2,x=30,y=40)]))
        evidence=dict(width=100,height=100,bounces=[dict(t=2,x=.3,y=.4),dict(t=1,x=.4,y=.2)])
        self.assertEqual([x['t'] for x in self.s.align_bounces(r,evidence)], [2,1])
        evidence['bounces'][0]['t']=20
        with self.assertRaises(ValueError): self.s.align_bounces(r,evidence)

    def test_inference_projection_drops_every_non_machine_field(self):
        if not SCRIPT.exists(): self.skipTest('Generator not implemented')
        r=dict(point_id='p',slug='r',features=dict(start=0,end=2,width=100,height=100,fps=30,track=[],candidates=[]),contacts=[],corners={},serve_s=0)
        noisy=copy.deepcopy(r)
        noisy.update(truth_winner='near', window={'tap':1}, label={'reason':'net'}, note='secret', existing_net={'winner':'far'})
        noisy['features']['exact_tap']=1
        self.assertEqual(self.s.machine_row(r), self.s.machine_row(noisy))

    def test_training_excludes_entire_target_recording_and_unknown_labels(self):
        if not SCRIPT.exists(): self.skipTest('Generator not implemented')
        prepared=[dict(point_id='a',slug='held',events=[dict(id='detected:0',features=[1])],sequence=[1],rank=[[1]]),
                  dict(point_id='b',slug='train',events=[dict(id='detected:0',features=[2]),dict(id='detected:1',features=[3])],sequence=[2],rank=[[2],[3]])]
        labels={'a':dict(reason='net',bounceReview=dict(events=[dict(id='detected:0',kind='floor')],lastBounce='detected:0')),
                'b':dict(reason='long',bounceReview=dict(events=[dict(id='detected:0',kind='serve')],lastBounce='detected:1'))}
        before=copy.deepcopy(labels)
        training=self.s.training_samples(prepared,labels,'held')
        self.assertEqual([x['y'] for x in training['events']], ['table'])
        self.assertEqual([x['y'] for x in training['reasons']], ['long'])
        self.assertEqual([x['y'] for x in training['last']], [0,1])
        self.assertTrue(all(x['slug']=='train' for group in training.values() for x in group))
        labels['a']={}
        self.assertEqual(training,self.s.training_samples(prepared,labels,'held'))
        self.assertEqual(before['b'],labels['b'])

    def test_payload_rejects_unknown_event_reference(self):
        if not SCRIPT.exists(): self.skipTest('Generator not implemented')
        value=lambda v:dict(value=v,confidence='tentative' if v else 'uncertain',detail='Review needed.')
        payload=dict(version=1,runId=self.s.RUN_ID,reason=value('net'),lastRallyContact=value(None),lastBounce=value('detected:1'),events=[dict(id='detected:0',kind='table',side='near',confidence='tentative',detail='Review needed.')])
        with self.assertRaises(ValueError): self.s.validate_payload(payload,1)
        payload['lastBounce']=value('detected:0')
        self.s.validate_payload(payload,1)

if __name__=='__main__': unittest.main()
