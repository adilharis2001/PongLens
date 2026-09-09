"""The video file with the words burnt in, built when somebody asks for it.

The recap the apps show is the clean video plus text drawn by the app, so
the burnt-in copy is only ever used for a download. These tests pin the two
halves of that split: normal processing stops making it, and the on-demand
build cuts it from the clean recap rather than from the original.
"""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from worker.lesson_video import normalize_edit, render, render_share_file, process_share_render

EDIT = normalize_edit({'title': 'Lesson', 'chapters': [
    {'title': 'One', 'cues': ['Keep this supported instruction.'], 'start_s': 30, 'end_s': 60},
    {'title': 'Two', 'cues': ['Keep this one as well.'], 'start_s': 120, 'end_s': 165},
]}, 600)


def commands(calls):
    return [' '.join(str(x) for x in c.args[0]) for c in calls]


class RenderPanelsTests(unittest.TestCase):
    def run_render(self, panels):
        with tempfile.TemporaryDirectory() as directory, \
             patch('worker.lesson_video.run') as run_, \
             patch('worker.lesson_video.draw_panel') as panel, \
             patch('worker.lesson_video.lesson_color_filter', return_value=''), \
             patch('worker.lesson_video.probe', return_value={'format': {'duration': '75.0'}, 'streams': []}):
            result = render(Path(directory) / 'source.mov', EDIT, directory, panels=panels)
            return result, commands(run_.mock_calls), panel.call_count

    def test_normal_processing_draws_no_panels_and_returns_the_clean_file(self):
        result, cmds, panels = self.run_render(False)
        self.assertEqual(result.name, 'playback.mp4')
        self.assertEqual(panels, 0)
        self.assertFalse([c for c in cmds if 'overlay=' in c])
        # One encode per chapter plus one concat, where it used to be two each.
        self.assertEqual(len(cmds), 3)

    def test_the_parity_check_can_still_ask_for_both(self):
        result, cmds, panels = self.run_render(True)
        self.assertEqual(result.name, 'recap.mp4')
        self.assertEqual(panels, 2)
        self.assertEqual(len([c for c in cmds if 'overlay=' in c]), 2)
        self.assertEqual(len(cmds), 6)


