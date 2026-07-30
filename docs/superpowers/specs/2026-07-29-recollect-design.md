# Recollect Design

## Goal

Add a quiet Journal feature that helps players remember useful coaching and
practice guidance over time.

Recollect should require no setup, no written answers, and no knowledge of
spaced repetition. It should periodically surface a small number of valuable
prompts derived from the player's own notes, let the player mentally recall
the answer, and reveal the original coaching cue on tap.

The product UI must not describe Recollect as AI. The Privacy Policy and Terms
must still explain the automated processing and external providers accurately.

## Product principles

1. **Useful or absent.** Producing no reminder is a successful result. Recollect
   must never create filler to reach a display quota.
2. **No user configuration.** Recollect is enabled by default and works from
   eligible Journal entries automatically. The only setting is a global on/off
   toggle.
3. **Recall without homework.** The player thinks of the answer and taps to
   reveal it. There are no typed answers, ratings, scores, or streaks.
4. **Small daily dose.** Recollect shows at most three due reminders at once.
5. **Faithful to the source.** Every reminder is grounded in and linked to a
   specific lesson or practice entry.
6. **Lessons first.** Paid coaching lessons receive more weight than personal
   practice notes, without excluding useful practice guidance.
7. **Minimal derived storage.** Store only what is required to display,
   schedule, deduplicate, and trace accepted reminders.
8. **No unnecessary recurring model work.** Generation happens when source
   material changes, not by rereading every user's Journal on a schedule.

## Evidence informing the design

The design uses a small number of prompts, delayed retrieval, and spaced
reappearance because:

- athletes in one multi-session soccer study retained an average of 57% of
  coaches' feedback, and larger quantities of ideas were associated with poorer
  retention;
- retrieval practice improves long-term retention compared with repeated
  reading, with feedback strengthening the effect;
- spaced review improves long-term retention, while the appropriate interval
  grows with the intended retention period;
- coaches describe limiting feedback to roughly two or three pieces to avoid
  overloading athletes;
- motor-learning research generally favors concise outcome- or
  environment-oriented cues over detailed internal body instructions.

References:

