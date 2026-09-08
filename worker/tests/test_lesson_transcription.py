import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from worker.lesson_video import (
 ASR_VERSION, Runtime, chunk_ranges, degenerate, merge_segments, reusable_sections, section_has_teaching,
 thin_stretches, thin_transcript, transcript_chunk_reusable, transcript_density,
 transcript_words, window_candidates, words_between,
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

 def test_a_section_nobody_spoke_in_anywhere_is_skipped(self):
  self.assertFalse(section_has_teaching(chunk(0,1200,['Yeah.'])))
  self.assertFalse(section_has_teaching(chunk(0,1200,[])))

 def test_a_section_that_is_mostly_drilling_is_kept_for_its_talking(self):
  # The two minutes of coaching in the middle of a twenty-minute drill
  # are the whole point of the section. Judged over the section as a
  # whole this reads as silence; judged in rolling windows it does not.
  talk=[{'start_s':600,'end_s':720,'text':'word '*200}]
  self.assertTrue(section_has_teaching({'start_s':0,'end_s':1200,'utterances':talk}))

class TranscriptionTests(unittest.TestCase):
 """One listener, greedy, and no second opinion.

 A second opinion was the obvious way to tell a drill from a stretch
 nobody was heard in, and there is no honest one to be had: the only
 model that hears these rooms reliably cannot say nothing. Given a real
 drill it wrote "Alright, more spin on the serve. Hit the ball. That's
 it," and given digital silence "OK, let's keep your elbow up and follow
 through" — plausible coaching, different every run, none of it said.

 So the two are not told apart. Everything downstream is instead built so
 that not knowing costs coverage and never correctness.
 """
 def rt(self,**attrs):
  rt=Runtime.__new__(Runtime);rt.openai='test';rt.http=Mock();rt.meter_events=Mock()
  for name,value in attrs.items():setattr(rt,name,value)
  return rt

 def test_a_section_is_heard_once_and_taken_as_it_comes(self):
  heard=[{'start_s':0,'end_s':1200,'text':'word '*1200}]
  rt=self.rt(transcribe_whisper=Mock(return_value=heard))
  self.assertEqual(rt.transcribe('a.mp3',0,1200),heard)
  self.assertEqual(rt.transcribe_whisper.call_count,1)

 @patch('worker.lesson_video.time.sleep')
 def test_a_failed_pass_is_retried_and_then_asks_for_a_retry(self,_sleep):
  # An empty section saved here would be read afterwards as silence in
  # the room, and never transcribed again.
  rt=self.rt(transcribe_whisper=Mock(side_effect=RuntimeError('network')))
  with self.assertRaises(RuntimeError):rt.transcribe('a.mp3',0,1200)
  self.assertEqual(rt.transcribe_whisper.call_count,3)

 @patch('worker.lesson_video.time.sleep')
 def test_a_pass_that_succeeds_on_the_second_try_is_kept(self,_sleep):
  heard=[{'start_s':0,'end_s':1200,'text':'word '*1200}]
  rt=self.rt(transcribe_whisper=Mock(side_effect=[RuntimeError('network'),heard]))
  self.assertEqual(rt.transcribe('a.mp3',0,1200),heard)

 def test_whisper_is_greedy_and_metered_by_measured_seconds(self):
  response=Mock();response.headers={'x-request-id':'test'}
  response.json.return_value={'duration':1200,'segments':[{'start':1,'end':3,'text':'Bend your knees.'}]}
  rt=self.rt();rt.http.post.return_value=response
  with tempfile.NamedTemporaryFile() as f:result=rt.transcribe_whisper(f.name,600)
  self.assertEqual(result,[{'start_s':601,'end_s':603,'speaker':None,'text':'Bend your knees.'}])
  sent=rt.http.post.call_args.kwargs['data']
  self.assertEqual(sent['model'],'whisper-1')
  self.assertEqual(sent['temperature'],0)
  self.assertEqual(rt.meter_events.call_args.args[0][0]['quantity'],1200)
  self.assertEqual(rt.meter_events.call_args.args[0][0]['sku'],'whisper-1')

class DegenerateTextTests(unittest.TestCase):
 """A transcriber talking to itself must never reach a chapter.

 Whisper fills non-speech with one token repeated. Measured on a real
 drill it returned "RUPERT STREET" three times; on digital silence, "you"
 ten times. Both identical on repeat runs, both about six to ten words a
 minute, so the density floor catches them as well — but a short piece of
 it inside an otherwise talkative section would slip through, and this is
 what stops that.
 """
 def test_the_two_hallucinations_measured_on_real_audio_are_refused(self):
  self.assertTrue(degenerate('you you you you you you you you you you'))
  self.assertTrue(degenerate('RUPERT STREET RUPERT STREET RUPERT STREET'))

 def test_ordinary_speech_survives(self):
  for text in ["Yeah, I'm trying a new experiment. Yeah.",
               'Stay low through the push and keep your weight forward.',
               'Thank you. Thank you.','Yeah.']:
   self.assertFalse(degenerate(text),text)

 def test_the_same_fragment_repeated_across_segments_is_refused(self):
  # Measured on a real drill: three separate segments each reading
  # "RUPERT STREET". Two words apiece is under the repetition ratio, so
  # only the run of identical segments gives it away.
  out=merge_segments([{'start':0,'end':2,'text':'RUPERT STREET'},
                      {'start':10,'end':12,'text':'RUPERT STREET'},
                      {'start':20,'end':22,'text':'RUPERT STREET'}],0,70)
  self.assertEqual(len(out),1)

 def test_a_hallucinated_piece_never_becomes_an_utterance(self):
  out=merge_segments([{'start':0,'end':30,'text':'you you you you you you you'},
                      {'start':60,'end':70,'text':'Open with a push to the middle.'}],0,1200)
  self.assertEqual([u['text'] for u in out],['Open with a push to the middle.'])

class MergeSegmentsTests(unittest.TestCase):
 def test_adjacent_pieces_join_and_a_real_pause_starts_a_new_utterance(self):
  segments=[{'start':0,'end':2,'text':'Bend your knees.'},{'start':2.5,'end':4,'text':'Stay low.'},
            {'start':40,'end':42,'text':'Again.'}]
  out=merge_segments(segments,600,600)
  self.assertEqual([(u['start_s'],u['end_s'],u['text']) for u in out],
    [(600.0,604.0,'Bend your knees. Stay low.'),(640.0,642.0,'Again.')])

 def test_an_utterance_stops_growing_before_it_swallows_the_section(self):
  # Varied text, because a run of a hundred and twenty identical
  # one-word segments is the hallucination signature and is dropped.
  segments=[{'start':i,'end':i+1,'text':f'word{i}'} for i in range(0,120)]
  out=merge_segments(segments,0,600)
  self.assertTrue(all(u['end_s']-u['start_s']<=45 for u in out))
  self.assertEqual(transcript_words(out),120)

 def test_a_hallucinated_tail_past_the_end_is_dropped_not_fatal(self):
  # Found on the first live run against a real lesson: whisper returned
  # 1,199 good segments and three saying "Yeah." between 1200 and 1203
  # seconds of a 1200-second file. Refusing the section over that would
  # have thrown away twenty minutes of teaching.
  segments=[{'start':10,'end':12,'text':'Stay low.'},
            {'start':1200,'end':1201,'text':'Yeah.'},
            {'start':1201,'end':1202,'text':'Yeah.'}]
  out=merge_segments(segments,0,1200)
  self.assertEqual([(u['start_s'],u['end_s'],u['text']) for u in out],[(10.0,12.0,'Stay low.')])

 def test_speech_running_just_over_the_end_is_kept_and_clamped(self):
  out=merge_segments([{'start':1195,'end':1201.5,'text':'One more.'}],0,1200)
  self.assertEqual(out,[{'start_s':1195.0,'end_s':1200.0,'speaker':None,'text':'One more.'}])

 def test_a_timestamp_far_past_the_end_is_still_refused(self):
  # A tail is a second or two. Ten minutes past the end is a broken
  # response and must not be quietly clamped into looking fine.
  with self.assertRaises(ValueError):
   merge_segments([{'start':10,'end':800,'text':'Bend.'}],0,60)

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

class RollingThinnessTests(unittest.TestCase):
 """Where nobody was heard, read over a rolling window.

 Adil, 2026-09-07: a ten-minute drill, or a group lesson with the coach
 nowhere near the phone, is an ordinary part of a lesson. A rule that
 reads silence as failure is dangerous. Judged over a whole section, a
 lesson that is half drilling and half teaching averages out to something
 that looks fine and is half missing.
 """
 def test_a_quiet_stretch_is_found_and_the_talking_around_it_is_not(self):
  talking=[{'start_s':t,'end_s':t+5,'text':'word '*20} for t in range(0,240,5)]
  talking+=[{'start_s':t,'end_s':t+5,'text':'word '*20} for t in range(600,1200,5)]
  self.assertEqual(thin_stretches(talking,0,1200),[(240.0,600.0)])

 def test_neighbouring_quiet_windows_become_one_question(self):
  # Eight separate asks about a quiet quarter of an hour would cost
  # eight times what one does.
  self.assertEqual(thin_stretches([],0,1200),[(0.0,1200.0)])

 def test_a_section_of_steady_coaching_asks_nothing(self):
  steady=[{'start_s':t,'end_s':t+5,'text':'word '*20} for t in range(0,1200,5)]
  self.assertEqual(thin_stretches(steady,0,1200),[])

 def test_words_are_counted_where_they_were_spoken(self):
  utterances=[{'start_s':0,'end_s':10,'text':'one two three'},{'start_s':100,'end_s':110,'text':'four'}]
  self.assertEqual(words_between(utterances,0,50),3)
  self.assertEqual(words_between(utterances,90,120),1)
  self.assertEqual(words_between(utterances,200,300),0)

class SectionRangeTests(unittest.TestCase):
 def test_a_two_hour_lesson_is_six_sections(self):
  # Twenty minutes at 64 kbps mono is about 9.6 MB, inside whisper's
  # 25 MB limit, and halves the boundaries a teaching moment can
  # straddle against the old ten.
  self.assertEqual(len(chunk_ranges(7200)),6)
  self.assertEqual(len(chunk_ranges(3600)),3)

 def test_a_stub_of_a_final_section_joins_the_one_before_it(self):
  ranges=chunk_ranges(1205)
  self.assertEqual(ranges,[(0,1205)])

class ReuseByRangeTests(unittest.TestCase):
 """A saved section is reused for the time it covers, never for its place in the list.

 Sections went from ten minutes to twenty. Reusing "the third saved
 section" for "the third wanted section" would lay a 1200-second range
 over a 600-second one, keep the leftovers at the end, and hand the
 recap a transcript that both double-counts and skips.
 """
 def test_sections_saved_under_the_old_length_are_not_mistaken_for_new_ones(self):
  old=[chunk(i*600,(i+1)*600,['word ']*600) for i in range(9)]
  kept=reusable_sections(old,chunk_ranges(5400))
  # Five 1200-second ranges wanted. None of the 600-second sections
  # covers the first four, so those are transcribed again. The last one
  # is 4800 to 5400 under either sectioning, and IS reused: matching is
  # by the time covered, and that time is covered.
  self.assertEqual(len(kept),5)
  self.assertEqual([k is None for k in kept],[True,True,True,True,False])
  self.assertIs(kept[4],old[8])

 def test_a_section_saved_under_this_length_is_found_by_its_bounds(self):
  saved=[chunk(1200,2400,['word ']*600)]
  kept=reusable_sections(saved,chunk_ranges(3600))
  self.assertEqual([k is not None for k in kept],[False,True,False])
  self.assertIs(kept[1],saved[0])

 def test_a_fractional_final_bound_still_matches(self):
  ranges=chunk_ranges(5400.033)
  saved=[chunk(a,b,['word ']*600) for a,b in ranges]
  self.assertTrue(all(k is not None for k in reusable_sections(saved,ranges)))

