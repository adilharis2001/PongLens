import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from worker.lesson_video import contextualize_edit, normalize_edit

class LessonContextTests(unittest.TestCase):
 def fixture(self):
  return normalize_edit({'title':'Lesson','chapters':[{'title':'Adapt the baseline','cues':['Adjust it.'],'start_s':200,'end_s':250}]},600)
 def test_rewrite_gets_surrounding_speech_and_cannot_change_footage(self):
  calls=[]
  class Runtime:
   def stage(self,*args):pass
   def model(self,prompt,content):
    calls.append(json.loads(content))
    return {'title':'Adjust to a heavier push','cues':['When an opponent pushes with more backspin than expected, adjust your shot to that ball.'],'start_s':0,'end_s':600}
  transcript=[{'utterances':[{'start_s':10,'end_s':20,'text':'Unrelated earlier conversation'},{'start_s':180,'end_s':199,'text':'Baseline means the push you expected.'},{'start_s':200,'end_s':250,'text':'This opponent gives you more backspin.'},{'start_s':251,'end_s':270,'text':'Make a small adjustment.'}]}]
  with tempfile.TemporaryDirectory() as directory:
   result=contextualize_edit(Runtime(),{},self.fixture(),transcript,600,directory)
  self.assertEqual(result['chapters'][0]['start_s'],200)
  self.assertEqual(result['chapters'][0]['end_s'],250)
  self.assertEqual(result['chapters'][0]['summary_start_s'],0)
  self.assertEqual(calls[0]['selected_speech'][0]['text'],'This opponent gives you more backspin.')
  self.assertEqual(calls[0]['preceding_speech'][0]['text'],'Baseline means the push you expected.')
  self.assertIn('Baseline means',str(calls[0]))
  self.assertIn('small adjustment',str(calls[0]))
  self.assertNotIn('Unrelated earlier',str(calls[0]))
 def test_overflow_gets_one_rewrite_before_failing(self):
  class Runtime:
   calls=0
   def stage(self,*args):pass
   def model(self,*args):
    self.calls+=1
    return {'title':'Backspin','cues':['When facing backspin, adjust to the spin you receive.']}
  rt=Runtime()
  with tempfile.TemporaryDirectory() as directory, patch('worker.lesson_video.draw_panel',side_effect=[ValueError('overflow'),None]):
   contextualize_edit(rt,{},self.fixture(),[],600,directory)
  self.assertEqual(rt.calls,2)

 def test_overlong_condition_is_rewritten_not_silently_truncated(self):
  class Runtime:
   calls=0
   def stage(self,*args):pass
   def model(self,*args):
    self.calls+=1
    return {'title':'Forehand openings','cues':['Try your shot. '*20+'Except in tight high-pressure points.' if self.calls==1 else 'Try suitable forehand openings early, except in tight high-pressure points.']}
  rt=Runtime()
  with tempfile.TemporaryDirectory() as directory:
   result=contextualize_edit(rt,{},self.fixture(),[],600,directory)
  self.assertEqual(rt.calls,2)
  self.assertIn('except in tight',result['chapters'][0]['cues'][0])
