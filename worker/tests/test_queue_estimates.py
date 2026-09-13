"""Hand-derived queue fixtures: no wall clock, media imports or network."""
import importlib.util
from pathlib import Path
import unittest

MODULE = Path(__file__).resolve().parents[1] / 'queue_estimates.py'
NOW = '2026-09-13T12:00:00+00:00'


def job(key, duration=100, fps=30, **fields):
    return dict(id=key, kind='deadspace_cut', status='queued',
                options={'points': True}, source_duration_s=duration,
                source_fps=fps, source_metadata_verified_at=NOW, **fields)


def message(row, number, vt=NOW, read_ct=0):
    return dict(job=row, msg_id=number, vt=vt, read_ct=read_ct)


def snapshot(messages, active=None, **fields):
    return dict(observed_at=NOW, points_pipeline='bodies', lanes=[dict(
        lane='main', availability='available', pulse={'beat_at': NOW, 'job_id': active['id'] if active else None,
        'stage': 'points' if active else 'idle'}, active=active,
        messages=messages, overflow=False, **fields)])


class QueueEstimateTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(MODULE.exists(), 'The queue estimator has not been implemented')
        spec = importlib.util.spec_from_file_location('queue_estimates', MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.estimate = module.estimate

    def test_six_heterogeneous_uploads_include_occupancy_and_fps(self):
        rows = [job(str(i), d, f) for i, (d, f) in enumerate([(100,30),(200,60),(50,30),(400,45),(150,30),(100,60)])]
        result = self.estimate(snapshot([message(j,i) for i,j in enumerate(rows)]))
        self.assertEqual(result['0']['ready_latest_at'], '2026-09-13T12:04:00+00:00')
        self.assertEqual(result['1']['ready_earliest_at'], '2026-09-13T12:04:41+00:00')
        self.assertEqual(result['1']['ready_latest_at'], '2026-09-13T12:20:15+00:00')
        self.assertEqual(result['5']['start_earliest_at'], '2026-09-13T12:15:27+00:00')
        self.assertEqual(result['5']['start_latest_at'], '2026-09-13T12:55:15+00:00')
        self.assertEqual(result['5']['basis'], 'recent_baseline_extrapolated')

    def test_visible_later_message_overtakes_delayed_earlier(self):
        result = self.estimate(snapshot([message(job('early'),1,'2026-09-13T12:01:00+00:00'),
                                         message(job('later'),2)]))
        self.assertEqual(result['later']['start_latest_at'], NOW)
        self.assertEqual(result['early']['start_earliest_at'], '2026-09-13T12:01:43+00:00')

    def test_visibility_order_ambiguity_is_explicit(self):
        result = self.estimate(snapshot([message(job('first'),1),
            message(job('delayed'),2,'2026-09-13T12:03:00+00:00'), message(job('later'),3)]))
        self.assertEqual(result['later']['reason'], 'queue_order_uncertain')
        self.assertIsNone(result['later']['ready_latest_at'])

    def test_ready_tail_occupies_slot_but_never_extends_own_ready(self):
        active = job('active',1000, events={'claimed': '2026-09-13T11:40:00+00:00',
            'ready': '2026-09-13T11:59:00+00:00'}, profile={'duration_s':1000,'fps':30,'route':'bodies:no-placement'})
        active['status']='done'
        result = self.estimate(snapshot([message(job('next'),2)],active))
        self.assertNotIn('active', result)
        self.assertEqual(result['next']['start_latest_at'], '2026-09-13T12:02:51.250000+00:00')

    def test_released_failed_retry_waits_for_visibility(self):
        active = job('retry', events={'claimed':'2026-09-13T11:45:00+00:00',
            'failed':'2026-09-13T11:46:00+00:00','released':'2026-09-13T11:46:01+00:00'})
        active['status']='failed'
        result=self.estimate(snapshot([message(active,1,'2026-09-13T12:15:00+00:00',1), message(job('next'),2)],active))
        self.assertEqual(result['next']['start_latest_at'],NOW)
        self.assertEqual(result['retry']['start_earliest_at'],'2026-09-13T12:15:00+00:00')

    def test_cancelled_and_exhausted_retry_add_no_burden(self):
        cancelled=job('cancel'); cancelled['status']='cancelled'
        failed=job('fail'); failed['status']='failed'
        result=self.estimate(snapshot([message(cancelled,1),message(failed,2,read_ct=2),message(job('next'),3)]))
        self.assertEqual(set(result),{'next'})
        self.assertEqual(result['next']['start_latest_at'],NOW)

    def test_unknown_own_duration_is_queue_only_unknown_ahead_blocks(self):
        result=self.estimate(snapshot([message(job('unknown',None),1),message(job('next'),2)]))
        self.assertEqual(result['unknown']['state'],'queue_only')
        self.assertEqual(result['unknown']['start_latest_at'],NOW)
        self.assertEqual(result['next']['reason'],'unsupported_work_ahead')

    def test_trim_and_effective_profile_are_not_applied_twice(self):
        row=job('trim',1000); row['options'].update(trim_start_s=100,trim_end_s=300)
        a=self.estimate(snapshot([message(row,1)]))['trim']
        self.assertEqual(a['ready_latest_at'],'2026-09-13T12:08:00+00:00')
        row['profile']={'duration_s':200,'fps':30,'route':'bodies:no-placement'}
        self.assertEqual(self.estimate(snapshot([message(row,1)]))['trim'],a)

    def test_unsupported_route_and_missing_fps_remain_unknown(self):
        for changes in ({'source_fps':None},{'source_fps':120},{'options':{'points':True,'placement':True}},
                        {'kind':'youtube_import','options':{'library':True}}):
            row=job('own'); row.update(changes)
            self.assertEqual(self.estimate(snapshot([message(row,1)]))['own']['state'],'queue_only')

    def test_overdue_is_anchored_to_claim_not_refreshed_now(self):
        row=job('active',events={'claimed':'2026-09-13T11:00:00+00:00'})
        row['status']='processing'
        result=self.estimate(snapshot([message(job('next'),2)],row))
        self.assertEqual(result['active']['state'],'overdue')
        self.assertIsNone(result['active']['ready_latest_at'])
        self.assertEqual(result['next']['reason'],'active_overdue')

    def test_availability_precedes_all_clocks_and_overflow(self):
        for state in ('unknown','unavailable','maintenance'):
            data=snapshot([message(job('own'),1)]); data['lanes'][0]['availability']=state
            result=self.estimate(data)['own']
            self.assertEqual(result['reason'],'service_'+state)
            self.assertIsNone(result['start_latest_at'])
        data=snapshot([message(job('own'),1)]); data['lanes'][0]['overflow']=True
        self.assertEqual(self.estimate(data)['own']['reason'],'queue_overflow')

    def test_stale_or_contradictory_active_evidence_cannot_offer_clock(self):
        row=job('active'); row['status']='processing'
        data=snapshot([message(job('next'),2)],row)
        self.assertEqual(self.estimate(data)['next']['reason'],'active_evidence_missing')
        data=snapshot([message(row,1)])
        self.assertEqual(self.estimate(data)['active']['reason'],'active_evidence_missing')
        data=snapshot([message(job('own'),1)]); data['lanes'][0]['pulse']['beat_at']='2026-09-13T11:00:00+00:00'
        self.assertEqual(self.estimate(data)['own']['reason'],'active_evidence_missing')

    def test_sparse_classes_and_independent_lanes(self):
        check=job('check'); check['kind']='content_check'
        data=snapshot([message(check,1),message(job('own'),2)])
        data['lanes'].append(dict(lane='fast',availability='available',pulse={'beat_at':NOW,'stage':'idle'},active=None,
                                 messages=[message(job('fast'),1)],overflow=False))
        result=self.estimate(data)
        self.assertEqual(result['own']['start_latest_at'],'2026-09-13T12:00:47.500000+00:00')
        self.assertEqual(result['fast']['state'],'queue_only')
        self.assertEqual(result['own']['expires_at'],'2026-09-13T12:01:30+00:00')

    def test_active_receipt_from_wrong_lane_cannot_support_capacity(self):
        row=job('active',events={'claimed':'2026-09-13T11:59:00+00:00'},receipt_lane='fast')
        row['status']='processing'
        result=self.estimate(snapshot([message(job('next'),2)],row))
        self.assertEqual(result['next']['reason'],'active_evidence_missing')

    def test_profile_from_new_release_keeps_labelled_baseline(self):
        row=job('own',None,None,profile={'duration_s':100,'fps':30,'route':'bodies:no-placement'},release_id='new-release')
        self.assertEqual(self.estimate(snapshot([message(row,1)]))['own']['basis'],'recent_baseline_20260913')

    def test_future_release_receipt_does_not_free_capacity(self):
        row=job('active',events={'claimed':'2026-09-13T11:59:00+00:00','released':'2026-09-13T12:01:00+00:00'})
        row['status']='done'
        self.assertEqual(self.estimate(snapshot([message(job('next'),2)],row))['next']['reason'],'active_evidence_missing')


if __name__=='__main__':
    unittest.main()
