"""Card seeks must follow encoded frames, not requested segment durations."""
import copy
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from worker import points_pipeline as pp


def packets(path, first=False):
    cmd = ['ffprobe', '-v', 'error', '-select_streams', 'v:0']
    if first:
        cmd += ['-read_intervals', '%+#4']
    cmd += ['-show_packets', '-show_data_hash', 'sha256', '-show_entries',
            'packet=pts_time,data_hash', '-of', 'json', str(path)]
    return json.loads(subprocess.check_output(cmd))['packets']


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'needs ffmpeg')
class EncodedTimelineTests(unittest.TestCase):
    def check_video(self, rate, audio, variable=False):
        with tempfile.TemporaryDirectory(prefix='ponglens-clock-test-') as tmp:
            root = Path(tmp)
            source, output, match = root/'source.mp4', root/'cut.mp4', root/'match.json'
            cmd = ['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                   f'testsrc2=size=160x90:rate={rate}:duration=25']
            if audio:
                cmd += ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=25']
            if variable:
                cmd += ['-vf', "select='not(mod(n,2))+not(mod(n,5))'", '-fps_mode', 'vfr']
            cmd += ['-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', str(source)]
            subprocess.run(cmd, check=True, capture_output=True)
            spans = [[round(i*1.1+.01, 2), round(i*1.1+.32, 2)] for i in range(20)]
            points = [dict(idx=i+1, t0=a+.09, t1=a+.23, clip_t0=a+.08,
                           clip_t1=a+.28, cut_t0=round(i*.31+.08, 2),
                           rally_end_s=a+.20, rally_end_cut_s=round(i*.31+.20, 2))
                      for i,(a,b) in enumerate(spans)]
            original = dict(cut_mode='plays', cut_segments=spans, points=points)
            match.write_text(json.dumps(original))
            pp.cmd_cut(SimpleNamespace(video=str(source), out=str(output),
                                       segments=str(match), blurball=None, strictness='normal'))
            actual = json.loads(match.read_text())
            hashes = {p['data_hash']: float(p['pts_time']) for p in packets(output)}
            errors=[]
            for i,p in enumerate(actual['points']):
                # Three non-IDR payloads survive stream-copy exactly.
                samples=packets(Path(str(output)+'.parts')/f'part_{i:03d}.mp4', True)[1:4]
                self.assertEqual(len(samples),3)
                for sample in samples:
                    measured=hashes[sample['data_hash']]-float(sample['pts_time'])
                    errors.append(abs(p['cut_t0']-(measured+.08)))
                    # Concat rescales each part into the video's timebase;
                    # decimal ffprobe durations can differ by a few ticks.
                    # Require sub-millisecond error, far below one frame.
                    self.assertAlmostEqual(p['rally_end_cut_s'], measured+.20, delta=.001)
                for key in ('t0','t1','clip_t0','clip_t1','rally_end_s'):
                    self.assertEqual(p[key], points[i][key])
            self.assertLess(max(errors), .001, errors)
            self.assertEqual(actual['cut_segments'], spans)
            self.assertEqual(len(actual['cut_segment_offsets']), 20)
            self.assertTrue(Path(str(output)+'.timeline.json').is_file())

    def test_30fps_audio_does_not_accumulate_card_pause_error(self):
        self.check_video(30, True)

    def test_60fps_without_audio_keeps_encoded_card_clock(self):
        self.check_video(60, False)

    def test_variable_frame_timestamps_keep_encoded_card_clock(self):
        self.check_video(30, True, variable=True)


if __name__ == '__main__':
    unittest.main()
