import json
import tempfile
import unittest
from worker.lesson_video import contextualize_edit, normalize_edit, repeated, tighten_edit

NET_A='When a net ball produces an unusual rebound, wait and adjust to the unexpected ball.'
NET_B='When the ball produces an unusual rebound after contacting the net, wait and adjust to the unexpected trajectory.'
BOUNCE_A="When a ball's position or bounce is difficult to read, wait for the bounce and then react quickly instead of committing too early."
BOUNCE_B='When a ball is difficult to reach or read, wait for its bounce and react quickly instead of committing too early.'
UNDER='When you receive underspin and use this return, expect the ball to come back with a little topspin.'
TOP='When you receive topspin and play a drop, you do not need to add underspin.'

class RepeatedTests(unittest.TestCase):
 def test_the_repeats_a_reader_noticed_count_as_repeats(self):
  from worker.lesson_video import _words
  self.assertTrue(repeated(NET_B,[_words(NET_A)]))
  self.assertTrue(repeated(BOUNCE_B,[_words(BOUNCE_A)]))
  self.assertTrue(repeated('  when a NET ball produces an unusual rebound, wait and adjust to the unexpected ball. ',[_words(NET_A)]))
 def test_two_different_instructions_with_the_same_opening_are_kept(self):
  from worker.lesson_video import _words
  self.assertFalse(repeated(TOP,[_words(UNDER)]))
  self.assertFalse(repeated('When the goal is to prevent an immediate attack, make the serve shorter and lighter, with the first bounce closer to the net.',[_words('When a short serve is used, it can force the receiver to step back to reach the ball.')]))
 def test_empty_text_is_never_a_repeat(self):
  self.assertFalse(repeated('',[[]]))

class TightenTests(unittest.TestCase):
 def edit(self):
  return normalize_edit({'title':'Lesson','chapters':[
   {'title':'One','cues':[NET_A,UNDER],'start_s':0,'end_s':30},
   {'title':'Two','cues':[NET_B,TOP],'start_s':40,'end_s':70},
   {'title':'Three','cues':[NET_A],'start_s':80,'end_s':110}],
   'themes':[{'name':'Timing','points':[BOUNCE_A,UNDER]},{'name':'Positioning','points':[BOUNCE_B,TOP]},{'name':'Echo','points':[NET_A,NET_B]}]},600)
 def test_a_point_is_kept_under_the_first_heading_only(self):
  out=tighten_edit(self.edit())
  self.assertEqual([t['points'] for t in out['themes']][:2],[[BOUNCE_A,UNDER],[TOP]])
 def test_a_heading_left_with_no_points_goes(self):
  out=tighten_edit({'title':'Lesson','chapters':[],'themes':[{'name':'A','points':[NET_A]},{'name':'B','points':[NET_B]}]})
  self.assertEqual([t['name'] for t in out['themes']],['A'])
 def test_a_cue_said_in_an_earlier_chapter_is_dropped(self):
  out=tighten_edit(self.edit())
  self.assertEqual(out['chapters'][0]['cues'],[NET_A,UNDER])
  self.assertEqual(out['chapters'][1]['cues'],[TOP])
 def test_a_chapter_never_loses_its_last_cue(self):
  out=tighten_edit(self.edit())
  self.assertEqual(out['chapters'][2]['cues'],[NET_A])
 def test_nothing_else_is_touched(self):
  edit=self.edit();out=tighten_edit(edit)
  self.assertEqual(out['title'],edit['title'])
  self.assertEqual([(c['start_s'],c['end_s'],c['title']) for c in out['chapters']],[(c['start_s'],c['end_s'],c['title']) for c in edit['chapters']])
 def test_an_edit_with_no_repeats_is_returned_unchanged(self):
  edit=normalize_edit({'title':'Lesson','chapters':[{'title':'One','cues':[UNDER,TOP],'start_s':0,'end_s':30}],'themes':[{'name':'A','points':[NET_A,BOUNCE_A]}]},600)
  self.assertEqual(tighten_edit(edit),edit)

class EarlierCuesTests(unittest.TestCase):
 def test_each_chapter_is_shown_what_earlier_chapters_already_said(self):
  calls=[]
  class Runtime:
   def stage(self,*args):pass
   def model(self,prompt,content):
    calls.append(json.loads(content))
    return {'title':'Chapter','cues':[f'Reminder {len(calls)} for this clip, said once.']}
  edit=normalize_edit({'title':'Lesson','chapters':[{'title':'A','cues':['x'],'start_s':0,'end_s':30},{'title':'B','cues':['y'],'start_s':40,'end_s':70}]},600)
  with tempfile.TemporaryDirectory() as directory:
   contextualize_edit(Runtime(),{},edit,[],600,directory)
  self.assertEqual(calls[0]['earlier_chapter_cues'],[])
  self.assertEqual(calls[1]['earlier_chapter_cues'],['Reminder 1 for this clip, said once.'])

if __name__=='__main__':unittest.main()
