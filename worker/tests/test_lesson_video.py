import unittest
from worker.lesson_video import normalize_edit, chunk_ranges, release_id
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
if __name__=='__main__': unittest.main()
