# Recollect: Topics

Supersedes `2026-07-29-recollect-design.md`. That design shipped, ran on
real lessons, and produced reminders the product owner described as useless
— every one of them. This document explains why the format failed, and
replaces it with a topic-based model.

## What went wrong

The v1 card was a generated question with a one-line answer:

```text
Can I shorten my swing and focus on timing on the next ball after a heavy opener?
  → Shorten the swing and focus on timing (brush the ball).
```

Three faults, none of them fixable by tuning the prompt.

**The question format requires inventing a premise.** A recall question has
to name a situation specific enough that one cue is the answer. Coaching
speech rarely carries that specificity, so the model supplies it. The card
above says "after a heavy opener"; the transcript says `"Next college gonna
bounce weird"`. The invented condition is what reads as fake. Every
question generator over loose coaching advice has this problem, because the
format demands a precision the source does not contain.

**Quizzing a player on their own note is the wrong register.** The player
was in the lesson. A leading question with a fragment answer reads as being
tested on your own experience by someone who was not there.

**One cue per card shreds advice that only means anything as a group.**
"Shorten the swing" alone is noise. "Shorten the swing, bring the arm in,
keep the racket high, let the wrist brush" is a backhand.

A second attempt (`recollect-v3`, migration 059) tightened the gate: the
validator reads the source words behind each cue, questions that give away
their answer are rejected, importance is calibrated. It measurably improved
the output and the output was still not wanted. That is the format's
ceiling, not the prompt's.

### The redundancy nobody noticed

`lessons.takeaways` already holds `{ title, themes: [{ name, points[] }] }`
— topic to bullets — produced by `/api/lesson` when the entry is saved,
from the same transcript, under a distillation contract that forbids
inventing advice. On the product owner's account that is 13 themes and 43
points, and those points are good:

```text
Backhand              Close the racket face more and brush up the back of
                      the ball, do not scoop under it.
Serve & receive       Do not drop your shoulder before contact on short
                      serves because that telegraphs the short side.
Footwork & positioning Step out one small step when the ball is slightly
                      too far to bring it into your comfortable range.
```

Recollect ignored this and re-derived its own worse version from the raw
speech-to-text. The whole extraction half of the feature is redundant work
against a cleaner source that already exists.

## Goal

Recollect brings a player's own coaching content back over time, organised
the way a player thinks about their game, without inventing anything and
without quizzing them.

## Product principles

Carried forward from v1, still binding:

1. **Useful or absent.** Showing nothing is a valid outcome. Never
   manufacture content to fill a slot.
2. **No user configuration.** Enabled by default, one global on/off switch
   in Account.
3. **Recall without homework.** No typed answers, ratings, scores, or
   streaks.
4. **Faithful to the source.** Everything shown is traceable to a specific
   journal entry and links back to it.
5. **Minimal derived storage.** Store only what is needed to display,
   order, and trace.
6. **No unnecessary recurring model work.** Generation happens when source
   material changes.
7. **The product UI never describes Recollect as AI.**

New, and specific to this design:

8. **Never re-derive what the journal already distilled.** Recollect reads
   `takeaways`, not transcripts. It cannot produce garbled output because
   it never touches the raw speech-to-text.
9. **The tab is never empty.** A player with any distilled entry always has
   something to open. There is no "nothing due today".

## Evidence

- Formats that require **generating** an answer beat formats that require
  **selecting** one. A topic cue qualifies; nothing is lost by dropping the
  question.
- **Targeted short-answer retrieval strengthens mainly the one fact
  retrieved, while free recall strengthens more of the surrounding
  material.** A topic name prompting recall of a cluster is a stronger
  format for this content than a question with a single fragment answer.
- Motor-learning and coaching work consistently favours **less feedback per
  session**: cutting the volume improves retention and transfer, because
  working memory is the binding constraint. This sets the reveal size.
- Spacing improves long-term retention; the interval should grow with the
  intended retention period. A least-recently-reviewed queue over roughly
  eight topics produces this spacing without an explicit schedule.

References:

