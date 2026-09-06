import json
import tempfile
import unittest
from unittest.mock import patch
from worker.lesson_video import create_edit, normalize_edit, chunk_ranges, release_id


class EditRuntime:
 def __init__(self,merge): self.merge=merge;self.merge_content=None
 def stage(self,*args): pass
 def model(self,prompt,content):
  if 'Extract the teaching' in prompt:
   return {'title':'Lesson','themes':[{'name':'Footwork','points':['Recover after each shot.']}], 'chapters':[
    {'title':'First','cues':['Recover after each shot.'],'start_s':100,'end_s':140},
    {'title':'Second','cues':['Move back into position.'],'start_s':200,'end_s':250},
   ]}
  if 'Build the complete teaching outline' in prompt:
   return {'title':'Lesson','themes':[{'name':'Footwork','points':['Recover after each shot.']}]}
  self.merge_content=content
  return self.merge


def merge_edit(merge):
 runtime=EditRuntime(merge)
 with tempfile.TemporaryDirectory() as directory,patch('worker.lesson_video.frame',return_value='data:image/jpeg;base64,AA'),patch('worker.lesson_video.contextualize_edit',side_effect=lambda rt,row,edit,*args:edit):
  result=create_edit(runtime,{},'source',directory,[{'start_s':0,'end_s':600,'utterances':[]}],600)
 return result,runtime


class LessonVideoTests(unittest.TestCase):
 def test_ninety_minutes_has_complete_nonoverlapping_audio_coverage(self):
  ranges=chunk_ranges(5400)
  self.assertEqual(ranges[0],(0,600));self.assertEqual(ranges[-1],(4800,5400));self.assertEqual(sum(b-a for a,b in ranges),5400)
 def test_fractional_container_tail_is_merged(self):
  ranges=chunk_ranges(5400.033)
  self.assertEqual(len(ranges),9);self.assertEqual(ranges[-1],(4800,5400.033))
 def test_recap_timestamps_refer_to_source_and_output(self):
  raw={'title':'Backhand','chapters':[{'title':'Balance','cues':['Stay balanced.'],'start_s':5300,'end_s':5350},{'title':'Recover','cues':['Recover.'],'start_s':10,'end_s':40}],'themes':[]}
  edit=normalize_edit(raw,5400)
  self.assertEqual(edit['chapters'][1]['summary_start_s'],50)
  self.assertEqual(edit['chapters'][1]['start_s'],10)
 def test_invalid_and_invented_ranges_refused(self):
  for start,end in [(-1,20),(5400,5410),(20,19),(float('nan'),40)]:
   with self.assertRaises(ValueError): normalize_edit({'title':'Lesson','chapters':[{'title':'A','cues':['B'],'start_s':start,'end_s':end}]},5400)
 def test_limit_no_artificial_padding(self):
  e=normalize_edit({'title':'Lesson','chapters':[{'title':'A','cues':['B'],'start_s':0,'end_s':20}]},5400)
  self.assertEqual(e['chapters'][0]['summary_end_s'],20)
 def test_release_is_content_addressed(self):
  self.assertRegex(release_id(),r'^lesson-video-[0-9a-f]{16}$')
 def test_merge_candidate_id_maps_to_worker_owned_range_without_timestamps(self):
  result,runtime=merge_edit({'title':'Lesson','chapters':[{'candidate_id':'candidate-2','title':'Recover','cues':['Move back into position.']}], 'themes':[]})
  self.assertEqual((result['chapters'][0]['start_s'],result['chapters'][0]['end_s']),(200,250))
  self.assertNotIn('start_s',str(runtime.merge_content))
  self.assertNotIn('end_s',str(runtime.merge_content))
 def test_merge_receives_timestamp_free_candidate_teaching_metadata(self):
  _,runtime=merge_edit({'title':'Lesson','chapters':[{'candidate_id':'candidate-1','title':'Recover','cues':['Recover after each shot.']}], 'themes':[]})
  candidates=[json.loads(item['text']) for item in runtime.merge_content if item.get('type')=='text' and 'candidate_id' in item['text']]
  self.assertEqual(candidates[0],{'candidate_id':'candidate-1','section_title':'Lesson','title':'First','cues':['Recover after each shot.']})
  self.assertTrue(all(not any('time' in key or key.endswith('_s') for key in candidate) for candidate in candidates))
 def test_merge_refuses_model_authored_timestamps(self):
  with self.assertRaisesRegex(ValueError,'candidate ID'):
   merge_edit({'title':'Lesson','chapters':[{'candidate_id':'candidate-1','title':'First','cues':['Recover after each shot.'],'start_s':0,'end_s':40}], 'themes':[]})
 def test_merge_refuses_unknown_or_duplicate_candidate_ids(self):
  for chapter_ids in [['candidate-3'],['candidate-1','candidate-1']]:
   with self.subTest(chapter_ids=chapter_ids),self.assertRaisesRegex(ValueError,'candidate ID'):
    merge_edit({'title':'Lesson','chapters':[{'candidate_id':candidate_id,'title':'Topic','cues':['Recover after each shot.']} for candidate_id in chapter_ids], 'themes':[]})
if __name__=='__main__': unittest.main()
