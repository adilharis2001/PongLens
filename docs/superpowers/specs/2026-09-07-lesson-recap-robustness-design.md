# A lesson recap you can trust: design

Adil, 2026-09-07: "assume every lesson that is gonna be uploaded... some of
them might be a thirty minute lesson. Majority, like sixty percent, are
gonna be sixty minute lessons. About thirty percent ninety minutes, and a
few two hours." And: a ten-minute stretch with no talking is a normal part
of a lesson — a drill, or a group session where the coach is nowhere near
the phone — so a rule that reads silence as failure is dangerous.

He is right. This replaces the check shipped earlier today.

---

## 1. The one question everything turns on

**Did nobody speak, or did we fail to hear them?**

Those two produce identical evidence downstream — few words — and they
need opposite responses. Nobody spoke is normal and should pass without
comment. Failing to hear is a fault, and the player is owed both an
honest recap and a reason.

Every defect in this pipeline traces to not asking that question:

- The alarm was "fewer than three words in ten minutes", which only fires
  on total failure and calls a quiet drill broken.
- The check shipped this morning replaced it with twelve words a minute,
  which is better at catching failure and **has exactly the same fault**:
  a ten-minute drill measures the same as a lost ten minutes.
- Because neither could tell the difference, neither could report
  honestly, and the pipeline instead required a chapter from every
  section of a long lesson — including the ones nobody had spoken in.

## 2. What the measurements say

All on real lessons, all reproducible from
`docs/research/2026-09-07-lesson-transcription.md`.

**Transcribers, over 90 windows of one 90-minute lesson:**

| Model | Words | Per minute | Windows under 10 words |
| --- | --- | --- | --- |
| gpt-4o-transcribe | 2,849 | 27.2 | 26 of 90 |
| whisper-1 | 6,346 | 60.6 | 5 |
| gpt-audio | 6,257 | 59.7 | **0** |

**Voice activity detection does not work on this audio.** Silero VAD,
the standard tool for exactly this question, was run over the same 90
windows. On the densest window — 197 words of clear conversation,
confirmed by re-transcribing the decoded file — it never exceeded 0.003
out of 1.0, and an empty window scored higher. Amplifying sixteen times
did not move it. Ball impacts, other tables and hall reverb bury
far-field speech below what a small VAD can separate.

**This closes the obvious door.** There is no cheap local signal for "was
anyone talking". The only things that can hear these rooms are the large
models, and that shapes the whole design.

## 3. What was built, and why it is not what section 3 first said

This section originally proposed a second listener as the discriminator,
bought only for stretches the first one came back empty on. It was built,
tested against real audio, and **abandoned on the evidence**. The record
is kept because the reasoning is the useful part.

`gpt-audio` was chosen because it was the only model that never returned
an empty window across 90 windows of a real lesson. Run against a stretch
of a real drill it wrote:

> "Alright, more spin on the serve. Hit the ball. That's it. Make sure
> you follow through. Good. There we go."

and against 300 seconds of pure digital silence:

> "OK, let's keep your elbow up and follow through. Good, now angle your
> wrist a bit more. There you go."

Different every run, in both cases. **It cannot say nothing.** Its perfect
record of never returning empty was never good hearing; it was an
inability to be silent, and the measurement that made it look best is the
one that disqualifies it. A model that invents coaching is the exact
failure this whole design exists to prevent, and putting it in the ladder
would have made a drill produce a chapter.

Whisper hallucinates on non-speech too, and harmlessly differently: on
the same real drill it returned "RUPERT STREET" three times, and on
silence "you" ten times, identically on repeat runs. Degenerate
repetition at six to ten words a minute — under the floor, and caught by
a repetition check besides.

**So the two cases are not told apart at all.** Nothing available can do
it honestly. What is done instead is make not knowing safe:

- A stretch nobody was heard in contributes no clips and no coverage
  requirement — exactly as a drill should.
- A clip must have speech inside its own range.
- Nothing is ever said to the player about a quiet stretch, because a
  warning that fires on drilling teaches them to distrust a recap that is
  in fact complete.
- A lesson is refused only when it yields nothing at all.

The cost of not knowing is bounded and one-directional: a stretch that
really was missed is silently dropped rather than recovered. That costs
coverage on hard audio and can never cost correctness, which is the trade
Adil asked for.

