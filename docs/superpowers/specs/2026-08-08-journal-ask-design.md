# Ask your journal — design

2026-08-08. Ask a question in plain language and get an answer built only
from your own journal and your own matches, with the notes and lessons it
came from sitting under it as real, tappable cards.

Research inputs: a measurement of every journal in production, GPT-5.6
Luna's published limits, and the search/ask UX pattern as it settled in
2026 (unified entry point; NN/g's finding that a separate AI mode goes
undiscovered).

---

## 1. The measurement that decides the architecture

Every journal in the production database, 2026-08-08:

| | Heaviest | Next |
| --- | --- | --- |
| Notes | 5 (332 chars) | 4 (263) |
| Lesson transcripts | 5 (67,500 chars) | 4 (30,979) |
| Takeaways | 5,190 chars | 2,029 |
| Focus points + Recollect | 12 | 8 |
| **Writing total** | **74,485 chars ≈ 19k tokens** | ≈ 8.5k tokens |
| Matches / points / scored | 27 / 1570 / 1119 | 3 / 113 / 112 |

Luna takes 922k input tokens. The heaviest journal in existence here fits
**48 times over**.

**So there is no retrieval step.** The whole journal goes in the prompt,
every time. This is not a shortcut, it is the quality argument: the way
Granola answers badly is that it retrieves over a subset and misses. A
question can only be answered from what the retriever found, and when the
retriever is wrong the answer is confidently incomplete. Sending
everything cannot miss.

It is also cheaper than the alternative. An embedding pipeline, a vector
column and a reindex-on-write job cost more to build, more to run, and
answer worse at this size. Retrieval starts earning its keep somewhere
above 300–400k tokens — roughly thirty lessons plus years of notes.

**When someone does outgrow the budget, the first lever is not embeddings.**
Drop lesson *transcripts* and keep *takeaways*, which are already distilled
and about 20x smaller: the same user's five takeaway sets are 5,190 chars
against 67,500 of transcript. That alone holds ~100 lessons. Only after
that does a date window come into it. Tiers, in order:

1. everything (default)
2. transcripts dropped, takeaways kept
3. most recent 12 months
4. (not built) retrieval

The tier chosen is recorded on the response and shown to the user as one
quiet line when it is not tier 1, because an answer drawn from part of the
journal must say so.

---

## 2. The corpus

Three sections, assembled server-side, scoped to the asker's own material.

**A · Writing** — notes (body, author name, match title, point number),
lesson takeaways and transcripts, practice entries, the Working-on list,
tags with their counts. Sources: `note_feed()`, `lessons`, `focus_points`,
`tag_stats()`, all under existing RLS. No new tables.

Notes on matches shared *with* the asker as a coach are excluded: this is
their journal, not their students'.

**B · Match facts** — and the rule that makes them trustworthy:

> **The model never counts. It reads counts.**

Sending 1,119 rows of "point 34: lost, net" and asking for a rate is asking
a language model to do arithmetic over a haystack, which is exactly how
answers come out wrong. Every number is computed in TypeScript first and
the model only reads the result. The functions already exist, are pure, and
are already under test:

- `aggregateStats()` (`src/app/stats/aggregate.ts`) — cross-match record,
  per-opponent record, win rates.
- `computeMatchStats()` (`src/app/match/[id]/matchStats.ts`) — per match.
- `computeMatchAnalysis()` (`src/app/match/[id]/matchAnalysis.ts`) — loss
  reason, serve spin, serve length and direction tallies.

So section B is one line per match — opponent, date, type, venue, games,
points won and lost, and the tallies — plus the global rollup. About 60
tokens a match: ~2k tokens for the heaviest user, against ~19k for their
writing. The expensive-sounding half of this feature is the cheap half.

**C · Profile** — handedness, grip, style from `player_profiles`. Three
lines, and it changes how advice reads.

Total for the heaviest user today: **≈21k tokens ≈ $0.0042 an ask.**

---

## 3. UX

One entry point. The Journal's existing search box gains a word and a row,
and nothing that works today changes.

```
┌────────────────────────────────────────────────┐
│ 🔍 Search or ask your journal                  │
└────────────────────────────────────────────────┘
┌────────────────────────────────────────────────┐
│ ✨ Ask your journal                        →   │   ← first result row
└────────────────────────────────────────────────┘
  forehand error 3   serve fault 1                    ← unchanged
  ── notes, lessons, practice ──────────────────      ← unchanged, live, free
```

- The live client-side filter keeps working exactly as it does. It is
  instant and costs nothing, and it is the right answer to most queries.
- The Ask row appears once the query passes a few words. **The model never
  runs on a keystroke** — only on tap or Enter-on-the-row. That is the cost
  control and the predictability guarantee in a single decision.
- The answer opens in place above the filtered results, which stay put
  underneath. Asking never destroys what searching found.
- A second question replaces the first. No thread, no history in v1.

**Rejected: a sixth section tab beside Recollect.** Those tabs filter by
content type; Ask is an action, not a content type. It would also inherit
the discoverability problem NN/g documented on Google's AI Mode, where test
participants never found the separate mode at all.

**Rejected: detecting intent and answering automatically.** Unpredictable
in a search box, and it spends money on every keystroke.

---

## 4. The answer, and why it can be trusted

`POST /api/journal-ask` → `{ question }` → structured JSON:

