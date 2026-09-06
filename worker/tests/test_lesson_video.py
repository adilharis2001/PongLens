import json
import tempfile
import unittest
from unittest.mock import patch
from worker.lesson_video import create_edit, normalize_edit, chunk_ranges, release_id


class EditRuntime:
 def __init__(self,merge,chapters=None): self.merge=merge;self.merge_content=None;self.merge_contents=[];self.merge_prompts=[];self.merge_calls=0;self.chapters=chapters
 def stage(self,*args): pass
 def model(self,prompt,content):
  if 'Extract the teaching' in prompt:
   return {'title':'Lesson','themes':[{'name':'Footwork','points':['Recover after each shot.']}], 'chapters':self.chapters or [
    {'title':'First','cues':['Recover after each shot.'],'start_s':100,'end_s':140},
    {'title':'Second','cues':['Move back into position.'],'start_s':200,'end_s':250},
   ]}
  if 'Build the complete teaching outline' in prompt:
   return {'title':'Lesson','themes':[{'name':'Footwork','points':['Recover after each shot.']}]}
  self.merge_content=content
  self.merge_contents.append(content)
  self.merge_prompts.append(prompt)
  self.merge_calls+=1
  return self.merge[min(self.merge_calls-1,len(self.merge)-1)] if isinstance(self.merge,list) else self.merge


def merge_edit(merge,chapters=None,sections=1):
 runtime=EditRuntime(merge,chapters)
 with tempfile.TemporaryDirectory() as directory,patch('worker.lesson_video.frame',return_value='data:image/jpeg;base64,AA'),patch('worker.lesson_video.contextualize_edit',side_effect=lambda rt,row,edit,*args:edit):
  result=create_edit(runtime,{},'source',directory,[{'start_s':0,'end_s':600,'utterances':[]} for _ in range(sections)],600)
 return result,runtime

def candidate_chapters(count,duration=30):
 return [{'title':f'Topic {i}','cues':['Recover after each shot.'],'start_s':0,'end_s':duration} for i in range(count)]

