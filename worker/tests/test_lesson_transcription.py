import tempfile
import unittest
from unittest.mock import Mock, patch
from worker.lesson_video import (
 ASR_VERSION, Runtime, inaudible_sections, merge_segments, thin_transcript,
 transcript_chunk_reusable, transcript_density, transcript_words, window_candidates,
)

def chunk(start,end,texts,**extra):
 span=(end-start)/max(len(texts),1)
 return {'start_s':start,'end_s':end,'utterances':[
   {'start_s':start+i*span,'end_s':start+(i+1)*span,'text':t} for i,t in enumerate(texts)
 ],**extra}

# One real ten-minute section, transcribed four ways. Every number here was
# measured on the same audio, so the floor is read off the gap between them
# rather than chosen.
MEASURED_WORDS_IN_600_SECONDS={'deepgram-nova-3':8,'gpt-4o-transcribe-diarize':102,'whisper-1':639}

class TranscriptDensityTests(unittest.TestCase):
 def test_the_floor_separates_the_transcribers_that_were_measured(self):
  # The same ten minutes of one real lesson, put through three
  # transcribers. Two of them did not hear the room. The floor has to
  # agree with what a person watching the recap concluded.
  heard={name:not thin_transcript([{'text':'x '*words}],600)
         for name,words in MEASURED_WORDS_IN_600_SECONDS.items()}
  self.assertEqual(heard,{'deepgram-nova-3':False,'gpt-4o-transcribe-diarize':False,'whisper-1':True})

 def test_the_floor_sits_in_the_gap_between_heard_and_missed(self):
  # Measured failures ran 0.5 to 6.5 words a minute; measured successes
  # ran 25.6 to 149.5. Anything claiming to be a floor has to separate
  # those two groups and nothing in between has ever been observed.
  for missed in (0.5,0.8,1.0,1.7,2.1,2.8,3.6,6.5):
   self.assertTrue(thin_transcript([{'text':'x '*round(missed*10)}],600),missed)
  for heard in (25.6,33.1,42.7,51.3,93.0,149.5):
   self.assertFalse(thin_transcript([{'text':'x '*round(heard*10)}],600),heard)

 def test_a_short_quiet_clip_is_judged_on_rate_not_on_a_word_count(self):
  # Twelve words is plenty for a twenty-second clip and nothing at all
  # for ten minutes. A count cannot tell those apart; a rate can.
  self.assertFalse(thin_transcript([{'text':'one two three four five six seven eight'}],20))
  self.assertTrue(thin_transcript([{'text':'one two three four five six seven eight'}],600))

 def test_density_of_an_empty_or_zero_length_section_is_zero(self):
  self.assertEqual(transcript_density([],600),0.0)
  self.assertEqual(transcript_density([{'text':'anything'}],0),0.0)
  self.assertEqual(transcript_words([{'transcript':'two words'},{'text':None}]),2)

class TranscriptReuseTests(unittest.TestCase):
 def test_a_thin_section_is_reheard_until_the_current_ladder_has_tried(self):
  # This is the bug that pinned a lesson to eight words for good: the
  # old gate marked its own near-silent answer reusable immediately, so
  # no retry could ever replace it.
  thin=chunk(0,600,['Yeah.'],asr_version=2)
  self.assertFalse(transcript_chunk_reusable(thin))
  self.assertTrue(transcript_chunk_reusable({**thin,'asr_version':ASR_VERSION}))

 def test_a_section_that_was_heard_is_never_paid_for_twice(self):
  heard=chunk(0,600,['word ']*600,asr_version=2)
  self.assertTrue(transcript_chunk_reusable(heard))
  self.assertTrue(transcript_chunk_reusable({**heard,'asr_version':3}))

 def test_inaudible_sections_are_named_so_nothing_builds_on_them(self):
  transcript=[chunk(0,600,['Yeah.']),chunk(600,1200,['word ']*600),chunk(1200,1800,[])]
  self.assertEqual([c['start_s'] for c in inaudible_sections(transcript)],[0,1200])

