import tempfile
import unittest
import subprocess
from pathlib import Path
from PIL import Image
from worker.lesson_video import write_lesson_poster

class LessonPosterTests(unittest.TestCase):
 def test_playable_asset_produces_visible_jpeg_preview(self):
  with tempfile.TemporaryDirectory() as directory:
   source=Path(directory)/'playback.mp4'
   subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=red:s=320x180:d=1','-c:v','libx264','-pix_fmt','yuv420p','-y',str(source)],check=True)
   poster=write_lesson_poster(source,directory)
   with Image.open(poster) as im:
    self.assertEqual(im.format,'JPEG');self.assertEqual(im.size,(320,180))
    red,green,blue=im.convert('RGB').getpixel((160,90))
    self.assertGreater(red,150);self.assertLess(green,50);self.assertLess(blue,50)