def selected(chapter_ids):
 return {'title':'Lesson','chapters':[{'candidate_id':candidate_id,'title':'Topic','cues':['Recover after each shot.']} for candidate_id in chapter_ids], 'themes':[]}


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
  self.assertEqual(candidates[0],{'candidate_id':'candidate-1','section_title':'Lesson','title':'First','cues':['Recover after each shot.'],'duration_seconds':40})
  self.assertTrue(all(set(key for key in candidate if key.endswith('_s') or key=='duration_seconds')=={'duration_seconds'} for candidate in candidates))
  self.assertNotIn('start_s',str(candidates));self.assertNotIn('end_s',str(candidates))
 def test_merge_refuses_model_authored_timestamps(self):
  for extra in [{'start_s':0,'end_s':40},{'duration_seconds':40}]:
   with self.subTest(extra=extra),self.assertRaisesRegex(ValueError,'Retry to continue'):
    merge_edit({'title':'Lesson','chapters':[{'candidate_id':'candidate-1','title':'First','cues':['Recover after each shot.'],**extra}], 'themes':[]})
 def test_merge_refuses_unknown_or_duplicate_candidate_ids(self):
  for chapter_ids in [['candidate-3'],['candidate-1','candidate-1']]:
    with self.subTest(chapter_ids=chapter_ids),self.assertRaisesRegex(ValueError,'Retry to continue'):
     merge_edit({'title':'Lesson','chapters':[{'candidate_id':candidate_id,'title':'Topic','cues':['Recover after each shot.']} for candidate_id in chapter_ids], 'themes':[]})
 def test_merge_repairs_more_than_sixteen_chapters_without_truncating(self):
  result,runtime=merge_edit([selected([f'candidate-{i}' for i in range(1,19)]),selected([f'candidate-{i}' for i in range(1,18)]),selected(['candidate-1'])],candidate_chapters(18))
  self.assertEqual(len(result['chapters']),1);self.assertEqual(runtime.merge_calls,3)
  repair=[json.loads(item['text']) for item in runtime.merge_contents[1] if item.get('type')=='text'][-1]
  self.assertEqual(repair['selection_requirements']['maximum_chapters'],16)
  self.assertIn('18 chapters',repair['selection_validation_error'])
  self.assertIn('10 to 14',runtime.merge_prompts[1])
  self.assertIn('17 chapters',runtime.merge_prompts[2])
  self.assertIn('complete_outline',runtime.merge_contents[1][0]['text'])
  self.assertIn('candidate-6',str(runtime.merge_contents[1]))
 def test_merge_stops_after_three_invalid_selections(self):
  invalid=selected([f'candidate-{i}' for i in range(1,18)])
  runtime=EditRuntime([invalid,invalid,invalid])
  with tempfile.TemporaryDirectory() as directory,patch('worker.lesson_video.frame',return_value='data:image/jpeg;base64,AA'),patch('worker.lesson_video.contextualize_edit',side_effect=lambda rt,row,edit,*args:edit),self.assertRaisesRegex(ValueError,'Retry to continue'):
   create_edit(runtime,{},'source',directory,[{'start_s':0,'end_s':600,'utterances':[]}],600)
  self.assertEqual(runtime.merge_calls,3)
 def test_merge_repairs_worker_owned_duration_over_nine_hundred_seconds(self):
  result,runtime=merge_edit([selected([f'candidate-{i}' for i in range(1,11)]),selected(['candidate-1'])],candidate_chapters(10,100),sections=2)
  self.assertEqual(len(result['chapters']),1);self.assertEqual(runtime.merge_calls,2)
  self.assertIn('1000.0 seconds, 100.0 seconds over',runtime.merge_prompts[1])
 def test_merge_uses_varied_candidate_durations_to_repair_the_budget(self):
  chapters=[
   {'title':'A','cues':['Recover after each shot.'],'start_s':0,'end_s':120},
   {'title':'B','cues':['Recover after each shot.'],'start_s':0,'end_s':115},
   {'title':'C','cues':['Recover after each shot.'],'start_s':0,'end_s':110},
   {'title':'D','cues':['Recover after each shot.'],'start_s':0,'end_s':100},
   {'title':'E','cues':['Recover after each shot.'],'start_s':0,'end_s':95},
   {'title':'F','cues':['Recover after each shot.'],'start_s':0,'end_s':90},
  ]
  result,runtime=merge_edit([selected([f'candidate-{i}' for i in range(1,11)]),selected([f'candidate-{i}' for i in range(1,9)])],chapters,sections=2)
  self.assertEqual(runtime.merge_calls,2)
  self.assertEqual(sum(chapter['end_s']-chapter['start_s'] for chapter in result['chapters']),865)
  metadata=[json.loads(item['text']) for item in runtime.merge_contents[1] if item.get('type')=='text' and 'candidate_id' in item['text']]
  self.assertEqual([candidate['duration_seconds'] for candidate in metadata[:6]],[120,115,110,100,95,90])
  self.assertIn('sum the supplied duration_seconds',runtime.merge_prompts[1])
 def test_merge_repairs_unknown_id_and_bounded_timestamp_failures(self):
  result,runtime=merge_edit([selected(['candidate-99']),selected(['candidate-1'])])
  self.assertEqual(result['chapters'][0]['start_s'],100);self.assertEqual(runtime.merge_calls,2)
  bad={'title':'Lesson','chapters':[{'candidate_id':'candidate-1','title':'Topic','cues':['Recover after each shot.'],'start_s':0}], 'themes':[]}
  runtime=EditRuntime([bad,bad])
  with tempfile.TemporaryDirectory() as directory,patch('worker.lesson_video.frame',return_value='data:image/jpeg;base64,AA'),patch('worker.lesson_video.contextualize_edit',side_effect=lambda rt,row,edit,*args:edit),self.assertRaisesRegex(ValueError,'Retry to continue'):
   create_edit(runtime,{},'source',directory,[{'start_s':0,'end_s':600,'utterances':[]}],600)
  self.assertEqual(runtime.merge_calls,3)
 def test_merge_repairs_and_bounds_malformed_chapter_schema(self):
  malformed={'title':'Lesson','chapters':[{'candidate_id':'candidate-1'}], 'themes':[]}
  result,runtime=merge_edit([malformed,selected(['candidate-1'])])
  self.assertEqual(result['chapters'][0]['title'],'Topic');self.assertEqual(runtime.merge_calls,2)
  self.assertIn('title',runtime.merge_prompts[1])
  for bad_chapter in [
   {'candidate_id':'candidate-1'},
   {'candidate_id':'candidate-1','title':123,'cues':['Recover after each shot.']},
   {'candidate_id':'candidate-1','title':'','cues':['Recover after each shot.']},
   {'candidate_id':'candidate-1','title':'T'*81,'cues':['Recover after each shot.']},
   {'candidate_id':'candidate-1','title':'Topic','cues':'Recover after each shot.'},
   {'candidate_id':'candidate-1','title':'Topic','cues':[]},
   {'candidate_id':'candidate-1','title':'Topic','cues':[123]},
   {'candidate_id':'candidate-1','title':'Topic','cues':['One','Two','Three','Four']},
   {'candidate_id':'candidate-1','title':'Topic','cues':['x'*221]},
  ]:
   runtime=EditRuntime([{'title':'Lesson','chapters':[bad_chapter],'themes':[]}] * 3)
   with tempfile.TemporaryDirectory() as directory,patch('worker.lesson_video.frame',return_value='data:image/jpeg;base64,AA'),patch('worker.lesson_video.contextualize_edit',side_effect=lambda rt,row,edit,*args:edit),self.assertRaisesRegex(ValueError,'Retry to continue'):
    create_edit(runtime,{},'source',directory,[{'start_s':0,'end_s':600,'utterances':[]}],600)
   self.assertEqual(runtime.merge_calls,3)
if __name__=='__main__': unittest.main()
