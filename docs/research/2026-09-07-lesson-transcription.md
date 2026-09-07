# What a lesson recap is built on

A ninety-minute lesson came back as eight chapters of confident advice
nobody had given: "use only the described 'R' element and keep the
amplitude high", "recognize that either one can be preserved". The
sentences were real English about table tennis and none of it had been
said. This is the record of why, and of what the numbers are.

## The transcript, not the prompts

The same file had been imported twice. Nothing in `worker/lesson_video.py`
branches on `student_id` or `coach_ref_id`, so both runs used identical
prompts, models and selection logic. What differed was the speech.

| | Sept 5 | Sept 7 |
| --- | --- | --- |
| Transcript | 44,130 characters | 6,255 |
| Chapters | 12, each 39 to 92 seconds | 8, several under 15 seconds |

Eight of the nine ten-minute sections came back with almost nothing. The
first held eight words.

## Words a minute is the reading

Measured across four real lessons, per ten-minute section:

- **Missed**: 0.5, 0.8, 1.0, 1.7, 2.1, 2.8, 3.6, 6.5
- **Heard**: 25.6, 28.2, 33.1, 42.7, 47.7, 49.5, 50.5, 51.3, 58.7, 59.3,
  93.0, 112.6, 115.3, 115.6, 116.2, 119.4, 124.3, 128.1, 146.9, 149.5

Nothing has ever landed between 6.5 and 25.6. **The floor is 12**, in the
middle of that empty band. A word count cannot do this job: twelve words
is plenty for a twenty-second clip and nothing at all for ten minutes.
Density can tell those apart.

The check that existed asked for three words in a whole ten-minute
section. Eight cleared it.

## Which transcriber hears a table tennis hall

One ten-minute section of the failing lesson, same audio, same
extraction (mono, 16 kHz, 64 kbps mp3):

| Model | Words | Notes |
| --- | --- | --- |
| Deepgram nova-3 + keyterms | 8 | what shipped |
| gpt-4o-transcribe | ~18 per 70 s window | |
| gpt-4o-transcribe-diarize | 102 | the fallback that existed |
| **whisper-1** | **639** | temperature 0 |

Whisper's output matches a known-good transcript of the same audio almost
line for line. The newer transcription models do not error on far-field
audio; they return 200 OK having heard almost none of it.

**Temperature 0 is both the best and the only reproducible setting.** The
same section at the default returned 549 words one time and 631 another;
at zero it returns 639 every time, byte for byte.

A vocabulary prompt carrying the old Deepgram keyterms measured no better
(529 words against 549 with none), so there is none.

## Cost

From `cost_rates`, per audio minute:

| | $/min | Sections kept, across four lessons |
| --- | --- | --- |
| Deepgram nova-3 + nova-3-keyterm | 0.0090 | 0 |
| gpt-4o-transcribe-diarize | 0.0060 | all of one lesson |
| whisper-1 | 0.0060 | |

Deepgram was billed on every second of every lesson, on two SKUs, and the
ledger shows the fallback then running anyway on all five sections of one
lesson and three of nine on the other. A ninety-minute lesson cost up to
$1.35 to transcribe. Whisper-first costs $0.54.

Deepgram keeps its rates and its key: it still transcribes journal voice
notes, and thirty days of lesson history still has to price. Whether it
fails the same silent way on those is not measured, and should be.

## Silence must never become a chapter

The transcript explains why the recap was thin. It does not explain why it
was confident, and that part was worse.

`selection_requirements` made every section that produced a candidate a
**mandatory** coverage requirement for any lesson over 75 minutes. The
eight near-silent sections were therefore not skipped, they were
required. `window_candidates` validated JSON shape, section bounds and
clip length, and nothing anywhere asked whether a clip had speech under
it. `contextualize_edit` then demands one to three non-empty reminders per
chapter, and `normalize_edit` raises if a chapter has none, so with no
speech the pipeline could only invent or fail. It invented.

The only student-facing hedge fired when the whole recap came in under
180 seconds, and `student_warning` strips any sentence containing "limit",
"selection", "model", "budget" or "worker" — so an honest hedge about a
limited selection would have been deleted on the way out.

Now: a section nobody was heard in takes no part at all, a clip needs
speech inside its own range, a recap built on part of a lesson says so,
and a lesson that was mostly inaudible is refused with the reason and
what to do about it. All four are also cheaper: the per-chapter writing
calls stop running on silence.

## Why the same video gave two different answers

Two independent causes, and both were live.

1. **The transcription step was different code.** The good run's
   utterances are 70-second windows with 10-second overlap, speaker null,
   `[unclear]` markers, stamped `asr_version: 3`. Nothing in this
   repository or in any packaged release on disk writes 3; every one
   writes 2. A whisper-1 call on one of those windows reproduces its text
   almost word for word, so the run used Whisper over short windows, from
   a bundle that no longer exists.
2. **Chapter selection had no floor below 75 minutes.** `Adam Hugh
   Lesson.MOV` came out as **6 chapters on Sept 5 and 14 on Sept 7** from
   equivalent transcripts, because `selection_requirements` returns
   nothing at all under `RICH_RECAP_MIN_SECONDS` and the merge model is
   free to return anywhere from one chapter to sixteen. This is not fixed
   here and it should be: a lesson that renders as 6 chapters one day and
   14 the next has dropped teaching on one of those days.

## Not measured

- Whether whisper-1 beats the diarized model on close-miked audio. The
  ladder never asks: the second rung is reached only when the first heard
  almost nothing, so it cannot replace a good answer with a worse one.
- Whether journal voice notes suffer the same silent failure. They use
  Deepgram, they are short and close-miked, and nothing checks density.
- The corpus is four lessons from two recordings, both Adil's, both in
  club halls. That is the audio this product actually gets, but it is two
  rooms, not twenty.