```
{ answer: [{ text, sourceIds: string[] }],
  sources: [{ id, kind, title, href, when }],
  coverage: "full" | "takeaways" | "recent",
  refused?: "not_in_journal" | "off_topic" }
```

Four rules, each one closing a specific failure:

1. **Citations are structural.** Luna supports JSON-schema structured
   output. Every sentence carries source ids, and the route **drops any
   sentence whose ids are not in the corpus it just sent**. The model
   cannot emit an uncited claim and have it reach the screen.
2. **The sources render as the real cards** — the note or the lesson,
   tappable through to the match and the point (`?p=<point_id>`, plumbing
   exists). This is the difference between an answer and something a player
   can go and watch.
3. **Refusing is a correct answer.** "Your journal doesn't cover that" beats
   a fluent paragraph of general table tennis advice, and generic advice
   dressed as "from your notes" is the one failure that would end trust in
   this feature. `/api/lesson`'s off-topic guard already has the posture;
   this reuses it.
4. **Notes can be written by someone else.** A coach writes on a player's
   match, so the corpus contains text authored by another user. Same
   instruction-ignoring guard the lesson prompt carries, stated against the
   whole corpus.

Prompt order is system → corpus → question, so the corpus is the cacheable
prefix and a second question in a session bills cached input at $0.10/1M.

---

## 4b. Abuse controls (added during the build)

Ask is free, so the ceiling is not the price of one answer, it is what a
determined account can do with an unbounded loop. Every gate runs BEFORE
OpenAI is contacted.

`claim_journal_ask()` (migration 085) takes four checks in ONE atomic
statement: kill switch, per-minute burst, per-user day limit, global day
limit. Atomic because check-then-insert is a race — two parallel requests
read the same remaining slot and both proceed. Verified with eight
simultaneous requests: exactly the remaining allowance passed, the rest
came back 429.

- **Fails closed.** A missing service-role key throws, and the tempting
  reading is "no limiter configured, allow". It returns 503 instead. A
  limit that vanishes on misconfiguration is not a limit.
- **The global limit is the one that matters.** Per-user limits are worth
  nothing against someone who can create users; only an aggregate ceiling
  sees that.
- **The question is capped at 400 characters**, so it cannot be used to
  inflate the prompt, and the check runs before the claim so a malformed
  request does not burn the asker's own allowance.
- **The corpus is capped at 120k tokens** with tiering and a hard
  truncation behind it, so a journal padded on purpose hits a wall
  instead of a bill. Worst case per ask: $0.024.
- **Output is capped** at 1200 tokens, because output bills at 6x input
  and "write me a novel" is the cheapest injection there is.
- **`journal_ask_runs` records size, never question text.** The limiter
  needs to know an ask happened, not what the player privately worries
  about.

Measured on the first nine real asks: $0.02 total, about $0.002 each.

### The bill ceiling (migration 087)

Counting asks is not the same as bounding spend, and the gap is wide: a
normal ask is ~10k tokens ($0.002) and a maxed-out one is 120k ($0.024).
So 2000 asks is $4 of real use or $50 of deliberate abuse. A count is a
poor proxy for a bill.

`reserve_journal_ask_tokens()` closes that. Once the corpus is built and
its size is known, and before the model is contacted, it checks the size
against two token budgets and writes the reservation in the same
statement:

| Config key | Default | At $0.20/1M |
| --- | --- | --- |
| `journal_ask_user_daily_tokens` | 600,000 | $0.12 per user per day |
| `journal_ask_global_daily_tokens` | 20,000,000 | $4.00 platform per day |

The per-user figure is set against real data rather than guessed: the
heaviest journal in production is ~21k tokens, so 600k covers a genuinely
heavy user's full 25 asks, while capping a padded 120k-token journal at 5
asks a day instead of 25. Output adds at most 1200 tokens per ask, so the
platform ceiling lands near **$5/day, about $150/month, worst case** —
against roughly $4/day if two thousand real asks ever happened in one day.

Both budgets are `app_config` keys, so raising them is a row update, not a
deploy.

## 5. Model, cost, limits

- `ASK_MODEL = "gpt-5.6-luna"`, a constant beside `RECOLLECT_MODEL` and
  `DISTILL_MODEL`. Luna's 1M window is what makes the no-retrieval design
  possible; $0.20/1M in and $1.20/1M out make it free in practice.
- Before settling, run ~20 real questions against Luna and Sol. Long-context
  grounding is the one axis where a cheap tier can quietly disappoint, and
  checking is cheap.
- Metering rides `openAIUsageEvents()`, which already splits cached from
  uncached input, so the cost dashboard picks this up with no new plumbing.
- Rate limit per user per day, read from `app_config` like every other knob.
  Runtime kill switch `journal_ask_enabled`, same shape as
  `coach_reviews_enabled`.
- `maxDuration = 60`, `runtime = "nodejs"`, matching `/api/lesson`.

---

## 6. Out of scope for v1

Conversation threads and follow-ups, asking across a coach's students,
answers that cite video timestamps inside a clip, voice questions, saving an
answer into the journal as an entry, and any surface outside the Journal
page.

---

## 7. Build order

1. Corpus builder + token budget tiers, with tests on the tier boundaries.
2. `/api/journal-ask`: prompt, structured output, citation validation,
   metering, rate limit, kill switch.
3. Search box: placeholder, Ask row, answer card, source cards.
4. Verify at 393×660, real questions against a real journal.
5. `npm run build` in a worktree.