- [Memory and Learning in Sport: Feedback Retention](https://pmc.ncbi.nlm.nih.gov/articles/PMC5260567/)
- [Retrieval Practice Produces More Learning than Elaborative Studying](https://pubmed.ncbi.nlm.nih.gov/21252317/)
- [Retrieval Practice With Feedback](https://pubmed.ncbi.nlm.nih.gov/20951630/)
- [Spacing Effects in Learning](https://pubmed.ncbi.nlm.nih.gov/19076480/)
- [External and Internal Focus in Motor Learning](https://pubmed.ncbi.nlm.nih.gov/34843301/)
- [Coaches' Use of Feedback](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.571552/full)

The proposed intervals are a pragmatic starting point, not a claim that one
exact schedule is universally optimal.

## 1. Journal experience

When Recollect is enabled, Journal navigation becomes:

```text
All · Matches · Lessons · Practice · Recollect
```

The Recollect tab displays up to three due cards. It may show fewer than three,
including none, when the system has no sufficiently valuable material.

The preferred daily mix is two lesson reminders and one practice reminder.
This is a ranking preference rather than a quota. Practice content does not
displace stronger lesson content merely to satisfy the ratio, and weak content
is never shown to fill a slot.

### Card front

The front contains:

- a short mental-recall prompt;
- the source type and date;
- an optional compact topic;
- a `Tap to reveal` affordance.

Example:

```text
Lesson · July 18 · Serve return

What should you remember when receiving a short serve?

Tap to reveal
```

### Card reveal

Tapping anywhere on the card reveals:

- the concise, faithful coaching cue;
- a link to the source Journal entry;
- a compact `+ Working On` action;
- an overflow action named `Not useful`.

Example:

```text
Keep the racket high and meet the ball early over the table.

From your lesson with Coach Sam                 + Working On
```

Revealing the card counts as the review. The revealed card remains visible for
the current view, while its next due date is moved forward. Repeated taps in
the same view must not advance the schedule more than once.

`Not useful` permanently dismisses the reminder and prevents an equivalent
candidate from being recreated from unchanged source content.

### Empty and processing states

When initial generation is still running, Recollect explains briefly that it
is finding useful points from the player's lessons and practice notes.

When nothing is due, the tab uses a calm empty state rather than manufacturing
content. When a processed entry contains nothing worth recalling, no message
or warning is shown for that entry.

### Mobile behavior

The Journal tabs remain horizontally scrollable, with Recollect visibly active
after selection. Cards use a single column and compact source metadata. The
revealed cue and its primary action remain readable without horizontal
compression; the mobile button may say `+ Add` where the desktop button says
`+ Working On`.

The approved visual direction is captured in the brainstorming companion
artifact under `.superpowers/`, which is intentionally excluded from Git.

## 2. Setting and disclosure

Recollect is enabled by default.

Account settings will contain one preference:

```text
Recollect
Surface useful reminders from my lesson and practice notes.       On
```

No entry-level opt-in control is added.

The first relevant Journal visit shows one quiet notice:

```text
Recollect is on. It turns your lesson and practice notes into
private reminders. Manage this in Account.
```

Acknowledging the notice must not become a prerequisite for using Journal.

Turning Recollect off:

1. hides the Recollect tab;
2. stops new Recollect processing;
3. removes generated reminders, source-processing records, and scheduling
   state;
4. leaves the original Journal entries untouched.

Turning it back on processes future entries normally. It does not silently
restore deleted derived data. Historical regeneration may begin from an
explicit Recollect visit, using the same bounded, event-driven mechanism.

## 3. Eligibility and quality gate

Recollect v1 considers `lesson` and `practice` entries. Match entries are not
included.

Useful candidate categories include:

- technique and concise execution cues;
- tactics and situation-based decisions;
- positioning, recovery, and footwork;
- serve and receive patterns;
- recurring mistakes and their corrections;
- specific practice drills or constraints;
- mental routines that affect play.

The following should normally produce no candidate:

- incidental facts such as paddle color;
- scheduling, payment, travel, or administrative details;
- generic praise or social conversation;
- observations with no actionable lesson;
- vague restatements such as "play better";
- advice inferred by the model but not supported by the source.

### Conservative extraction

The extraction contract explicitly allows an empty candidate array. For every
candidate, the model must return:

- a short question;
- a short answer or cue;
- a normalized topic key;
- a supported category;
- a verbatim evidence fragment from the current source segment;
- a proposed importance value.

Evidence is used transiently for validation. The server verifies that the
fragment exists in the supplied source segment before a candidate can proceed.
The evidence text does not need to be duplicated in durable Recollect storage;
the stored source reference remains the audit path.

Candidates that pass extraction receive a small consolidation and validation
pass. This pass sees only the proposed candidates and their evidence, not the
whole transcript. It must reject candidates that are not specific, useful,
faithful, or meaningfully recallable.

Deterministic validation must also enforce:

- schema and length limits;
- a valid source owned by the current user;
- supported categories;
- source evidence presence;
- non-empty prompt and cue;
- no unsupported external facts.

No rejected candidate is stored. A completed extraction with zero accepted
candidates is recorded as successful so the unchanged source is not retried
indefinitely.

## 4. Context management

Recollect never sends the complete Journal or multiple full lessons in one
request.

For a normal entry, the current entry is processed independently. Long
transcripts are divided at sensible transcript or paragraph boundaries into
bounded, slightly overlapping segments. Each segment may yield zero or a few
candidates.

A final consolidation pass receives only short candidates and evidence
fragments. It removes repetition within the entry before accepted reminders
are stored.

Cross-entry deduplication compares compact normalized topics and cue text. It
does not reload the original corpus into the model. A future semantic index may
improve matching if the corpus grows, but embeddings are not required for v1.

This structure avoids dependence on one provider's maximum context window,
handles very long transcripts, and makes processing cost proportional to newly
saved material rather than total account history.

## 5. Generation lifecycle

Generation is event-driven:

1. Saving a new lesson or practice entry durably enqueues Recollect processing
   when the feature is enabled.
2. The Journal save completes without waiting for generation.
3. A background claimant processes the source in bounded segments.
4. Accepted candidates are consolidated and deduplicated.
5. Newly created reminders first become due approximately 24 hours after the
   source is saved.

A durable database job is preferred over an untracked fire-and-forget request.
Failed jobs use bounded retries and retain a concise error state for operations.
A lightweight scheduled claimant may recover abandoned or failed work, but it
must not rerun model generation across all users or all notes.

Inactive users therefore create no recurring model expense. Opening the
Recollect tab normally performs only a database query for due reminders.

Changing an eligible source invalidates its previous processing state. The new
content hash is reprocessed, and reminders no longer supported by the source
are removed or replaced. Deleting a source cascades to its Recollect
provenance; an item supported by another source can remain.

## 6. Initial rollout

There is no general backfill of existing fake or test users.

The only historical sources selected for initial generation are the product
owner's two coaching lessons with Jonathan. They will be enqueued explicitly
and made due immediately so the experience can be tested with real material.
All other existing Journal history is ignored.

After release, newly saved eligible entries follow the normal event-driven
path and first become due approximately one day later.

The two Jonathan lessons must be identified by authenticated ownership and
their actual database records before any mutation. Names alone are not a safe
write target.

## 7. Deduplication and priority

Within one source, consolidation merges substantially equivalent candidates.
Across sources, a normalized topic key and conservative text similarity check
identify likely repetitions.

Repeated guidance does not create multiple cards. Instead, it:

- adds another source association;
- increments source frequency;
- raises the reminder's selection priority;
- preserves the clearest faithful wording.

Ambiguous matches remain separate. It is preferable to show two legitimately
different cues than to merge advice that has different conditions or
techniques.

Due-card selection considers:

1. whether the reminder is currently due;
2. lesson priority over practice;
3. repeated-source importance;
4. how overdue it is;
5. topic diversity within the three-card set;
6. whether it is paused by Working On.

Selection must return fewer than three cards rather than relaxing the quality
gate.

## 8. Recall schedule

The initial schedule is:

```text
First appearance: about 1 day after the source
After first reveal: 3 days
Then: 7 days
Then: 14 days
Then: 30 days
Then: 60 days
Later reveals: every 60 days
```

The two explicitly backfilled Jonathan lessons are due immediately.

The schedule advances on reveal, not merely on opening the tab. If a due card
is ignored, it remains due without creating additional copies or notifications.

V1 does not include push, email, or in-app reminder notifications. Recollect is
available when the player chooses to visit Journal.

## 9. Working On integration

Selecting `+ Working On`:

1. adds the revealed cue through the existing Working On creation path;
2. records the relationship between the Recollect item and focus point;
3. immediately changes the action to an `Added` state;
4. pauses the Recollect item while that focus point is active.

When the focus point is completed or removed, the Recollect item returns to its
normal schedule after a short delay rather than reappearing immediately. Seven
days after completion is the initial default.

Adding the same reminder repeatedly must not create duplicate active focus
points.

## 10. Data model

Exact names may adapt to repository conventions, but the durable concepts are:

### Recollect preference

A private user-scoped preference stores whether Recollect is enabled. Absence
of an explicit preference means enabled, which preserves the default-on
behavior for new accounts. An explicit disabled record remains after derived
data deletion so the application remembers the opt-out.

### Source processing state

One user-owned record per eligible Journal source stores:

- source identifier;
- content hash;
- processing status;
- processor/prompt version;
- accepted candidate count;
- attempt count and bounded error metadata;
- processed timestamp.

It does not duplicate the raw note or transcript.

### Recollect item

Each accepted user-owned reminder stores:

- question and cue;
- normalized topic and category;
- priority and source frequency;
- lifecycle state, including dismissed;
- schedule step and next due time;
- last revealed time;
- optional active Working On relationship;
- processor version and timestamps.

### Provenance

A join between reminders and Journal sources allows repeated guidance to retain
multiple sources. It may store segment offsets or hashes for internal
traceability, but it should not duplicate large evidence passages.

All Recollect tables require row-level security restricting reads and writes to
the owner. Privileged processing paths must verify ownership explicitly even
when using a service role.

## 11. Failure and concurrency handling

- Journal save success never depends on Recollect generation success.
- Source jobs are idempotent by source content hash and processor version.
- Concurrent claimants cannot process the same job simultaneously.
- Provider failures retry with bounded exponential backoff.
- Permanently failed processing does not create placeholder or low-quality
  cards.
- Reveals update scheduling idempotently so double taps cannot skip intervals.
- Adding to Working On is transactionally deduplicated.
- Turning Recollect off wins over in-flight work: completion must recheck the
  preference before storing candidates.
- Source deletion prevents an in-flight job from recreating orphan reminders.

## 12. Cost management

Recollect v1 uses the app's existing OpenAI integration and must feed every
successful provider response into the existing platform cost ledger.

Extraction and validation calls use distinct anonymous operation labels:

```text
recollect_extraction
recollect_validation
```

Each call records the actual model, input tokens, cached input tokens, and
output tokens through the shared OpenAI usage meter. Idempotency keys derive
from the OpenAI response identifier plus the Recollect operation so retries
cannot double-count a response.

The selected model must already have effective token rates in `cost_rates`
before Recollect is enabled. The current `gpt-5-mini` rates and daily OpenAI
provider reconciliation cover the proposed v1 vendor. If implementation selects
a new model or provider, its rates, internal usage adapter, provider health
check, and admin display must be added in the same change.

The admin cost dashboard must make the two Recollect operation labels visible
as a feature-level breakdown, while retaining aggregate OpenAI totals and the
provider-reported reconciliation comparison. Cost metadata remains anonymous
and must not include user IDs, lesson IDs, transcript text, prompts, or cues.

Metering remains fail-open: a cost-ledger outage is logged but does not discard
a successful Recollect result or make Journal saving fail.

## 13. Privacy Policy and Terms

The legal pages must be updated in the same implementation pass.

The current Privacy Policy statement that Deepgram is the only external
analysis provider is inaccurate because existing lesson, OCR, image, and
feedback features already use OpenAI. The revision must correct the broader
existing disclosure, not merely append Recollect language.

The Privacy Policy should explain in plain language:

- which Journal content may be sent for automated processing;
- that OpenAI is used for features including lesson processing and Recollect;
- the purpose of creating summaries, coaching cues, and private reminders;
- the concise derived data PongLens stores;
- the default-on setting and how to disable it;
- that disabling removes Recollect's derived records but not original Journal
  entries;
- retention, deletion, security, subprocessors, and applicable user rights;
- OpenAI's current API data-use and abuse-monitoring retention terms, stated
  accurately at the time the policy is published.

The Terms should:

- include OpenAI among relevant service providers;
- permit the processing needed to create summaries, takeaways, and reminders;
- explain that automated outputs can be incomplete or inaccurate;
- state that Recollect is a training aid rather than professional coaching,
  medical, or safety advice;
- preserve the user's ownership of their original content.

The first-use product notice supplements rather than replaces the formal
Privacy Policy. Legal copy should receive qualified review before a production
or commercial launch.

Relevant current guidance:

- [European Commission GDPR principles](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en)
- [California Privacy Protection Agency notice guidance](https://cppa.ca.gov/pdf/general_notices.pdf)
- [OpenAI API data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)
- [OpenAI business data privacy](https://openai.com/business-data/)

## 14. Testing

Implementation will be test-driven. Coverage should include:

- default-on preference behavior and explicit opt-out;
- disabling Recollect deleting derived data while preserving Journal entries;
- eligible source creation enqueueing exactly one durable job;
- match entries and disabled accounts not enqueueing;
- long-source segmentation and overlap boundaries;
- empty extraction being recorded as a successful zero-candidate result;
- rejection of incidental, vague, unsupported, or evidence-free candidates;
- evidence fragments being validated against the supplied segment;
- within-source consolidation and conservative cross-source deduplication;
- repeated guidance raising priority and retaining provenance;
- first-due and reveal interval calculations;
- reveal idempotency;
- three-card maximum, lesson weighting, and topic diversity;
- returning fewer than three cards when quality inventory is limited;
- dismissal preventing equivalent regeneration from unchanged content;
- Working On deduplication, pause, and post-completion resumption;
- preference and source-deletion races with in-flight processing;
- RLS ownership isolation;
- separate, idempotent OpenAI usage events for Recollect extraction and
  validation;
- Recollect operation costs appearing in the admin feature breakdown without
  identifying metadata;
- responsive Recollect tab and card behavior;
- Privacy Policy and Terms containing the corrected provider disclosures.

Provider-facing tests use deterministic fixtures rather than live model calls.
The two Jonathan lessons are a separately verified integration and seed step,
not a unit-test dependency.

## Out of scope for v1

- typed recall answers;
- difficulty ratings or confidence buttons;
- scores, streaks, gamification, or performance grading;
- notifications;
- per-entry Recollect controls;
- match-note generation;
- a user-editable interval schedule;
- automatic backfill of all existing accounts;
- an embeddings or vector-search dependency;
- claims that Recollect replaces a coach.

## Success criteria

Recollect is ready when:

1. a useful newly saved lesson or practice note can produce source-grounded
   cards without delaying Journal save;
2. an irrelevant note can complete successfully with zero stored reminders;
3. no more than three high-quality due cards are shown;
4. reveal, dismissal, source navigation, and Working On behave as specified;
5. mobile use remains compact and clear;
6. disabling the feature removes derived data and stops processing;
7. the two selected Jonathan lessons can seed the initial experience without a
   general historical backfill;
8. legal disclosures accurately describe both Recollect and the app's existing
   OpenAI processing.
