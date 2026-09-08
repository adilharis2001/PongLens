import tempfile,unittest
from unittest.mock import patch
from worker.lesson_video import normalize_edit,create_edit
from worker.tests.lesson_fixtures import audible_transcript

def chapter(i,length=60):return {'title':f'Topic {i}','cues':['When the ball changes, adjust to the return.'],'start_s':i*100,'end_s':i*100+length}
class CoverageTests(unittest.TestCase):
 def test_twelve_chapters_keep_all_source_ranges_and_playback_timing(self):
  result=normalize_edit({'title':'Lesson','chapters':[chapter(i) for i in range(12)]},5400)
  self.assertEqual(len(result['chapters']),12)
  self.assertEqual(result['chapters'][-1]['summary_end_s'],720)
  self.assertEqual(result['chapters'][-1]['start_s'],1100)
 def test_limits_reject_instead_of_silently_dropping_teaching(self):
  for chapters in [[chapter(i,10) for i in range(17)],[chapter(i,100) for i in range(10)]]:
   with self.assertRaises(ValueError):normalize_edit({'title':'Lesson','chapters':chapters},5400)
 def test_complete_outline_precedes_clip_selection_and_third_candidate_survives(self):
  calls=[]
  class Runtime:
   def stage(self,*args):pass
   def model(self,prompt,content):
    calls.append(content)
    if len(calls)==1:return {'title':'Lesson','themes':[{'name':'All teaching','points':['First','Second','Third']}],'chapters':[chapter(i) for i in range(3)]}
    if len(calls)==2:return {'title':'Lesson','themes':[{'name':'Complete outline','points':['Third distinct correction']}]}
    return {'title':'Lesson','chapters':[{'candidate_id':'candidate-3','title':'Topic 2','cues':['When the ball changes, adjust to the return.']}],'themes':[]}
  transcript=audible_transcript(1)
  with tempfile.TemporaryDirectory() as directory,patch('worker.lesson_video.frame',return_value='data:image/jpeg;base64,AA'),patch('worker.lesson_video.contextualize_edit',side_effect=lambda rt,row,edit,*args:edit):
   result=create_edit(Runtime(),{},'source',directory,transcript,600)
  self.assertEqual(len(calls),3)
  self.assertIn('Third distinct correction',str(calls[2]))
  self.assertEqual(result['chapters'][0]['start_s'],200)
  self.assertEqual(result['themes'][0]['points'],['Third distinct correction'])

 def test_complete_outline_survives_old_truncation_limits(self):
  themes=[{'name':f'Topic {i}','points':['A'*500 for _ in range(17)]} for i in range(17)]
  result=normalize_edit({'title':'Lesson','chapters':[chapter(0)],'themes':themes},5400)
  self.assertEqual(result['themes'],themes)
