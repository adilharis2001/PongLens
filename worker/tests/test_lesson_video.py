import json
import tempfile
import unittest
from unittest.mock import patch
from worker.lesson_video import create_edit, normalize_edit, chunk_ranges, release_id, student_warning
from worker.tests.lesson_fixtures import audible_transcript


class EditRuntime:
 def __init__(self,merge,chapters=None,outline=None,window=None,focus=None): self.focus=focus;self.focus_calls=0;self.merge=merge;self.merge_content=None;self.merge_contents=[];self.merge_prompts=[];self.merge_calls=0;self.chapters=chapters;self.outline=outline;self.window=window;self.window_calls=0;self.window_sections=0;self.window_prompts=[];self.window_contents=[]
 def stage(self,*args): pass
 def model(self,prompt,content):
  if 'Extract the teaching' in prompt:
   self.window_prompts.append(prompt);self.window_contents.append(content);self.window_calls+=1
   if 'window_validation_error' not in json.loads(content):self.window_sections+=1
   raw=self.window[min(self.window_calls-1,len(self.window)-1)] if self.window is not None else {'title':'Lesson','themes':[{'name':'Footwork','points':['Recover after each shot.']}], 'chapters':self.chapters or [
    {'title':'First','cues':['Recover after each shot.'],'start_s':100,'end_s':140},
    {'title':'Second','cues':['Move back into position.'],'start_s':200,'end_s':250},
   ]}
   if self.window_sections==1:return raw
   shifted=json.loads(json.dumps(raw));offset=(self.window_sections-1)*600
   for chapter in shifted.get('chapters',[]):
    if isinstance(chapter,dict):
     if 'start_s' in chapter:chapter['start_s']+=offset
     if 'end_s' in chapter:chapter['end_s']+=offset
   return shifted
  if 'Build the complete teaching outline' in prompt:
   return self.outline if self.outline is not None else {'title':'Lesson','themes':[{'name':'Footwork','points':['Recover after each shot.']}]}
  # The two lists that bracket the recap. A lesson that stated neither is
  # the default here, so every older test still describes the same recap.
  if 'the two lists that bracket the recap' in prompt:
   self.focus_calls+=1
   return self.focus if self.focus is not None else {'goals':[],'work_on':[]}
  self.merge_content=content
  self.merge_contents.append(content)
  self.merge_prompts.append(prompt)
  self.merge_calls+=1
  return self.merge[min(self.merge_calls-1,len(self.merge)-1)] if isinstance(self.merge,list) else self.merge


def merge_edit(merge,chapters=None,sections=1,duration=600,outline=None,window=None,focus=None):
 runtime=EditRuntime(merge,chapters,outline,window,focus)
 with tempfile.TemporaryDirectory() as directory,patch('worker.lesson_video.frame',return_value='data:image/jpeg;base64,AA'),patch('worker.lesson_video.contextualize_edit',side_effect=lambda rt,row,edit,*args:edit):
  source_duration=max(duration,sections*600)
  result=create_edit(runtime,{},'source',directory,audible_transcript(sections),source_duration)
 return result,runtime

def candidate_chapters(count,duration=30):
 return [{'title':f'Topic {i}','cues':['Recover after each shot.'],'start_s':i*duration,'end_s':(i+1)*duration} for i in range(count)]

def selected(chapter_ids):
 return {'title':'Lesson','chapters':[{'candidate_id':candidate_id,'title':'Topic','cues':['Recover after each shot.']} for candidate_id in chapter_ids], 'themes':[]}


