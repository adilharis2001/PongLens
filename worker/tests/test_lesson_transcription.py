import unittest
from unittest.mock import Mock
from worker.lesson_video import Runtime, sparse_transcript, transcript_chunk_reusable

class LessonTranscriptionTests(unittest.TestCase):
 def test_saved_empty_legacy_chunks_are_retried_only_once(self):
  old={'utterances':[]}
  self.assertFalse(transcript_chunk_reusable(old))
  self.assertTrue(transcript_chunk_reusable({**old,'asr_version':2}))
  self.assertFalse(transcript_chunk_reusable({'utterances':[{'text':'So'}]}))
  self.assertTrue(transcript_chunk_reusable({'utterances':[{'text':'Bend your knees.'}]}))
 def test_fallback_uses_actual_source_timestamps_and_meters_duration(self):
  rt=Runtime.__new__(Runtime);rt.openai='test';rt.http=Mock();rt.meter_events=Mock()
  response=Mock();response.json.return_value={'duration':60,'segments':[{'start':2.5,'end':5.1,'speaker':'A','text':'Bend your knees.'}]};response.headers={'x-request-id':'test'};rt.http.post.return_value=response
  import tempfile
  with tempfile.NamedTemporaryFile() as f:result=rt.transcribe_fallback(f.name,600)
  self.assertEqual(result,[{'start_s':602.5,'end_s':605.1,'speaker':'A','text':'Bend your knees.'}])
  self.assertEqual(rt.http.post.call_args.kwargs['data']['response_format'],'diarized_json')
  self.assertEqual(rt.meter_events.call_args.args[0][0]['quantity'],60)
 def test_invalid_fallback_time_is_refused(self):
  rt=Runtime.__new__(Runtime);rt.openai='test';rt.http=Mock();rt.meter_events=Mock()
  response=Mock();response.json.return_value={'duration':60,'segments':[{'start':10,'end':80,'text':'Bend.'}]};response.headers={};rt.http.post.return_value=response
  import tempfile
  with tempfile.NamedTemporaryFile() as f:
   with self.assertRaises(ValueError):rt.transcribe_fallback(f.name,0)

 def test_only_sparse_deepgram_result_uses_fallback(self):
  import tempfile
  for text,expected_fallback in [('So',True),('Bend your knees.',False)]:
   rt=Runtime.__new__(Runtime);rt.deepgram='test';rt.http=Mock();rt.meter_events=Mock();rt.transcribe_fallback=Mock(return_value=[{'text':'Recovered'}])
   response=Mock();response.json.return_value={'metadata':{'duration':60},'results':{'utterances':[{'start':1,'end':2,'transcript':text}]}};rt.http.post.return_value=response
   with tempfile.NamedTemporaryFile() as f:result=rt.transcribe(f.name,600)
   self.assertEqual(rt.transcribe_fallback.called,expected_fallback)
   if not expected_fallback:self.assertEqual(result[0]['start_s'],601)
