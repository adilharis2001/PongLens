# Lesson notes: transcription accuracy and point wording

Status: proposed, 2026-08-27. Not built.

Anton read his own lesson notes back and said they were good, with one
reservation: *"the wording of some of the points feels a bit off."* He was
right, and this is what is actually wrong, why, and what to change.

---

## The evidence

Lesson `e390056b-cd8e-498f-bee5-4508dd58abde` — Anton, 2026-08-27, 10,673
characters of transcript, 16 generated points across four themes.

**Twelve of the sixteen are clean.** Four are not, and only one of the four
is what it looks like.

### What the transcript actually contains

The notes read far better than their source. Deepgram mangled most of the
sport's vocabulary:

| Said | Transcribed as |
| --- | --- |
| pips | picks, Pipps, tips, pit bull, punches, team player |
| the table | the office |
| forehands | forehead, formula, four handed, **4 hamsters** |
| underspin | odor spin, under spindles |
| topspin | Tom Smith |
| dead serve | dead surf |
| twiddle | twittle |

*"do a couple 4 hamsters, see if they like, what do they do?"* became "Test
the opponent's forehand early." The model is reading through severe damage
and mostly winning. Any judgement of the notes has to start there.

### The four defective points

1. **"Start your racket a little higher and increase the forearm slightly
   for the over-the-table lift."**
   From: *"almost want to increase that forearm to be a little bit. And it
   was, like, over the table."*
   "Increase the forearm" is not English. It is the coach's own unfinished
   spoken sentence carried through verbatim. The point also invents a shot
   name — "the over-the-table lift" — from Anton describing where the ball
   was.

2. **"Rotate your body a little and use your arm rather than trying to hit
   the ball entirely with your arm."**
   From: *"It's hard to, like, just use your arm. But, like, even rotating
   your body a bit, and hitting with the arm."*
   Self-contradictory as written: use your arm rather than your arm. A
   negation was lost. This is the worst of the four and the one nobody
   flagged by eye.

3. **"Treat short balls as less underspin than they appear instead of
   automatically lifting them heavily."**
   Missing a word. Reads as a typo rather than a sentence.

4. **"Serve into the opponent's middle to limit their options and take time
   away."**
   Filed under *Serving against pips*, but the transcript puts middle
   placement and taking time away **after** the dead serve — it is where to
   attack, not where to serve. An attribution error, not a wording one.

### Why it happens

The distillation prompt says:

> If the transcript garbled a word, infer the table-tennis meaning only when
> it is obvious; otherwise drop it.