class LessonVideoTests(unittest.TestCase):
 def test_ninety_minutes_has_complete_nonoverlapping_audio_coverage(self):
  ranges=chunk_ranges(5400)
  self.assertEqual(ranges[0],(0,1200));self.assertEqual(ranges[-1],(4800,5400));self.assertEqual(sum(b-a for a,b in ranges),5400)
 def test_fractional_container_tail_is_merged(self):
  ranges=chunk_ranges(5400.033)
  self.assertEqual(len(ranges),5);self.assertEqual(ranges[-1],(4800,5400.033))
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
 def test_warning_is_student_facing_deduplicated_and_sentence_safe(self):
  chapters=[
   {'title':'A','cues':['B'],'start_s':0,'end_s':100},
   {'title':'B','cues':['C'],'start_s':200,'end_s':300},
  ]
  warning='Candidate candidate-4 exceeded the 900-second planning budget. The coach\'s wording about the receive was unclear. The coach\'s wording about the receive was unclear.'
  edit=normalize_edit({'title':'Lesson','chapters':chapters,'warning':warning},1000)
  self.assertEqual(edit['warning'],"The coach's wording about the receive was unclear.")
  combined=student_warning('The coach\'s wording about the receive was unclear.','The coach\'s wording about the receive was unclear. Another instruction was unclear.')
  self.assertEqual(combined,"The coach's wording about the receive was unclear. Another instruction was unclear.")
  first='First supported uncertainty '+('x '*250)+'.'
  second='Second supported uncertainty '+('y '*250)+'.'
  capped=normalize_edit({'title':'Lesson','chapters':chapters,'warning':first+' '+second},1000)['warning']
  self.assertLessEqual(len(capped),600);self.assertTrue(capped.endswith('.'));self.assertIn('First supported uncertainty',capped);self.assertNotIn('Second supported uncertainty',capped)
 def test_merge_warning_cannot_replace_complete_outline_uncertainty(self):
  chapters=[
   {'title':'A','cues':['B'],'start_s':0,'end_s':100},
   {'title':'B','cues':['C'],'start_s':200,'end_s':300},
  ]
  outline={'title':'Lesson','themes':[{'name':'Footwork','points':['Keep this supported instruction.']}],'warning':'The coach\'s wording about the receive was unclear.'}
  merged=selected(['candidate-1','candidate-2']);merged['warning']='Clips omitted to keep recap short.'
  result,_=merge_edit(merged,chapters,outline=outline)
  self.assertEqual(result['warning'],outline['warning'])
  self.assertNotIn('clips omitted',result['warning'].lower())
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
  self.assertEqual(candidates[0],{'candidate_id':'candidate-1','section_id':'section-1','section_title':'Lesson','title':'First','cues':['Recover after each shot.'],'duration_seconds':40})
  self.assertTrue(all(set(key for key in candidate if key.endswith('_s') or key=='duration_seconds')=={'duration_seconds'} for candidate in candidates))
  self.assertNotIn('start_s',str(candidates));self.assertNotIn('end_s',str(candidates))
 def test_merge_refuses_model_authored_timestamps(self):
  for extra in [{'start_s':0,'end_s':40},{'duration_seconds':40},{'section_id':'section-1'}]:
   with self.subTest(extra=extra),self.assertRaisesRegex(ValueError,'Retry to continue'):
    merge_edit({'title':'Lesson','chapters':[{'candidate_id':'candidate-1','title':'First','cues':['Recover after each shot.'],**extra}], 'themes':[]})
 def test_merge_refuses_unknown_or_duplicate_candidate_ids(self):
  for chapter_ids in [['candidate-3'],['candidate-1','candidate-1']]:
    with self.subTest(chapter_ids=chapter_ids),self.assertRaisesRegex(ValueError,'Retry to continue'):
     merge_edit({'title':'Lesson','chapters':[{'candidate_id':candidate_id,'title':'Topic','cues':['Recover after each shot.']} for candidate_id in chapter_ids], 'themes':[]})
 def test_merge_repairs_more_than_sixteen_chapters_without_truncating(self):
  result,runtime=merge_edit([selected([f'candidate-{i}' for i in range(1,19)]),selected([f'candidate-{i}' for i in range(1,18)]),selected(['candidate-1'])],candidate_chapters(6),sections=3)
  self.assertEqual(len(result['chapters']),1);self.assertEqual(runtime.merge_calls,3)
  repair=[json.loads(item['text']) for item in runtime.merge_contents[1] if item.get('type')=='text'][-1]
  self.assertEqual(repair['selection_requirements']['maximum_chapters'],16)
  self.assertIn('18 chapters',repair['selection_validation_error'])
  # The correction is keyed to the outline, not to a chapter count: the
  # old "10 to 14" was written for a 90-minute lesson and read by every
  # 60-minute one too.
  self.assertIn('one chapter per distinct outline topic',runtime.merge_prompts[1])
  self.assertIn('17 chapters',runtime.merge_prompts[2])
  self.assertIn('complete_outline',runtime.merge_contents[1][0]['text'])
  self.assertIn('candidate-6',str(runtime.merge_contents[1]))
 def test_merge_stops_after_three_invalid_selections(self):
  invalid=selected([f'candidate-{i}' for i in range(1,18)])
  runtime=EditRuntime([invalid,invalid,invalid])
  with tempfile.TemporaryDirectory() as directory,patch('worker.lesson_video.frame',return_value='data:image/jpeg;base64,AA'),patch('worker.lesson_video.contextualize_edit',side_effect=lambda rt,row,edit,*args:edit),self.assertRaisesRegex(ValueError,'Retry to continue'):
   create_edit(runtime,{},'source',directory,audible_transcript(1),600)
  self.assertEqual(runtime.merge_calls,3)
 def test_merge_repairs_worker_owned_duration_over_nine_hundred_seconds(self):
  result,runtime=merge_edit([selected([f'candidate-{i}' for i in range(1,11)]),selected(['candidate-1'])],candidate_chapters(5,100),sections=2)
  # Over budget, corrected to one chapter, then asked once more to cover
  # more topics before being taken as it is.
  self.assertEqual(len(result['chapters']),1);self.assertEqual(runtime.merge_calls,3)
  self.assertIn('1000.0 seconds, 100.0 seconds over',runtime.merge_prompts[1])
 def test_merge_uses_varied_candidate_durations_to_repair_the_budget(self):
  chapters=[
   {'title':'A','cues':['Recover after each shot.'],'start_s':0,'end_s':120},
   {'title':'B','cues':['Recover after each shot.'],'start_s':120,'end_s':235},
   {'title':'C','cues':['Recover after each shot.'],'start_s':235,'end_s':345},
   {'title':'D','cues':['Recover after each shot.'],'start_s':345,'end_s':445},
   {'title':'E','cues':['Recover after each shot.'],'start_s':445,'end_s':540},
  ]
  result,runtime=merge_edit([selected([f'candidate-{i}' for i in range(1,11)]),selected([f'candidate-{i}' for i in range(1,9)])],chapters,sections=2)
  self.assertEqual(runtime.merge_calls,2)
  self.assertEqual(sum(chapter['end_s']-chapter['start_s'] for chapter in result['chapters']),885)
  metadata=[json.loads(item['text']) for item in runtime.merge_contents[1] if item.get('type')=='text' and 'candidate_id' in item['text']]
  self.assertEqual([candidate['duration_seconds'] for candidate in metadata[:5]],[120,115,110,100,95])
  self.assertIn('sum the supplied duration_seconds',runtime.merge_prompts[1])
 def test_merge_repairs_overlapping_candidate_ranges_without_replay(self):
  chapters=[
   {'title':'Timing','cues':['Recover after each shot.'],'start_s':100,'end_s':170},
   {'title':'Backhand','cues':['Recover after each shot.'],'start_s':160,'end_s':220},
   {'title':'Serve','cues':['Recover after each shot.'],'start_s':300,'end_s':360},
  ]
  result,runtime=merge_edit([selected(['candidate-1','candidate-2']),selected(['candidate-1','candidate-3'])],chapters)
  self.assertEqual(runtime.merge_calls,2)
  self.assertEqual([(chapter['start_s'],chapter['end_s']) for chapter in result['chapters']],[(100,170),(300,360)])
  self.assertIn('candidate-1 and candidate-2 overlap',runtime.merge_prompts[1])
  self.assertIn('distinct footage/topics',runtime.merge_prompts[1])
 def test_merge_allows_a_tenth_second_source_boundary_tolerance(self):
  chapters=[
   {'title':'Timing','cues':['Recover after each shot.'],'start_s':100,'end_s':170},
   {'title':'Backhand','cues':['Recover after each shot.'],'start_s':169.9,'end_s':230},
  ]
  result,runtime=merge_edit(selected(['candidate-1','candidate-2']),chapters)
  self.assertEqual(len(result['chapters']),2);self.assertEqual(runtime.merge_calls,1)
 def test_window_repairs_overlong_teaching_candidate_without_dropping_theme(self):
  overlong={'title':'Lesson','themes':[{'name':'Pips','points':['Build the point before attacking.']}],'chapters':[{'title':'Pips and point building','cues':['Build the point before attacking.'],'start_s':100,'end_s':400}]}
  repaired={'title':'Lesson','themes':[{'name':'Pips','points':['Build the point before attacking.']}],'chapters':[{'title':'Pips and point building','cues':['Build the point before attacking.'],'start_s':100,'end_s':160}]}
  result,runtime=merge_edit(selected(['candidate-1']),window=[overlong,repaired])
  self.assertEqual(runtime.window_calls,2);self.assertEqual(runtime.merge_calls,1)
  self.assertEqual((result['chapters'][0]['start_s'],result['chapters'][0]['end_s']),(100,160))
  repair=json.loads(runtime.window_contents[1])
  self.assertIn('Pips and point building',repair['window_validation_error'])
  self.assertEqual(repair['retain_supported_themes'],overlong['themes'])
 def test_window_repairs_a_still_overlong_second_response_on_the_third_call(self):
  overlong={'title':'Lesson','themes':[{'name':'Pips','points':['Build the point before attacking.']}],'chapters':[{'title':'Pips and point building','cues':['Build the point before attacking.'],'start_s':100,'end_s':400}]}
  still_overlong={'title':'Lesson','themes':[{'name':'Pips','points':['Build the point before attacking.']}],'chapters':[{'title':'Pips and point building','cues':['Build the point before attacking.'],'start_s':100,'end_s':290}]}
  repaired={'title':'Lesson','themes':[{'name':'Pips','points':['Build the point before attacking.']}],'chapters':[{'title':'Pips and point building','cues':['Build the point before attacking.'],'start_s':100,'end_s':160}]}
  result,runtime=merge_edit(selected(['candidate-1']),window=[overlong,still_overlong,repaired])
  self.assertEqual(runtime.window_calls,3);self.assertEqual(runtime.merge_calls,1)
  self.assertEqual((result['chapters'][0]['start_s'],result['chapters'][0]['end_s']),(100,160))
  third_content=json.loads(runtime.window_contents[2])
  self.assertIn("'Pips and point building'",third_content['window_validation_error'])
  self.assertIn('Range 100–290 is 70s over the 120s hard maximum',third_content['window_validation_error'])
  self.assertIn('25–90 seconds',third_content['window_validation_error'])
  self.assertEqual(third_content['retain_supported_themes'],overlong['themes'])
 def test_unrepaired_window_candidate_fails_instead_of_silently_dropping_teaching(self):
  overlong={'title':'Lesson','themes':[{'name':'Pips','points':['Build the point before attacking.']}],'chapters':[{'title':'Pips and point building','cues':['Build the point before attacking.'],'start_s':100,'end_s':400}]}
  runtime=EditRuntime(selected(['candidate-1']),window=[overlong,overlong,overlong])
  with tempfile.TemporaryDirectory() as directory,patch('worker.lesson_video.frame',return_value='data:image/jpeg;base64,AA'),self.assertRaisesRegex(ValueError,'Retry to continue'):
   create_edit(runtime,{},'source',directory,audible_transcript(1),600)
  self.assertEqual(runtime.window_calls,3);self.assertEqual(runtime.merge_calls,0)
 def test_rich_long_lessons_repair_to_cover_candidate_sections_and_twelve_chapters(self):
  outline={'title':'Lesson','themes':[{'name':f'Theme {i}','points':['Keep this supported instruction.']} for i in range(1,9)]}
  spaced=[
   {'title':'A','cues':['Recover after each shot.'],'start_s':0,'end_s':30},
   {'title':'B','cues':['Recover after each shot.'],'start_s':75,'end_s':105},
  ]
  initial=selected(['candidate-1','candidate-3','candidate-5','candidate-7','candidate-9','candidate-10','candidate-11','candidate-12','candidate-13','candidate-14'])
  repaired=selected(['candidate-1','candidate-3','candidate-5','candidate-7','candidate-9','candidate-11','candidate-13','candidate-15','candidate-17','candidate-2','candidate-4','candidate-6'])
  result,runtime=merge_edit([initial,repaired],spaced,sections=9,duration=5400,outline=outline)
  self.assertEqual(len(result['chapters']),12);self.assertEqual(runtime.merge_calls,2)
  repair=[json.loads(item['text']) for item in runtime.merge_contents[1] if item.get('type')=='text'][-1]
  # Completeness comes from the lesson rather than from the clock. Here
  # nine sections carry teaching, so covering them already forces nine
  # chapters and a floor drawn from the eight outline themes would add
  # nothing; on a sixty-minute lesson with few sections and many themes
  # the themes are what hold the recap up. Between them there is a
  # coverage rule at every length, where before there was none at all
  # below seventy-five minutes.
  self.assertNotIn('minimum_chapters',repair['selection_requirements'])
  self.assertEqual(repair['selection_requirements']['required_section_ids'],[f'section-{i}' for i in range(1,10)])
  self.assertIn('section-8, section-9',repair['selection_validation_error'])
  candidates=[json.loads(item['text']) for item in runtime.merge_contents[0] if item.get('type')=='text' and 'candidate_id' in item['text']]
  self.assertEqual(candidates[0]['section_id'],'section-1')
  self.assertNotIn('start_s',str(candidates));self.assertNotIn('end_s',str(candidates))
 def test_infeasible_rich_twelve_chapter_floor_does_not_reject_eleven(self):
  outline={'title':'Lesson','themes':[{'name':f'Theme {i}','points':['Keep this supported instruction.']} for i in range(1,9)]}
  def response(chapters):return {'title':'Lesson','themes':[{'name':'Theme','points':['Keep this supported instruction.']}],'chapters':chapters}
  first=response([
   {'title':'A','cues':['Keep this supported instruction.'],'start_s':0,'end_s':60},
   {'title':'B','cues':['Keep this supported instruction.'],'start_s':60,'end_s':120},
   {'title':'C','cues':['Keep this supported instruction.'],'start_s':165,'end_s':225},
   {'title':'D','cues':['Keep this supported instruction.'],'start_s':270,'end_s':330},
  ])
  spaced=response([
   {'title':'E','cues':['Keep this supported instruction.'],'start_s':0,'end_s':60},
   {'title':'F','cues':['Keep this supported instruction.'],'start_s':105,'end_s':165},
   {'title':'G','cues':['Keep this supported instruction.'],'start_s':210,'end_s':270},
   {'title':'H','cues':['Keep this supported instruction.'],'start_s':315,'end_s':375},
  ])
  result,runtime=merge_edit(selected(['candidate-1','candidate-3','candidate-4',* [f'candidate-{i}' for i in range(5,13)]]),sections=3,duration=5400,outline=outline,window=[first,spaced,spaced])
  self.assertEqual(len(result['chapters']),11);self.assertEqual(runtime.merge_calls,1)
 def test_rich_long_recaps_repair_nearby_clips_to_later_distinct_footage(self):
  outline={'title':'Lesson','themes':[{'name':f'Theme {i}','points':['Keep this supported instruction.']} for i in range(1,9)]}
  def response(chapters):return {'title':'Lesson','themes':[{'name':'Theme','points':['Keep this supported instruction.']}],'chapters':chapters}
  first=response([
   {'title':'Third ball','cues':['Keep this supported instruction.'],'start_s':0,'end_s':30},
   {'title':'Third ball repeat','cues':['Keep this supported instruction.'],'start_s':30,'end_s':60},
   {'title':'Near third ball','cues':['Keep this supported instruction.'],'start_s':60,'end_s':90},
   {'title':'Match-like set','cues':['Keep this supported instruction.'],'start_s':75,'end_s':105},
  ])
  spaced=response([
   {'title':'Later topic','cues':['Keep this supported instruction.'],'start_s':0,'end_s':30},
   {'title':'Later topic two','cues':['Keep this supported instruction.'],'start_s':75,'end_s':105},
   {'title':'Later topic three','cues':['Keep this supported instruction.'],'start_s':150,'end_s':180},
   {'title':'Later topic four','cues':['Keep this supported instruction.'],'start_s':225,'end_s':255},
  ])
  first_selection=selected(['candidate-1','candidate-2','candidate-5','candidate-9'])
  second_selection=selected(['candidate-1','candidate-3','candidate-5','candidate-9'])
  repaired=selected(['candidate-1','candidate-4','candidate-5','candidate-9'])
  result,runtime=merge_edit([first_selection,second_selection,repaired],sections=3,duration=5400,outline=outline,window=[first,first,first,spaced,spaced])
  self.assertEqual(runtime.merge_calls,3);self.assertEqual(len(result['chapters']),4)
  self.assertIn('candidate-1 and candidate-2 leave only 0 source seconds',runtime.merge_prompts[1])
  self.assertIn('candidate-1 and candidate-3 leave only 30 source seconds',runtime.merge_prompts[2])
  self.assertIn('keep the stronger candidate',runtime.merge_prompts[1])
  self.assertEqual([(chapter['start_s'],chapter['end_s']) for chapter in result['chapters']][:2],[(0,30),(75,105)])
 def test_boundary_adjacent_required_sections_become_advisory_when_spacing_makes_coverage_impossible(self):
  outline={'title':'Lesson','themes':[{'name':f'Theme {i}','points':['Keep this supported instruction.']} for i in range(1,9)]}
  def response(chapters):return {'title':'Lesson','themes':[{'name':'Theme','points':['Keep this supported instruction.']}],'chapters':chapters}
  ending=response([{'title':f'End {i}','cues':['Keep this supported instruction.'],'start_s':480,'end_s':600} for i in range(6)])
  starting=response([{'title':f'Start {i}','cues':['Keep this supported instruction.'],'start_s':0,'end_s':120} for i in range(6)])
  result,runtime=merge_edit(selected(['candidate-1']),sections=2,duration=5400,outline=outline,window=[ending,starting])
  self.assertEqual(len(result['chapters']),1);self.assertEqual(runtime.merge_calls,1)
 def test_sparse_long_lesson_can_select_fewer_chapters(self):
  result,runtime=merge_edit(selected(['candidate-1']),candidate_chapters(2,30),duration=5400)
  self.assertEqual(len(result['chapters']),1);self.assertEqual(runtime.merge_calls,1)
 def test_an_hour_long_lesson_is_held_up_by_what_it_taught(self):
  """The case that produced six chapters one day and fourteen the next.

  Sixty-minute lessons are most of what gets uploaded, and below
  seventy-five minutes there was no coverage rule of any kind, so the
  number of chapters was whatever the model felt like that run. The
  outline is the checklist now, at every length.
  """
  outline={'title':'Lesson','themes':[{'name':f'Theme {i}','points':['Keep this supported instruction.']} for i in range(1,11)]}
  thin=selected(['candidate-1','candidate-2'])
  full=selected([f'candidate-{i}' for i in range(1,11)])
  result,runtime=merge_edit([thin,full],candidate_chapters(6,60),sections=3,duration=3600,outline=outline)
  self.assertEqual(len(result['chapters']),10)
  asked=[json.loads(item['text']) for item in runtime.merge_contents[1] if item.get('type')=='text'][-1]
  # The point is that a floor exists at this length at all, and that it
  # is drawn from the teaching. Its exact value follows what the footage
  # can carry without replaying itself.
  self.assertGreaterEqual(asked['selection_requirements']['minimum_chapters'],5)
  self.assertIn('distinct things',asked['selection_validation_error'])

 def test_impossible_section_coverage_does_not_deadlock(self):
  outline={'title':'Lesson','themes':[{'name':f'Theme {i}','points':['Keep this supported instruction.']} for i in range(1,9)]}
  result,runtime=merge_edit(selected(['candidate-1']),candidate_chapters(1,120),sections=9,duration=5400,outline=outline)
  # Asked twice to cover more of what was taught, and then accepted as
  # it stands. A recap that misses a topic beats a lesson that will not
  # render at all.
  self.assertEqual(len(result['chapters']),1);self.assertEqual(runtime.merge_calls,3)
 def test_merge_repairs_unknown_id_and_bounded_timestamp_failures(self):
  result,runtime=merge_edit([selected(['candidate-99']),selected(['candidate-1'])])
  self.assertEqual(result['chapters'][0]['start_s'],100);self.assertEqual(runtime.merge_calls,2)
  bad={'title':'Lesson','chapters':[{'candidate_id':'candidate-1','title':'Topic','cues':['Recover after each shot.'],'start_s':0}], 'themes':[]}
  runtime=EditRuntime([bad,bad])
  with tempfile.TemporaryDirectory() as directory,patch('worker.lesson_video.frame',return_value='data:image/jpeg;base64,AA'),patch('worker.lesson_video.contextualize_edit',side_effect=lambda rt,row,edit,*args:edit),self.assertRaisesRegex(ValueError,'Retry to continue'):
   create_edit(runtime,{},'source',directory,audible_transcript(1),600)
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
    create_edit(runtime,{},'source',directory,audible_transcript(1),600)
   self.assertEqual(runtime.merge_calls,3)
if __name__=='__main__': unittest.main()
