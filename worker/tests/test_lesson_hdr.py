import unittest
from worker.lesson_video import lesson_color_filter
class LessonHDRTests(unittest.TestCase):
 def test_hlg_and_pq_linearize_before_tonemap_then_bt709(self):
  for transfer in ['arib-std-b67','smpte2084']:
   f=lesson_color_filter({'streams':[{'codec_type':'video','color_transfer':transfer,'color_primaries':'bt2020','color_space':'bt2020nc'}]})
   self.assertIn('transfer=linear',f);self.assertLess(f.index('transfer=linear'),f.index('tonemap='))
   self.assertIn('format=gbrpf32le',f);self.assertIn('transfer=bt709',f);self.assertIn('matrix=bt709',f);self.assertIn('format=yuv420p',f)
 def test_sdr_does_not_get_tone_mapped(self):
  for transfer in ['bt709',None]:
   self.assertEqual(lesson_color_filter({'streams':[{'codec_type':'video','color_transfer':transfer}]}),'')

# Opt-in integration: LESSON_HDR_FIXTURE=/path/to/original.MOV. Uses the original
# read-only; renders two separated excerpts to exercise chapter concatenation.
import os
import tempfile
from pathlib import Path
from worker.lesson_video import frame, normalize_edit, probe, render, run

@unittest.skipUnless(os.environ.get('LESSON_HDR_FIXTURE'), 'Set LESSON_HDR_FIXTURE for real HDR decoding')
class LessonHDRFixtureTests(unittest.TestCase):
 def test_real_source_frame_both_outputs_audio_and_decode(self):
  source=Path(os.environ['LESSON_HDR_FIXTURE'])
  before=source.stat()
  info=probe(source)
  self.assertTrue(lesson_color_filter(info), 'Fixture must be tagged HDR')
  duration=float(info['format']['duration'])
  starts=[min(120,duration/4),min(600,duration/2)]
  edit=normalize_edit({'title':'HDR fixture','chapters':[
   {'title':'Original coaching','cues':['Listen to the original explanation.'],'start_s':start,'end_s':start+2}
   for start in starts]},duration)
  with tempfile.TemporaryDirectory(prefix='lesson-hdr-test-') as directory:
   self.assertTrue(frame(source,starts[0],directory,0).startswith('data:image/jpeg;base64,'))
   render(source,edit,directory)
   for name in ['recap.mp4','playback.mp4']:
    output=Path(directory)/name
    result=probe(output)
    video=next(s for s in result['streams'] if s['codec_type']=='video')
    self.assertEqual(video['codec_name'],'h264')
    self.assertEqual(video['pix_fmt'],'yuv420p')
    for field in ['color_space','color_transfer','color_primaries']:
     self.assertEqual(video[field],'bt709')
    self.assertTrue(any(s['codec_type']=='audio' for s in result['streams']))
    self.assertAlmostEqual(float(result['format']['duration']),4,delta=.2)
    run(['ffmpeg','-v','error','-xerror','-i',str(output),'-f','null','-'])
  after=source.stat()
  self.assertEqual((before.st_size,before.st_mtime_ns),(after.st_size,after.st_mtime_ns))

if __name__=='__main__':unittest.main()