That rule governs garbled **words**. It says nothing about garbled
**phrases**. In "increase that forearm to be a little bit" every individual
word is transcribed correctly — it is a coach talking mid-rally in
unfinished spoken English. So the model treats it as something Anton
genuinely said and preserves it, which the surrounding rule ("Every point
must come from something actually said") actively pushes it to do.

Spoken fragments get promoted into written notes. That is the whole bug.

---

## What changes

Three parts. A and B are small and independent — either can ship alone.
C is larger and is what makes Adil's stated policy true.

---

## Part A — Give Deepgram the vocabulary

**One call site.** [`src/app/api/transcribe/route.ts:120`](../../../src/app/api/transcribe/route.ts)
serves lesson dictation, journal dictation, voice notes and coach review
findings. Changing that URL changes everything.

This is **not a dashboard setting.** Deepgram keyterm prompting is a
per-request query parameter, so there is nothing to switch on in the
Deepgram console — it is a code change to one string.

### Current

```
https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&mip_opt_out=true
```

### Proposed

The same URL with `keyterm` repeated once per term. Nova-3 supports
`keyterm` (the older `keywords` parameter is for Nova-2 and earlier and
takes weights; `keyterm` takes plain terms only). Limit is 500 tokens
across all terms; Deepgram's own guidance is 20–50 focused terms.

Build the list in code rather than inlining it, so it is reviewable:

```ts
/**
 * Table-tennis vocabulary for Deepgram keyterm prompting (nova-3).
 *
 * Deliberately distinctive terms only. Boosting ordinary English words
 * ("block", "push", "table") makes the recogniser hear them where nobody
 * said them, which trades one class of error for a worse one. Every term
 * below either appeared mis-transcribed in a real lesson or has no
 * everyday meaning that could collide.
 */
const TT_KEYTERMS = [
  "pips", "long pips", "short pips", "anti-spin", "twiddle",
  "underspin", "backspin", "topspin", "sidespin", "no-spin",
  "dead ball", "dead serve", "half-long", "chop block", "counterloop",
  "banana flick", "chiquita", "forehand", "backhand", "third ball",
  "deuce", "footwork", "blade", "rubber",
];
```

Twenty-four terms. **Start here and do not grow the list by intuition** —
add a term only after a real transcript shows it being mis-heard.

### Cost

Keyterm prompting is a **paid add-on**, not a free flag.

| | Per minute | Per hour of audio |
| --- | --- | --- |
| Nova-3 base (metered today) | $0.0077 | $0.46 |
| Keyterm add-on | $0.0013 | $0.08 |
| **Total** | **$0.0090** | **$0.54** |

About **17% more** for every second of audio the product transcribes,
including short voice notes that need it least. If that matters, the
alternative is to apply keyterms only when `tier` indicates a lesson — but
the simpler global version is recommended: voice notes are full of the same
vocabulary, and the sums are small.

`cost_rates` needs a second Deepgram row for the add-on so the admin cost
dashboard keeps telling the truth.

### Risk

Keyterm boosting causes false positives — the recogniser starts hearing
"pips" where someone said "picks". With this list the exposure is small
(these words rarely occur in ordinary speech about table tennis), but it is
real and it is why the list stays short.

### Verifying it

**Anton's lesson cannot be used as an A/B.** Lesson audio is not retained —
only `tier: "voice"` recordings are stored, and the `lessons` table has no
audio path. The comparison needs a fresh recording:

1. Record one lesson-length session and transcribe it twice, with and
   without the keyterms, against the same audio bytes.
2. Count occurrences of the known failure words ("office", "picks",
   "forehead", "surf") in each.
3. Read both for new false positives before shipping.

---

## Part B — Make the points read like written English

Edits to `PROMPT` in [`src/app/api/lesson/route.ts:31`](../../../src/app/api/lesson/route.ts),
and the same edits to `MERGE_PROMPT` at line 132 so long lessons that go
through the merge path do not lose them.

### Rules to remove

- *"…otherwise drop it."* — **Adil's decision: never drop a point.** A point
  that survives in mangled form is a point the player can correct; a point
  that was dropped is gone silently and nobody knows what they lost.
- *"Fewer, sharper points beat completeness."* — same reason, and it
  contradicts the line above once dropping is off the table.
- *"Write each point as one short, memorable, actionable sentence"* —
  "short" and "memorable" are what produced the clipped, telegram-like
  phrasing.

### Rules to add

> - Keep every piece of coaching the session contained. If the transcript
>   garbled it, write the clearest sentence the words support and let the
>   player correct it — never silently drop a point because you are unsure.
> - Write each point as one complete sentence of plain written English in
>   the second person. It must read as something a person wrote down, never
>   as a fragment of speech copied out. If the coach's own phrasing does not
>   survive as written English — "increase that forearm to be a little bit"
>   — say what he meant in ordinary words: "use a bit more forearm."
> - When the coach tied the advice to a situation, name the situation in a
>   short opening clause and then give the instruction: "When your dead
>   serve comes back short to your forehand, lift it forward rather than
>   trying to spin it." Only when the transcript establishes the situation.
>   Never invent one to pad a sentence.
> - Roughly 12–25 words. One sentence. Not two clauses joined by a
>   semicolon, not three stacked sub-clauses. It has to stay skimmable.
> - Never write a sentence that contradicts itself. If a point ends up
>   telling the player both to do and not do the same thing, a negation has
>   been lost — re-read the source and fix it.
> - 2–6 points per theme.

### Rules that stay exactly as they are

- Never invent advice or technique detail that was not said. Keeping a
  garbled point means saying it plainly, **not** filling the gap with
  plausible coaching.
- The off-topic guard, verbatim. That one is not about quality — it is what
  stops the endpoint summarising arbitrary text pushed through it.
- Second person, theme grouping, sentence-case title and theme names.

### Acceptance criteria

Re-running Anton's transcript should turn the four defective points into
something like:

| Now | Target |
| --- | --- |
| Start your racket a little higher and increase the forearm slightly for the over-the-table lift. | When lifting a dead ball over the table, start your racket a little higher and use a bit more forearm. |
| Rotate your body a little and use your arm rather than trying to hit the ball entirely with your arm. | On short balls, rotate your body into the shot instead of reaching with your arm alone. |
| Treat short balls as less underspin than they appear instead of automatically lifting them heavily. | Short balls off pips carry less underspin than they look, so don't automatically lift them heavily. |
| Serve into the opponent's middle to limit their options and take time away. | *(moved to Attacking and placement)* Once your dead serve comes back, attack into the middle or a corner to take their time away. |

And the twelve good points should come back recognisably the same. A rewrite
that improves the four and churns the other twelve has failed — the format
Anton liked is the thing being preserved.

Note that the best existing points already follow the target shape: *"Use a
dead or nearly dead serve so the pips cannot use your spin against you"*
names the situation, gives the instruction, and says why in fifteen words.
The rules above are asking for all sixteen to look like that one, not for a
new style.

---

## Part C — Editing a single point

**This is the gap.** The policy behind Parts A and B is "keep the point, let
it be wrong, the player corrects it by hand." That is not possible in the
product today, on either surface.

What "Edit" does now, on web
([`JournalEditor.tsx`](../../../src/app/journal/JournalEditor.tsx)) and iOS
([`JournalStore.swift:289`](../../../ios/PongLens/PongLens/Core/JournalStore.swift))
alike: it opens the **raw transcript**. Saving sends `PATCH /api/lesson`,
which sets `takeaways: null` and re-distills the whole entry from scratch
([`route.ts:378`](../../../src/app/api/lesson/route.ts)).

So fixing one bad bullet means rewriting the speech-to-text of a
forty-minute lesson and regenerating all sixteen points — losing any that
were already right, and with no guarantee the one you were chasing comes
back better. Nobody will do that. In practice the wrong point stands
forever.

### Proposed

- Tapping a point in the lesson card makes it editable in place, the way a
  match note already is.
- A new endpoint writes the `takeaways` JSON directly and does **not**
  re-distill. Distillation stays where it is — on transcript change.
- Editing the transcript still regenerates everything, but should say so
  first when hand-edited points exist, rather than discarding them quietly.
- Both surfaces, since the journal is on both and the iOS card is where
  Anton's screenshot came from.

Larger than A and B together, and it is the difference between a policy and
a wish. Ship A and B first; they reduce how often the fallback is needed.

---

## Rollout

A and B are prompt and URL changes with no migration. Both take effect on
the next entry; neither touches stored rows, so nothing existing changes
until an entry is re-saved.

**Rollback for both is reverting one commit.** There is no flag to add and
no state to unwind.

Existing lessons keep the notes they have. If Anton's entry should get the
better wording, re-saving it through the editor re-distills it — which is
worth doing once by hand as the first real check of Part B.

## Open questions

1. **Keyterms everywhere, or lessons only?** Global is simpler and helps
   voice notes; it also adds 17% to transcription on recordings that may not
   need it. Recommendation: global.
2. **Part C now or later?** It is the honest completion of "let the user
   correct it", and it is also the largest piece here.