### The original proposal, kept for the record

**A second opinion is the discriminator, and it is bought only where it
is needed.**

One transcriber returning little is ambiguous. Two independent
transcribers, both of which have been shown to hear these rooms, are not:

| whisper | second opinion | verdict | what happens |
| --- | --- | --- | --- |
| words | not asked | `heard` | ordinary path, one call |
| few | few | `quiet` | nothing was said; excluded silently, no warning, not a fault |
| few | words | `heard` | whisper failed; the second opinion's text is used |
| few | refused/error | `unknown` | treated as `quiet`, logged, never reported to the player |

`quiet` and `unintelligible` stop being the same thing. Only a stretch
where **both** models found speech-shaped nothing while the lesson around
it was audible is worth a word to the player, and even then the message
is about microphone placement, never about the coach.

This is not a new idea in this codebase. It is the broadcast gate's rule:
two signals whose blind spots differ, and neither one widened alone.

## 4. Design

### Stage A — Transcribe

Sections exist because `whisper-1` takes at most 25 MB, which at the
worker's 64 kbps mono is about 52 minutes. **Sections are an
implementation detail of that limit and of nothing else.** No rule about
quality, coverage or reporting may be phrased in terms of a section.

Section length moves from 10 minutes to **20 minutes**, which halves the
number of boundaries a teaching moment can straddle and keeps a two-hour
lesson at six sections. Every section keeps a 30-second overlap with the
next so a sentence cut in half is transcribed whole at least once; the
overlap is de-duplicated on the way out.

`whisper-1`, temperature 0. Measured the best single transcriber on this
audio and the only reproducible one: the same section returned 549 and
631 words at the default temperature, and 639 both times at zero.

### Stage B — Decide what kind of thin a thin stretch is

Thinness is measured on a **rolling two-minute window**, not per section,
so a lesson that is half drilling and half teaching is not averaged into
one verdict. Below **12 words a minute** a window is a candidate for a
second opinion. That number sits in the middle of an empty measured band:
failures ran 0.5 to 6.5, successes 25.6 to 149.5.

Contiguous candidate windows merge into a **stretch**, and the second
opinion is bought per stretch, in 60-second pieces, from `gpt-audio` —
the only model measured that never returned nothing on any window. Its
answer carries no timings, so a piece's own bounds become the utterance's
bounds. Coarse, honest, and only ever applied to a stretch that had
nothing usable in it anyway.

The stretch is then `heard`, `quiet`, or `unknown` by the table above.

### Stage C — Build only from what was heard

- `quiet` and `unknown` stretches contribute no clip candidates.
- A proposed clip must have speech inside its own range. Already shipped.
- **Coverage is measured against the outline, never against the clock.**
  The outline is built from the whole transcript and lists every distinct
  thing taught. The recap must draw a chapter from every outline theme it
  can fit, in outline order, before it may use a second chapter on any
  theme. This replaces `RICH_RECAP_MIN_SECONDS` entirely.

  This is the fix for the same lesson rendering as 6 chapters one day and
  14 the next. That happened because below 75 minutes there was no
  coverage rule at all, which is **60% of the lessons Adil expects**. A
  rule keyed to what was taught works the same for 30 minutes and for two
  hours and needs no thresholds.
- The written notes keep the complete outline regardless of what the
  video has room for. They already do; this makes it a stated guarantee
  rather than an accident.

### Stage D — Say the true thing

- Nothing is said about `quiet`. Silence during a drill is not news.
- A lesson with `unknown` stretches beside plenty of `heard` ones says
  nothing either: the recap is built from what was audible and it is
  complete on its own terms.
- Only when `unknown` stretches dominate does the player hear about it,
  and then the message is about where the phone was, with the original
  kept and a retry offered.
- A lesson where nothing at all was heard is refused with that same
  message rather than rendered.

### Stage E — Repair is possible

A stretch is re-transcribed on retry unless the current ladder produced
it. The ladder carries a version; raising it re-hears everything thin and
leaves everything good alone. Shipped this morning, kept.

## 5. Recap length should follow the lesson