class ShareFileTests(unittest.TestCase):
    def build(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch('worker.lesson_video.run') as run_, \
             patch('worker.lesson_video.draw_panel') as panel, \
             patch('worker.lesson_video.probe', return_value={'format': {'duration': '75.0'}}):
            output = render_share_file(Path(directory) / 'playback.mp4', EDIT, directory)
            return output, commands(run_.mock_calls), panel.call_count

    def test_it_cuts_the_clean_recap_at_the_summary_clock_not_the_source_clock(self):
        _, cmds, _ = self.build()
        cuts = [c for c in cmds if 'overlay=' in c]
        # Chapter one starts the recap; chapter two follows it at 30s, which
        # is where it sits in the clean file, not 120s where it sits in the
        # original.
        self.assertIn('-ss 0.0 -t 30.0', cuts[0])
        self.assertIn('-ss 30.0 -t 45.0', cuts[1])
        self.assertTrue(all('playback.mp4' in c for c in cuts))

    def test_it_burns_a_panel_for_every_chapter(self):
        output, cmds, panels = self.build()
        self.assertEqual(panels, len(EDIT['chapters']))
        self.assertEqual(output.name, 'shared.mp4')

    def test_it_does_not_tone_map_an_already_converted_file_a_second_time(self):
        _, cmds, _ = self.build()
        self.assertFalse([c for c in cmds if 'tonemap' in c or 'zscale=t=linear' in c])


class ProcessShareRenderTests(unittest.TestCase):
    def claim(self, **over):
        return {'lesson_video_id': '11111111-1111-1111-1111-111111111111',
                'owner_id': '22222222-2222-2222-2222-222222222222',
                'revision': 4, 'lease_token': '33333333-3333-3333-3333-333333333333',
                'previous_key': None, 'playback_key': 'lesson-video/o/v/playback-v3-x.mp4',
                'duration_s': 600, 'edit': EDIT, **over}

    def runtime(self):
        outer = self

        class S3:
            def __init__(self): self.uploaded = []; self.deleted = []
            def download_file(self, bucket, key, path): Path(path).write_bytes(b'x')
            def upload_file(self, path, bucket, key, ExtraArgs=None): self.uploaded.append(key)
            def head_object(self, Bucket, Key): return {'ContentLength': 900}
            def delete_object(self, Bucket, Key): self.deleted.append(Key)

        class Runtime:
            def __init__(self): self.s3 = S3(); self.patches = []; self.ledger = []
            def worker_heartbeat(self): pass
            def rest(self, path, method='GET', data=None):
                if path.startswith('storage_ledger'):
                    self.ledger.extend(data); return data
                self.patches.append((path, data)); return [{'ok': True}]
        return Runtime()

    def build(self, rt, claim, output_bytes=4096, fail=None):
        def fake_share(playback, edit, directory, on_progress=lambda x: None):
            if fail: raise fail
            on_progress('Adding text to chapter 1 of 2')
            path = Path(directory) / 'shared.mp4'; path.write_bytes(b'0' * output_bytes); return path
        with patch('worker.lesson_video.render_share_file', side_effect=fake_share):
            process_share_render(rt, claim)

    def test_it_records_the_revision_the_claim_captured(self):
        rt = self.runtime(); self.build(rt, self.claim())
        done = [d for _, d in rt.patches if d.get('status') == 'ready']
        self.assertEqual(len(done), 1)
        self.assertIn('shared-v4-', done[0]['r2_key'])
        self.assertEqual(done[0]['bytes'], 4096)

    def test_every_write_is_fenced_on_the_render_lease_not_the_lesson(self):
        rt = self.runtime(); self.build(rt, self.claim())
        targets = {p.split('?')[0] for p, _ in rt.patches}
        self.assertEqual(targets, {'lesson_share_renders'})
        self.assertTrue(all('lease_token=eq.33333333' in p for p, _ in rt.patches))

    def test_the_superseded_file_is_deleted_and_taken_off_the_storage_count(self):
        rt = self.runtime(); self.build(rt, self.claim(previous_key='lesson-video/o/v/shared-v3-y.mp4'))
        self.assertEqual(rt.s3.deleted, ['lesson-video/o/v/shared-v3-y.mp4'])
        self.assertEqual([row['bytes'] for row in rt.ledger], [4096, -900])

    def test_the_row_points_at_the_new_file_before_the_old_one_goes(self):
        rt = self.runtime(); self.build(rt, self.claim(previous_key='lesson-video/o/v/shared-v3-y.mp4'))
        ready = next(i for i, (_, d) in enumerate(rt.patches) if d.get('status') == 'ready')
        self.assertEqual(rt.s3.deleted, ['lesson-video/o/v/shared-v3-y.mp4'])
        self.assertLess(ready, len(rt.patches))

    def test_a_failure_keeps_the_recap_and_says_so_plainly(self):
        rt = self.runtime(); self.build(rt, self.claim(), fail=RuntimeError('ffmpeg died'))
        failed = [d for _, d in rt.patches if d.get('status') == 'failed']
        self.assertEqual(len(failed), 1)
        self.assertIn('Your recap is unchanged', failed[0]['error'])
        self.assertNotIn('ffmpeg', failed[0]['error'])
        self.assertEqual(rt.s3.uploaded, [])

    def test_a_reason_worth_reading_is_passed_through(self):
        rt = self.runtime()
        self.build(rt, self.claim(), fail=ValueError('The recap chapters do not line up with its video.'))
        failed = [d for _, d in rt.patches if d.get('status') == 'failed']
        self.assertIn('do not line up', failed[0]['error'])


if __name__ == '__main__':
    unittest.main()