class TranscriptionLadderTests(unittest.TestCase):
 def rt(self,**rungs):
  rt=Runtime.__new__(Runtime);rt.openai='test';rt.http=Mock();rt.meter_events=Mock()
  for name,value in rungs.items():setattr(rt,name,value)
  return rt

 def test_a_section_that_is_heard_first_time_never_pays_for_the_second_rung(self):
  heard=[{'start_s':0,'end_s':600,'text':'word '*600}]
  second=Mock()
  rt=self.rt(transcribe_whisper=Mock(return_value=heard),transcribe_diarized=second)
  self.assertEqual(rt.transcribe('audio.mp3',0,600),heard)
  second.assert_not_called()

 def test_a_thin_first_rung_escalates_and_the_best_answer_wins(self):
  thin=[{'start_s':0,'end_s':600,'text':'Yeah.'}]
  rich=[{'start_s':0,'end_s':600,'text':'word '*600}]
  rt=self.rt(transcribe_whisper=Mock(return_value=thin),transcribe_diarized=Mock(return_value=rich))
  self.assertEqual(rt.transcribe('audio.mp3',0,600),rich)

 def test_a_genuinely_quiet_section_keeps_the_most_that_was_heard(self):
  # Both rungs answered and both heard almost nothing. That is a real
  # state, not a failure: keep the fuller answer and let the caller
  # decide it was inaudible.
  quiet=[{'start_s':0,'end_s':600,'text':'Yeah, okay.'}]
  quieter=[{'start_s':0,'end_s':600,'text':'Mm.'}]
  rt=self.rt(transcribe_whisper=Mock(return_value=quieter),transcribe_diarized=Mock(return_value=quiet))
  self.assertEqual(rt.transcribe('audio.mp3',0,600),quiet)

 @patch('worker.lesson_video.time.sleep')
 def test_every_rung_failing_asks_for_a_retry_rather_than_saving_silence(self,_sleep):
  # An empty section saved here would be read afterwards as silence in
  # the room, and never transcribed again.
  boom=Mock(side_effect=RuntimeError('network'))
  rt=self.rt(transcribe_whisper=boom,transcribe_diarized=boom)
  with self.assertRaises(RuntimeError):rt.transcribe('audio.mp3',0,600)

 @patch('worker.lesson_video.time.sleep')
 def test_one_rung_failing_outright_still_uses_the_other(self,_sleep):
  rich=[{'start_s':0,'end_s':600,'text':'word '*600}]
  rt=self.rt(transcribe_whisper=Mock(side_effect=RuntimeError('network')),transcribe_diarized=Mock(return_value=rich))
  self.assertEqual(rt.transcribe('audio.mp3',0,600),rich)

 def test_whisper_is_greedy_and_metered_by_measured_seconds(self):
  response=Mock();response.headers={'x-request-id':'test'}
  response.json.return_value={'duration':600,'segments':[{'start':1,'end':3,'text':'Bend your knees.'}]}
  rt=self.rt();rt.http.post.return_value=response
  with tempfile.NamedTemporaryFile() as f:result=rt.transcribe_whisper(f.name,600)
  self.assertEqual(result,[{'start_s':601,'end_s':603,'speaker':None,'text':'Bend your knees.'}])
  sent=rt.http.post.call_args.kwargs['data']
  self.assertEqual(sent['model'],'whisper-1')
  self.assertEqual(sent['temperature'],0)
  self.assertEqual(rt.meter_events.call_args.args[0][0]['quantity'],600)
  self.assertEqual(rt.meter_events.call_args.args[0][0]['sku'],'whisper-1')

 def test_a_segment_outside_the_recording_is_refused(self):
  response=Mock();response.headers={}
  response.json.return_value={'duration':60,'segments':[{'start':10,'end':800,'text':'Bend.'}]}
  rt=self.rt();rt.http.post.return_value=response
  with tempfile.NamedTemporaryFile() as f:
   with self.assertRaises(ValueError):rt.transcribe_whisper(f.name,0)

class MergeSegmentsTests(unittest.TestCase):
 def test_adjacent_pieces_join_and_a_real_pause_starts_a_new_utterance(self):
  segments=[{'start':0,'end':2,'text':'Bend your knees.'},{'start':2.5,'end':4,'text':'Stay low.'},
            {'start':40,'end':42,'text':'Again.'}]
  out=merge_segments(segments,600,600)
  self.assertEqual([(u['start_s'],u['end_s'],u['text']) for u in out],
    [(600.0,604.0,'Bend your knees. Stay low.'),(640.0,642.0,'Again.')])

 def test_an_utterance_stops_growing_before_it_swallows_the_section(self):
  segments=[{'start':i,'end':i+1,'text':'word'} for i in range(0,120)]
  out=merge_segments(segments,0,600)
  self.assertTrue(all(u['end_s']-u['start_s']<=45 for u in out))
  self.assertEqual(transcript_words(out),120)

 def test_empty_pieces_are_dropped_without_moving_any_timing(self):
  out=merge_segments([{'start':0,'end':1,'text':'  '},{'start':5,'end':6,'text':'Push.'}],0,600)
  self.assertEqual(out,[{'start_s':5.0,'end_s':6.0,'speaker':None,'text':'Push.'}])

class ClipEvidenceTests(unittest.TestCase):
 def section(self,texts):
  return chunk(0,600,texts)

 def test_a_clip_with_no_speech_under_it_is_not_a_candidate(self):
  # The eight-word section that started all this proposed chapters
  # anyway, and every one of them was written out of nothing.
  section=self.section(['Yeah.','I mean,','I guess'])
  raw={'title':'Lesson','chapters':[{'title':'Stay low','cues':['Stay low.'],'start_s':100,'end_s':160}]}
  valid,errors=window_candidates(raw,section,600)
  self.assertEqual(valid,[])
  self.assertEqual(errors,[])

 def test_a_clip_over_real_speech_is_kept(self):
  section={'start_s':0,'end_s':600,'utterances':[{'start_s':100,'end_s':160,'text':'word '*40}]}
  raw={'title':'Lesson','chapters':[{'title':'Stay low','cues':['Stay low.'],'start_s':100,'end_s':160}]}
  valid,errors=window_candidates(raw,section,600)
  self.assertEqual(errors,[])
  self.assertEqual(len(valid),1)

if __name__=='__main__':unittest.main()