Today `MAX_RECAP_SECONDS` is 900 and `MAX_CHAPTERS` is 16 for every
lesson. Against Adil's distribution that means a 30-minute lesson may
return a recap half as long as the lesson itself, and a two-hour lesson
gets the same ceiling as a one-hour one.

Proposed: the recap is capped at the lesser of 15 minutes and **a quarter
of the audible lesson**, with chapters capped at 16 throughout. A
30-minute lesson with 20 audible minutes gets at most 5 minutes; a
two-hour lesson still gets 15. The written notes are never capped.

## 6. Cost, against the expected mix

Per audio minute, from `cost_rates`: `whisper-1` $0.0060, Deepgram
$0.0090 (both SKUs), `gpt-4o-transcribe-diarize` $0.0060.

| Lesson | Share | Transcription, ordinary | Today, worst case |
| --- | --- | --- | --- |
| 30 min | some | $0.18 | $0.45 |
| 60 min | 60% | $0.36 | $0.90 |
| 90 min | 30% | $0.54 | $1.35 |
| 120 min | a few | $0.72 | $1.80 |

The second opinion is bought only for stretches under 12 words a minute.
On the measured lesson whisper cleared the floor on 85 of 90 windows, so
the ordinary case is a single pass. A lesson that is largely drilling
buys more, and that is the case where the answer matters most.

**`gpt-audio` has no rows in `cost_rates` and must get them before this
ships.** From the ledger it consumed about 12 input tokens per second of
audio and 125 output tokens per 60-second piece. Choosing it on a guessed
price is not a decision worth making, and the rate rows are a
prerequisite, not a footnote.

Removing Deepgram from this path, already shipped, saves $0.0090 a minute
on every lesson. Against the mix above that alone roughly pays for the
whole ladder.

## 7. What this deliberately does not do

- **No local voice detection.** Measured and rejected; see §2.
- **No reconciliation of three models on every lesson.** The hand repair
  did that and it cost three transcription passes plus an adjudicating
  model for one lesson. It also kept FEWER words than whisper alone
  (4,200 against 6,346) because it discarded anything two models did not
  agree on. That is the right trade for a rescue and the wrong one for
  every lesson.
- **No change to the burned-in panels.** Editing text still re-renders
  the video; the recap keeps playing while it does.
- **No attempt to separate a coach's voice from other tables.** Worth
  knowing about, not worth blocking this on.

## 8. Answered

1. **Refusal.** Adil: refuse when it is really bad. Done — a lesson that
   yields nothing is refused with the likely reason and the original
   kept. A lesson that yields something is built from what it yields and
   says nothing about the rest.
2. **Recap length.** Adil: "the focus should be on completeness of the
   key parts taught in the lesson. It shouldn't be concise or too long
   for the sake of it." So no proportional cap. Coverage is measured
   against the outline and the recap is as long as the teaching earns,
   inside the existing 16-chapter and 15-minute safety limits.
3. **The second opinion's price.** Moot: there is no second opinion. The
   rate rows for `gpt-audio` were added and are harmless if it is ever
   used for something it is honest at.

## 9. Repetition (8 Sep 2026)

The first real coach upload (Anton, Eran Dinur) came back complete and
the coach read the same sentence twice: once under two note headings,
once beside two neighbouring clips. The notes are written in one pass
over every section, and each chapter's reminders are written on their
own with no view of the others, so a point taught twice in the lesson
came back twice.

Three changes, none of which asks for less:

- The outline stage is told each point appears once in the whole
  outline, under the heading where the fuller sentence sits; a second
  sentence stays only when its condition or exception differs.
- The chapter stage is shown `earlier_chapter_cues`, the reminders already
  written for earlier chapters, and told not to restate them. It writes
  one to three reminders, three when the speech supports three distinct
  points, and never a third made by rephrasing the first.
- `tighten_edit` runs last and drops a sentence that is, as a word
  sequence, at least 70% the same as one already kept (`REPEAT_THRESHOLD`,
  measured on that recap: the repeats scored 0.73 to 0.77, the closest
  pair of different instructions 0.43). It keeps the first wording, never
  rewrites, never empties a chapter, and removes a heading left with no
  points.

Adil's rule, 8 Sep: tighter where it repeats, and nothing else. Coverage
and length rules are unchanged.