- [Why is free recall practice more effective than recognition practice](https://www.sciencedirect.com/science/article/abs/pii/S0749596X19300026)
- [It matters how to recall: task differences in retrieval practice](https://link.springer.com/article/10.1007/s11251-020-09526-1)
- [Retrieval-Based Learning: A Decade of Progress](https://files.eric.ed.gov/fulltext/ED599273.pdf)
- [The Role of Augmented Feedback on Motor Skill Learning](https://www.atlantis-press.com/article/25867380.pdf)
- [Coaching Strategies to Maximize Long-Term Learning and Performance](https://sirc.ca/articles/learning-performance-distinction/)
- [Spacing Effects in Learning](https://pubmed.ncbi.nlm.nih.gov/19076480/)

## 1. The model

A **topic** is a fixed area of the game. A **point** is one short piece of
coaching, copied verbatim from a journal entry's takeaways and attached to
a topic. A topic accumulates points from every entry that touched it.

Recollect shows topics. Opening one reveals a bounded window of its points.

### The taxonomy

Topics are a closed list. The model assigns; it never invents.

```text
serve                  Serve
receive                Receive
forehand               Forehand
backhand               Backhand
footwork               Footwork & positioning
stance                 Stance & balance
transitions            Transitions
tactics                Point construction
practice               Drills & practice
mental                 Mental & routine
```

A closed list is the design's load-bearing decision. Free-form topic names
drift and never aggregate — the live data already shows "Footwork &
positioning", "Footwork & weight transfer" and "Stance & balance" as three
names for overlapping ground, and "Drills & practice focus" beside "Timing,
drills & practice focus". Mapping the owner's 13 theme names onto this list
yields roughly 7 real topics. Fixed keys also make deduplication exact
rather than fuzzy, and give the tab a stable shelf that does not reshuffle
as entries arrive.

A theme that fits nothing is dropped. Producing no point is a valid result.

## 2. Journal experience

Navigation is unchanged:

```text
All · Matches · Lessons · Practice · Recollect
```

Journal chrome — search, tag rail, Working On, New — stays on the Recollect
section as on every other section. Recollect is a section of the journal,
not a separate page.

### The topic list

Topics the player has any points for, least recently reviewed first. Each
row carries the topic name, how many points it holds, and where they came
from.

```text
Backhand
11 points from 3 lessons · last opened Jul 20
```

The list is the queue. There is no due date and no empty state to design
around: a player with distilled entries always has topics, and the one at
the top is always the one they have gone longest without seeing.

### Opening a topic

Tapping the row reveals its points. Each point shows its text and links to
the entry it came from.

```text
Backhand

  Shorten the backhand swing when you're close to the table
    Compact backhand timing · Jul 27

  Keep the racket up high and use the racket edge/hand higher as the
  main contact area
    Compact backhand timing · Jul 27

  Keep the backhand paddle in front of your belly button
    Forehand and Backhand Transition · Jul 20

  Close the racket face more and brush up the back of the ball
    Backhand opener and footwork · Aug 02
```

Opening is the review. It stamps the topic's `last_reviewed_at`, which
drops it to the bottom of the queue, and stamps `last_shown_at` on each
point revealed. Opening the same topic repeatedly in one view must not
re-stamp — the same idempotency rule v1 applied to reveals.

Per point: `+ Working On` and `Not useful`. Attaching a point to Working On
is the natural granularity — a point already is a cue, so nothing needs
rewriting to become a focus point.

### The reveal window

A topic reveals at most **five** points, chosen least-recently-shown first,
newest first on ties.

This is where the evidence on feedback volume binds. Backhand holding
eleven points does not become an eleven-item wall; it becomes three passes
that cycle. Splitting an overflowing topic into "Backhand 2" was
considered and rejected: it needs splitting and naming logic, it degrades
the topic name, and it hides old material instead of rotating it back.
Windowing achieves the intended outcome with no extra machinery.

### Empty and processing states

While a newly saved entry is being sorted into topics, the tab says so
briefly. A player with no distilled entries yet gets one short line, not a
paragraph.

## 3. Generation

Triggered when an eligible entry is saved or changed, exactly as v1 was.

**Input is the entry's takeaways, not its transcript.** For a lesson with
`takeaways`, the model receives the theme names and their points. For a
short entry stored without takeaways — practice notes are typically under
`MIN_DISTILL_CHARS` (600) and read fine as written — the model receives the
note body, which is short enough to read whole.

**One model call per entry.** Its only job:

- assign each incoming point to one topic key from the closed list, or drop
  it;
- for a short raw note, split it into its constituent points first;
- flag a point as a duplicate of an existing point in that topic when it
  says the same thing.

Point text is **copied, not rewritten**, when it comes from takeaways. The
distillation contract already produced short, second-person, actionable
sentences from content actually said. Re-phrasing them is another chance to
drift.

Deterministic validation still applies: topic keys must be in the list,
point text must be non-empty and within length limits, the source entry
must belong to the caller, and a duplicate must name a point that exists in
the same user's topic.

### What this deletes

Segmentation, transcript extraction, the separate validation pass, evidence
capture and hashing, question-form checks, importance scoring, the multi
request drain, and the per-segment job buffer. Cost per entry drops from
roughly six provider calls over noisy audio to one small call over clean
text. The 50s-timeout and route-budget problems disappear with the calls
that caused them.

## 4. Ordering

```text
Topic order:   last_reviewed_at ascending, nulls first
Point order:   last_shown_at ascending, nulls first, then created_at desc
```

No intervals, no due dates, no schedule steps. With roughly eight to ten
topics, opening one per visit spaces each topic eight to ten visits apart
on its own.

A topic paused by Working On is not hidden — the points inside it are what
the player is actively drilling, and seeing them is the point. A point
dismissed as `Not useful` is never shown again and does not count toward
the topic's total.

## 5. Data model

Names may adapt to repository convention. The durable concepts:

### `recollect_preferences`

Unchanged from v1. Absent row means enabled.

### `recollect_topics`

One row per user per topic key that has at least one point.

- user id, topic key (from the closed list)
- last reviewed at, review count
- last review key, for reveal idempotency

### `recollect_points`

- id, user id, topic id
- text, copied from the source
- source entry id, and the theme name it arrived under
- state: active or dismissed
- last shown at, created at
- optional focus point id, when added to Working On

### `recollect_jobs`

Retained but simplified: one job per entry, no segment cursor, no candidate
buffer. Idempotent by entry id and content hash, bounded retries, concise
error state.

`recollect_items` and `recollect_item_sources` are dropped.

All tables keep row-level security restricting reads to the owner. Writes
stay service-role only, through owner-verifying routes, as in v1.

## 6. Migration

1. Drop every `recollect_items` and `recollect_item_sources` row. The
   product owner has confirmed none are worth keeping.
2. **`lessons` is not touched.** The original notes and their takeaways are
   the thing the player values and the thing this design depends on.
3. Create the new tables, enqueue every existing eligible entry, and let
   the normal event-driven path fill topics.
4. Rebuilding from takeaways is cheap: one small call per entry over text
   that is already distilled.

## 7. Failure and concurrency

Unchanged in spirit from v1:

- Journal save never depends on Recollect generation.
- Jobs are idempotent by entry id, content hash, and processor version.
- Concurrent claimants cannot process one job twice.
- Provider failures retry with bounded backoff and never store placeholder
  content.
- Turning Recollect off wins over in-flight work; completion rechecks the
  preference before storing.
- Deleting an entry removes its points; a topic with no remaining points
  disappears from the list.
- Opening a topic updates ordering idempotently.

## 8. Cost

One operation label, `recollect_topics`, metered through the shared OpenAI
usage meter with an idempotency key derived from the response id. The v1
labels `recollect_extraction` and `recollect_validation` are retired; the
admin cost dashboard's feature breakdown follows.

Metering stays fail-open: a ledger outage is logged and never discards a
result.

## 9. Legal

The Privacy Policy and Terms already disclose OpenAI processing of journal
content for summaries, coaching cues, and private reminders. This design
narrows what is sent rather than widening it — takeaways instead of full
transcripts. Confirm the wording still reads accurately; no new provider or
category of data is introduced.

## 10. Testing

- Theme-to-topic mapping stays inside the closed list, and an unmappable
  theme yields no point.
- Point text from takeaways is copied verbatim.
- A short entry with no takeaways is split into points.
- Duplicate points raise nothing and create nothing.
- Reveal window returns at most five, least recently shown first.
- Opening stamps the topic once per view; repeats do not reorder twice.
- Topic ordering is least recently reviewed first.
- Dismissed points never reappear and do not count toward the total.
- Working On attachment is deduplicated per point.
- Deleting a source removes its points and empty topics.
- Disabling removes derived data and preserves journal entries.
- RLS ownership isolation.
- Cost events carry the new label and no identifying metadata.
- Journal chrome stays present on the Recollect section.

Provider-facing tests use fixtures, never live calls.

## Out of scope

- Generated questions of any kind.
- Typed answers, ratings, scores, streaks, gamification.
- Notifications.
- Per-entry Recollect controls.
- Match-note generation.
- Player-editable topic lists or intervals.
- Splitting an overflowing topic into numbered siblings.
- Embeddings or vector search.

## Open questions

1. **The taxonomy is the player's call.** Should "Point construction" be
   "Tactics"? Do serve and receive belong as one topic? Changing the list
   is cheap now and expensive once the data exists.
2. **Reveal window of five** is drawn from the feedback-volume evidence and
   the owner's own estimate of five or six. Worth confirming against a real
   topic once one is populated.
3. **Short practice notes** are handled by sending the raw body. The
   alternative is lowering `MIN_DISTILL_CHARS` so everything gets
   takeaways, which is a change to the journal rather than to Recollect.
4. **Should a point retire when its Working On focus point is completed?**
   v1 paused and resumed after seven days. Doing nothing is also defensible
   — a completed focus point is exactly the thing worth seeing again later.

## Success criteria

1. A saved lesson produces topics whose points are recognisably the coach's
   own words, with no invented conditions.
2. A player opening Recollect always has a topic to open, and the top one
   is the one they have gone longest without.
3. A topic holding more than five points reveals a rotating window rather
   than a wall.
4. Points aggregate across lessons under a stable topic name.
5. No question, anywhere.
6. Generation costs one provider call per saved entry.
7. Disabling removes derived data and leaves the journal untouched.
