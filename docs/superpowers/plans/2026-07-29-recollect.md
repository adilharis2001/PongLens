# Recollect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the default-on Recollect Journal tab, which turns valuable lesson and practice guidance into a maximum of three source-grounded, spaced reminders without typed answers or global recurring model jobs.

**Architecture:** Saving an eligible Journal entry creates a durable, user-owned Recollect source job. A bounded processor handles one transcript segment at a time, stores only validated candidates, and resumes opportunistically after save or when Recollect is opened; the database remains the durable source of truth if a request ends. OpenAI GPT-5 mini performs extraction and a compact validation pass, and every response is metered through PongLens's existing anonymous cost ledger under Recollect-specific operations.

**Tech Stack:** Next.js 15.5 App Router and `after()`, React 19, TypeScript, Supabase/PostgreSQL with RLS and security-definer RPCs, OpenAI Chat Completions with `gpt-5-mini`, Node test runner, existing PongLens cost accounting.

## Global Constraints

- Recollect is enabled by default; absence of a preference row means enabled.
- The only user setting is one global on/off toggle.
- The product UI must not describe Recollect as AI.
- Only `lesson` and `practice` Journal entries are eligible in v1.
- Match notes are out of scope.
- Three reminders is a maximum, never a quota.
- A valid processing result may contain zero reminders.
- Every accepted reminder must be supported by a verbatim fragment from its source segment.
- Rejected candidates and evidence fragments are not stored.
- A normal new reminder first becomes due about 24 hours after its source is saved.
- The two explicitly selected Jonathan lessons are the only historical records seeded and are due immediately.
- There is no global historical backfill and no recurring model sweep over all users.
- Long sources are segmented; one processing invocation handles at most one extraction segment plus a final compact validation call.
- Revealing, not merely viewing, advances the schedule.
- Adding a reminder to Working On pauses it until seven days after that focus point is completed or removed.
- Turning Recollect off deletes all generated Recollect data while preserving original Journal entries and the explicit disabled preference.
- `Not useful` permanently dismisses the reminder for unchanged source content.
- Recollect uses OpenAI GPT-5 mini unless the implementation first adds cost rates and admin support for a replacement model or vendor.
- Every successful provider response is anonymously and idempotently cost-metered.
- Cost metadata must never contain user IDs, lesson IDs, transcript text, prompts, or cues.
- Journal save success must not depend on Recollect processing or cost-meter writes.
- Do not add an embeddings or vector-search dependency in v1.
- Legal copy is not a substitute for qualified legal review before commercial launch.

---

## File structure

New files:

- `supabase/migrations/057_recollect.sql` — Recollect tables, RLS, job claim,
  reveal, opt-out, and Working On RPCs/triggers.
- `src/lib/recollect/types.ts` — shared provider, processor, API, and UI types.
- `src/lib/recollect/segments.ts` — bounded transcript segmentation.
- `src/lib/recollect/candidates.ts` — conservative parsing, evidence checks,
  normalization, and candidate consolidation boundaries.
- `src/lib/recollect/schedule.ts` — reveal intervals and due-card selection.
- `src/lib/recollect/repository.ts` — service-role persistence behind a small
  processor-facing interface.
- `src/lib/recollect/openai.ts` — extraction and validation calls plus usage
  metering.
- `src/lib/recollect/processor.ts` — one-segment durable job state machine.
- `src/lib/recollect/*.test.ts` — pure, provider, processor, migration, legal,
  and route-wiring contracts.
- `src/lib/supabase/admin.ts` — server-only service-role client.
- `src/app/api/recollect/route.ts` — authenticated card reads and reveal,
  dismissal, Working On, and notice actions.
- `src/app/api/recollect/process/route.ts` — authenticated bounded job resume.
- `src/app/api/recollect/settings/route.ts` — authenticated global toggle.
- `src/app/journal/Recollect.tsx` — tab content, card interaction, polling, and
  mobile treatment.
- `src/app/account/RecollectSetting.tsx` — Account preference row.

Existing files modified:

- `src/app/api/lesson/route.ts` — enqueue and opportunistically begin
  Recollect after a successful save.
- `src/app/journal/NotesFeed.tsx` — add the Recollect tab, source navigation,
  preference state, and Working On refresh.
- `src/app/journal/LessonCard.tsx` — stable source anchor.
- `src/app/account/page.tsx` — render the preference.
- `src/lib/types.ts` — durable Recollect view types where shared with Journal.
- `src/lib/costs/routeMetering.test.ts` — require both Recollect operations.
- `src/app/admin/costDashboardView.ts` and test — operation-level cost rows.
- `src/app/admin/CostDashboardSection.tsx` — visible feature-cost breakdown.
- `src/app/privacy/page.tsx` and `src/app/terms/page.tsx` — correct current
  OpenAI disclosures and add Recollect terms.
- `supabase/README-SETUP.md` — migration order.

---

### Task 1: Recollect database contract

**Files:**
- Create: `supabase/migrations/057_recollect.sql`
- Create: `src/lib/recollect/recollectMigration.test.ts`
- Modify: `supabase/README-SETUP.md`

**Interfaces:**
- Produces tables `recollect_preferences`, `recollect_jobs`,
  `recollect_items`, and `recollect_item_sources`.
- Produces `public.enqueue_recollect_source(p_owner_id uuid, p_lesson_id uuid, p_first_due_at timestamptz, p_processor_version text) returns jsonb`.
- Produces `public.claim_recollect_job(p_owner_id uuid) returns jsonb`.
- Produces `public.complete_recollect_job(p_owner_id uuid, p_job_id uuid, p_content_hash text, p_items jsonb) returns jsonb`.
- Produces `public.reveal_recollect_item(p_owner_id uuid, p_item_id uuid, p_review_key uuid, p_now timestamptz) returns jsonb`.
- Produces `public.set_recollect_enabled(p_owner_id uuid, p_enabled boolean) returns jsonb`.
- Produces `public.add_recollect_to_working_on(p_owner_id uuid, p_item_id uuid) returns jsonb`.
- All six RPCs are callable only by `service_role`; authenticated users reach
  them only through owner-verifying API routes.

- [ ] **Step 1: Write the failing migration contract**

Create `src/lib/recollect/recollectMigration.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../../../supabase/migrations/057_recollect.sql", import.meta.url),
  "utf8",
);

test("Recollect migration creates private durable state", () => {
  for (const table of [
    "recollect_preferences",
    "recollect_jobs",
    "recollect_items",
    "recollect_item_sources",
  ]) {
    assert.match(sql, new RegExp(`create table public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(sql, /unique \(lesson_id, content_hash, processor_version\)/);
  assert.match(sql, /references public\.lessons \(id\) on delete cascade/);
});

test("Recollect mutations are service-only and owner-scoped", () => {
  for (const fn of [
    "enqueue_recollect_source",
    "claim_recollect_job",
    "complete_recollect_job",
    "reveal_recollect_item",
    "set_recollect_enabled",
    "add_recollect_to_working_on",
  ]) {
    assert.match(sql, new RegExp(`function public\\.${fn}`));
  }
  assert.match(sql, /revoke execute on function public\.claim_recollect_job[\s\S]*from public/);
  assert.match(sql, /grant execute on function public\.claim_recollect_job[\s\S]*to service_role/);
  assert.match(sql, /p_owner_id/);
  assert.match(sql, /for update skip locked/);
});

test("disabling deletes derived data but preserves the preference", () => {
  assert.match(sql, /delete from public\.recollect_jobs/);
  assert.match(sql, /delete from public\.recollect_items/);
  assert.match(sql, /insert into public\.recollect_preferences/);
  assert.doesNotMatch(sql, /delete from public\.lessons/);
});
```

- [ ] **Step 2: Run the contract and verify RED**

Run:

```bash
npm run test:journal
```

Expected: failure because migration 057 does not exist.

- [ ] **Step 3: Implement the four private tables**

`057_recollect.sql` must define:

```sql
create table public.recollect_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  notice_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recollect_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  content_hash text not null check (char_length(content_hash) = 64),
  processor_version text not null check (char_length(processor_version) between 1 and 40),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'complete', 'failed')),
  next_segment integer not null default 0 check (next_segment >= 0),
  candidate_buffer jsonb not null default '[]'::jsonb,
  first_due_at timestamptz not null,
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text check (char_length(last_error) <= 500),
  accepted_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id, content_hash, processor_version)
);
```

`recollect_items` stores owner, question, cue, normalized topic, supported
category, numeric priority, source frequency, `active|dismissed` state,
schedule step, next due time, last reveal time, last review UUID, optional
focus-point link, processor version, and timestamps. Enforce the prompt/cue
limits from the design at the database boundary.

`recollect_item_sources` has `(item_id, lesson_id)` as its primary key plus
segment start/end offsets and a nonidentifying evidence hash. It must not store
the evidence text.

Add indexes for:

```sql
(user_id, status, next_due_at)
(user_id, status, available_at)
(user_id, topic_key)
```

- [ ] **Step 4: Add RLS and grants**

Owners may select their own preferences and reminders. Do not grant direct
authenticated writes to jobs, items, or provenance. Explicitly revoke all
four tables from `anon`, and grant only the minimum owner-readable columns to
`authenticated`.

Every security-definer function must use:

```sql
security definer
set search_path = public
```

and validate that `p_owner_id` owns every selected lesson, item, or focus point.

- [ ] **Step 5: Implement the atomic RPC behavior**

`claim_recollect_job` claims one due queued/failed job for the owner with
`FOR UPDATE SKIP LOCKED`. It may reclaim a `processing` job whose `locked_at`
is older than ten minutes. It increments `attempt_count`, sets `locked_at`,
and returns the job plus the current source transcript, kind, and creation
time. It returns JSON `null` when nothing is claimable.

`enqueue_recollect_source` verifies ownership and kind, treats a missing
preference as enabled, computes SHA-256 over the current transcript, and
idempotently creates the current processor-version job. When an existing source
hash changes, the same transaction removes obsolete jobs and that lesson's old
provenance, deletes only reminders left with no source, and enqueues the new
hash.

`complete_recollect_job` locks the job, rechecks owner, enabled preference,
source existence, content hash, and processor version, then atomically inserts
new reminders, merges declared owner-scoped duplicates, writes provenance, and
marks the job complete. An empty `p_items` array records a successful
zero-candidate result. Invalid or stale completion returns without storing
items.

`reveal_recollect_item`:

```sql
-- Same review key returns the existing reveal without advancing twice.
if v_item.last_review_key = p_review_key then
  return v_payload;
end if;
```

For a new key it advances from the current step using delays
`3, 7, 14, 30, 60` days, capped at 60 days, and returns the cue and source
metadata.

`set_recollect_enabled(false)` upserts the disabled preference, then deletes
the owner's jobs and items. Cascades remove provenance; original lessons are
untouched. `set_recollect_enabled(true)` changes the preference and, only when
the preceding explicit state was disabled, queues the owner's existing lesson
and practice sources for regeneration with first due times 24 hours later.
The migration itself does not enqueue historical rows.

`add_recollect_to_working_on` locks the item, returns `duplicate` when the cue
already exists among active focus points, returns `full` when five are active,
otherwise inserts the focus point, links it, and returns `added` with the row.

- [ ] **Step 6: Pause and resume through Working On**

Add triggers on `focus_points`:

- when a linked focus point receives `retired_at`, clear the link and move the
  reminder's `next_due_at` to at least seven days after retirement;
- before a linked focus point is deleted, clear the link and move
  `next_due_at` to at least seven days after deletion.

The due-item query excludes items linked to an unretired focus point.

- [ ] **Step 7: Update setup documentation and verify GREEN**

Add migration 057 to `supabase/README-SETUP.md`.

Run:

```bash
npm run test:journal
git diff --check
```

Expected: the migration contracts pass.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/057_recollect.sql supabase/README-SETUP.md src/lib/recollect/recollectMigration.test.ts
git commit -m "feat: add Recollect database contract"
```

---

### Task 2: Segmentation, candidate validation, and scheduling

**Files:**
- Create: `src/lib/recollect/types.ts`
- Create: `src/lib/recollect/segments.ts`
- Create: `src/lib/recollect/segments.test.ts`
- Create: `src/lib/recollect/candidates.ts`
- Create: `src/lib/recollect/candidates.test.ts`
- Create: `src/lib/recollect/schedule.ts`
- Create: `src/lib/recollect/schedule.test.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**
- Produces `splitRecollectSource(text: string): RecollectSegment[]`.
- Produces `parseExtractionResult(raw: unknown, segment: RecollectSegment): ExtractedCandidate[]`.
- Produces `parseValidationResult(raw: unknown, allowedCandidates: ExtractedCandidate[], existingItemIds: Set<string>): ValidatedCandidate[]`.
- Produces `nextRecollectDue(step: number, now: Date): { step: number; nextDueAt: string }`.
- Produces `selectDueRecollectItems(items: DueRecollectItem[], now: Date, limit?: number): DueRecollectItem[]`.

- [ ] **Step 1: Write failing segmentation tests**

Use constants of 24,000 characters with 1,200 characters of overlap:

```ts
test("short sources stay in one segment", () => {
  assert.deepEqual(splitRecollectSource("Keep the racket high."), [{
    index: 0,
    start: 0,
    end: 21,
    text: "Keep the racket high.",
  }]);
});

test("long sources cover all text with bounded overlap", () => {
  const text = `${"A".repeat(23_500)}\n\n${"B".repeat(23_500)}`;
  const parts = splitRecollectSource(text);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => part.text.length <= 24_000));
  assert.equal(parts[0]?.start, 0);
  assert.equal(parts.at(-1)?.end, text.length);
  assert.ok((parts[0]?.end ?? 0) > (parts[1]?.start ?? Infinity));
});
```

- [ ] **Step 2: Write failing quality-gate tests**

Cover empty output, unsupported categories, excessive lengths, and evidence
that is not an exact substring:

```ts
test("irrelevant sources may produce zero candidates", () => {
  assert.deepEqual(
    parseExtractionResult({ candidates: [] }, segment("My paddle is red.")),
    [],
  );
});

test("a candidate without source evidence is rejected", () => {
  assert.deepEqual(
    parseExtractionResult({
      candidates: [{
        question: "What should you do on short serves?",
        cue: "Step in under the table.",
        topic_key: "short-serve-receive",
        category: "serve_receive",
        evidence: "Words the coach never said",
        importance: 0.9,
      }],
    }, segment("Keep your racket high.")),
    [],
  );
});
```

Supported categories are:

```ts
type RecollectCategory =
  | "technique"
  | "tactics"
  | "positioning"
  | "serve_receive"
  | "practice"
  | "mental";
```

- [ ] **Step 3: Write failing schedule and selection tests**

Assert the exact post-reveal intervals:

```ts
assert.equal(daysUntil(nextRecollectDue(0, now).nextDueAt, now), 3);
assert.equal(daysUntil(nextRecollectDue(1, now).nextDueAt, now), 7);
assert.equal(daysUntil(nextRecollectDue(2, now).nextDueAt, now), 14);
assert.equal(daysUntil(nextRecollectDue(3, now).nextDueAt, now), 30);
assert.equal(daysUntil(nextRecollectDue(4, now).nextDueAt, now), 60);
assert.equal(daysUntil(nextRecollectDue(9, now).nextDueAt, now), 60);
```

Selection tests must prove:

- no more than three cards are returned;
- two lessons plus one practice is preferred when quality is comparable;
- fewer than three are returned when fewer are due;
- a repeated lesson cue ranks above a one-off practice cue;
- the result avoids repeating a topic when another due topic is available.

- [ ] **Step 4: Run tests and verify RED**

Run:

```bash
npm run test:journal
```

Expected: missing Recollect modules.

- [ ] **Step 5: Implement the pure modules**

`splitRecollectSource` should prefer the latest paragraph or line break before
the hard limit, fall back to the hard boundary, and guarantee forward progress.

`parseExtractionResult` must:

```ts
const evidenceStart = segment.text.indexOf(candidate.evidence);
if (evidenceStart < 0) return null;
```

It trims values, enforces question/cue/topic limits, normalizes `topic_key` to
lowercase hyphenated ASCII, clamps importance to `[0, 1]`, and returns absolute
evidence offsets plus a SHA-256 evidence hash for transient processing.

`parseValidationResult` accepts only candidate IDs from the current extraction
set and `duplicate_of` IDs from the supplied owner-scoped existing item set.
It never accepts model-created identifiers.

`selectDueRecollectItems` sorts only due, active, unpaused rows. It uses lesson
priority, source frequency, overdue time, priority, and topic diversity, then
fills to at most three without lowering quality thresholds.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm run test:journal
npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/recollect src/lib/types.ts
git commit -m "feat: define Recollect quality and scheduling"
```

---

### Task 3: OpenAI extraction, validation, and durable processing

**Files:**
- Create: `src/lib/supabase/admin.ts`
- Create: `src/lib/recollect/repository.ts`
- Create: `src/lib/recollect/openai.ts`
- Create: `src/lib/recollect/openai.test.ts`
- Create: `src/lib/recollect/processor.ts`
- Create: `src/lib/recollect/processor.test.ts`
- Modify: `src/lib/costs/routeMetering.test.ts`

**Interfaces:**
- Produces `createAdminClient(): SupabaseClient`.
- Produces `RecollectRepository`.
- Produces `extractRecollectCandidates(args, fetchImpl?): Promise<ExtractedCandidate[]>`.
- Produces `validateRecollectCandidates(args, fetchImpl?): Promise<ValidationDecision[]>`.
- Produces `processNextRecollectJob(ownerId: string, deps?: ProcessorDeps): Promise<ProcessResult>`.

- [ ] **Step 1: Write failing provider prompt and metering tests**

The provider test uses a fake `fetch` response with an OpenAI response ID and
usage object. Assert:

```ts
assert.equal(request.model, "gpt-5-mini");
assert.equal(request.response_format.type, "json_object");
assert.match(systemPrompt, /return an empty candidates array/i);
assert.match(systemPrompt, /verbatim evidence/i);
assert.doesNotMatch(systemPrompt, /paddle color.*remember/i);
```

Capture the usage transport and assert operation names and idempotency:

```ts
assert.equal(events[0]?.operation, "recollect_extraction");
assert.match(events[0]?.idempotencyKey ?? "", /^openai:resp_extract_1:recollect-extraction:/);
```

Repeat for `recollect_validation`.

Extend `routeMetering.test.ts` so both new provider calls must import and call
`openAIUsageEvents` and `recordUsage`.

- [ ] **Step 2: Write failing processor state-machine tests**

Use an in-memory `RecollectRepository` fake. Cover:

1. no claim returns `{ status: "idle" }` without provider calls;
2. a nonfinal segment appends validated extraction candidates and requeues the
   next segment;
3. the final segment runs compact validation and completes with zero accepted
   candidates when the note is irrelevant;
4. a duplicate decision adds provenance and increments source frequency rather
   than inserting another item;
5. a provider exception schedules bounded retry with no stored item;
6. a disabled preference detected before persistence discards in-flight output;
7. a deleted or changed source cannot receive stale candidates.

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
npm run test:journal
npm run test:costs
```

- [ ] **Step 4: Implement the server-only admin client**

`src/lib/supabase/admin.ts` begins with:

```ts
import "server-only";
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service configuration is missing");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

No client component may import this file.

- [ ] **Step 5: Implement the repository boundary**

Define:

```ts
export interface RecollectRepository {
  claim(ownerId: string): Promise<ClaimedRecollectJob | null>;
  requeueSegment(jobId: string, nextSegment: number, buffer: ExtractedCandidate[]): Promise<void>;
  completeEmpty(jobId: string): Promise<void>;
  completeAccepted(job: ClaimedRecollectJob, items: ValidatedCandidate[]): Promise<void>;
  fail(jobId: string, attempt: number, message: string): Promise<void>;
  isEnabled(ownerId: string): Promise<boolean>;
  existingByTopics(ownerId: string, topicKeys: string[]): Promise<ExistingRecollectItem[]>;
}
```

The Supabase implementation calls `claim_recollect_job`, limits errors to 500
characters, uses retry delays of 1, 5, and 30 minutes, and marks the fourth
failed attempt permanently failed. Final persistence delegates to
`complete_recollect_job`; it must not approximate that transaction with
multiple independent PostgREST writes.

- [ ] **Step 6: Implement conservative OpenAI calls**

Extraction sends only one bounded segment. It asks for at most three candidates
and explicitly names the accepted categories and rejection examples.

Validation receives:

- short extracted candidates and their evidence;
- at most twenty existing owner-scoped reminders sharing proposed topic keys;
- no full historical transcript.

It returns decisions shaped as:

```ts
type ValidationDecision =
  | { candidate_id: string; decision: "accept"; duplicate_of: null }
  | { candidate_id: string; decision: "duplicate"; duplicate_of: string }
  | { candidate_id: string; decision: "reject"; duplicate_of: null };
```

After every successful provider response:

```ts
await recordUsage(openAIUsageEvents({
  usage: data.usage,
  model: RECOLLECT_MODEL,
  operation: "recollect_extraction",
  idempotencyKey: `openai:${String(data.id)}:recollect-extraction:${segment.index}`,
}));
```

Use the analogous validation operation. Do not include source identifiers in
cost metadata.

- [ ] **Step 7: Implement one bounded processor invocation**

`processNextRecollectJob`:

1. claims one owner job;
2. verifies Recollect is still enabled and source hash/version still match;
3. deterministically rebuilds segments from the current transcript;
4. extracts only `segments[job.nextSegment]`;
5. if more segments remain, appends the buffer and requeues;
6. on the final segment, validates the compact combined candidates against
   same-topic existing items;
7. inserts or merges accepted items and provenance transactionally;
8. records zero accepted candidates as complete;
9. converts provider and parse failures into bounded retry state.

The processor never stores evidence text or raw source text in Recollect tables.

- [ ] **Step 8: Verify GREEN**

Run:

```bash
npm run test:journal
npm run test:costs
npm run lint
```

- [ ] **Step 9: Commit**

```bash
git add src/lib/supabase/admin.ts src/lib/recollect src/lib/costs/routeMetering.test.ts
git commit -m "feat: process Recollect sources conservatively"
```

---

### Task 4: Enqueue after Journal save and resume safely

**Files:**
- Create: `src/app/api/recollect/process/route.ts`
- Create: `src/lib/recollect/routeWiring.test.ts`
- Modify: `src/app/api/lesson/route.ts`

**Interfaces:**
- Produces `enqueueRecollectSource(ownerId: string, lessonId: string, firstDueAt?: string): Promise<boolean>`.
- `POST /api/recollect/process` authenticates the caller and runs one bounded
  `processNextRecollectJob(user.id)`.

- [ ] **Step 1: Write failing route-wiring tests**

Read both route files as source and assert:

```ts
assert.match(lessonRoute, /import \{ after \} from "next\/server"/);
assert.match(lessonRoute, /enqueueRecollectSource/);
assert.match(lessonRoute, /after\(async \(\) =>/);
assert.match(processRoute, /await supabase\.auth\.getUser\(\)/);
assert.match(processRoute, /processNextRecollectJob\(user\.id/);
assert.match(processRoute, /export const maxDuration = 60/);
```

- [ ] **Step 2: Run and verify RED**

Run `npm run test:journal`.

- [ ] **Step 3: Implement durable enqueue**

Add `enqueueRecollectSource` to `repository.ts`. It:

- calls the service-only `enqueue_recollect_source` RPC after the API route has
  authenticated the owner;
- lets the RPC load the owner-controlled lesson and reject unsupported kinds;
- lets the RPC treat a missing preference row as enabled;
- lets the RPC compute SHA-256 over the complete transcript;
- lets the RPC atomically remove stale provenance after a content change and
  insert the current job keyed by lesson, hash, and processor version;
- sets normal first due time to `created_at + 24 hours`;
- does not insert a historical job merely because the feature was deployed.

- [ ] **Step 4: Wire all successful lesson-save exits**

Refactor `/api/lesson` so newly created short/plain, off-topic, successfully
summarized, and summary-failed entries all durably enqueue Recollect after the
original lesson row exists. Retry-only summary requests must not create a
second job for an unchanged content hash.

After enqueue succeeds, start one bounded segment without delaying the response:

```ts
after(async () => {
  await processNextRecollectJob(user.id);
});
```

Next.js documents that `after()` runs after the response but only within the
route's configured duration. The durable job, not `after()`, is the reliability
mechanism:
[Next.js `after` reference](https://nextjs.org/docs/app/api-reference/functions/after).

- [ ] **Step 5: Implement authenticated resume**

`POST /api/recollect/process`:

- returns 401 without a verified user;
- accepts no owner or lesson identifier from the client;
- processes at most one job segment;
- returns `{ status, pending }`;
- returns 503 with a generic message when provider configuration is absent;
- leaves the durable job retryable on timeout or provider failure.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm run test:journal
npm run test:costs
npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/app/api/lesson/route.ts src/app/api/recollect/process/route.ts src/lib/recollect
git commit -m "feat: enqueue Recollect from Journal saves"
```

---

### Task 5: Card read and action API

**Files:**
- Create: `src/app/api/recollect/route.ts`
- Create: `src/lib/recollect/actions.test.ts`
- Modify: `src/lib/recollect/repository.ts`
- Modify: `src/lib/recollect/types.ts`

**Interfaces:**
- `GET /api/recollect` returns `RecollectView`.
- `POST /api/recollect` accepts the discriminated `RecollectAction`.
- Produces `loadRecollectView(ownerId: string, now?: Date): Promise<RecollectView>`.

- [ ] **Step 1: Define and test the API contract**

Use:

```ts
export interface RecollectCardFront {
  id: string;
  question: string;
  topic: string;
  source: {
    lessonId: string;
    kind: "lesson" | "practice";
    createdAt: string;
    title: string | null;
  };
}

export interface RecollectView {
  enabled: boolean;
  noticeSeen: boolean;
  processing: boolean;
  cards: RecollectCardFront[];
}

export type RecollectAction =
  | { action: "reveal"; itemId: string; reviewKey: string }
  | { action: "dismiss"; itemId: string }
  | { action: "add_to_working_on"; itemId: string }
  | { action: "acknowledge_notice" };
```

Tests must assert that the initial card type has no `cue` property, reveal
returns the cue, and malformed UUIDs are rejected before a database call.

- [ ] **Step 2: Run and verify RED**

Run `npm run test:journal`.

- [ ] **Step 3: Implement the read path**

Authenticate with the cookie-backed Supabase client. Use the service client
only after obtaining `user.id`.

Treat no preference row as enabled. Load at most thirty due active items,
excluding active Working On links, then call `selectDueRecollectItems(..., 3)`.
Return only card fronts. Include `processing=true` while this owner has queued
or processing jobs.

- [ ] **Step 4: Implement reveal and dismissal**

Reveal validates `itemId` and `reviewKey` as UUIDs, then calls
`reveal_recollect_item`. Return:

```json
{
  "cue": "Keep the racket high and meet the ball early over the table.",
  "source": {
    "lessonId": "...",
    "kind": "lesson",
    "createdAt": "...",
    "title": "Backhand timing"
  }
}
```

Dismiss updates only an owner-owned active item to `dismissed`, clears its
Working On link if any, and returns `{ "dismissed": true }`. An unchanged
completed source job prevents the dismissed reminder from being regenerated.

- [ ] **Step 5: Implement Working On and notice actions**

`add_to_working_on` delegates to the atomic RPC and returns its
`added|duplicate|full` result.

`acknowledge_notice` upserts `notice_seen_at` without changing an explicit
disabled preference.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm run test:journal
npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/app/api/recollect/route.ts src/lib/recollect
git commit -m "feat: expose Recollect cards and actions"
```

---

### Task 6: Recollect Journal UI

**Files:**
- Create: `src/app/journal/Recollect.tsx`
- Create: `src/lib/recollect/recollectView.test.ts`
- Modify: `src/app/journal/NotesFeed.tsx`
- Modify: `src/app/journal/LessonCard.tsx`

**Interfaces:**
- Produces `<Recollect onWorkingOnChanged={() => void} onOpenSource={(source) => void} />`.
- `NotesFeed.Section` gains `"recollect"`.

- [ ] **Step 1: Write failing static and state contracts**

The source-level test asserts:

```ts
assert.match(notesFeed, /"recollect"/);
assert.match(notesFeed, /sectionTab\("recollect", "Recollect"\)/);
assert.match(recollect, /Tap to reveal/);
assert.match(recollect, /Not useful/);
assert.match(recollect, /Working On/);
assert.doesNotMatch(recollect, />\s*AI\s*</i);
```

Add pure reducer tests for:

- one card revealing without revealing siblings;
- the same card reusing one `reviewKey`;
- `added`, `duplicate`, and `full` Working On states;
- dismissing a card locally;
- processing with zero cards showing the processing state;
- no due cards showing the calm empty state.

- [ ] **Step 2: Run and verify RED**

Run `npm run test:journal`.

- [ ] **Step 3: Add the enabled tab and load behavior**

Change:

```ts
type Section = "all" | "matches" | "lessons" | "practice" | "recollect";
```

Fetch Recollect state once with the other Journal data. Show the tab whenever
`enabled` is true, including when the ordinary Journal feed is empty. Keep the
tab row horizontally scrollable with `overflow-x-auto` and `whitespace-nowrap`.

When Recollect becomes active and `processing` is true, call
`POST /api/recollect/process` sequentially, refetch state, and stop when
`pending` is false or the component unmounts. Never run concurrent process
requests.

- [ ] **Step 4: Implement card front and reveal**

The whole card front is a button with a visible focus state. On tap:

1. reuse or create one `crypto.randomUUID()` review key for that card;
2. post `action: "reveal"`;
3. keep the returned cue visible for the current view;
4. do not refetch and remove the card until the user leaves or explicitly
   dismisses it.

Use source type/date/topic metadata exactly as the approved mockup. Do not show
confidence, model, scoring, or grading language.

- [ ] **Step 5: Implement revealed actions**

`+ Working On` posts the action and becomes `Added` after success. On `full`,
show the existing five-active-items limit in one quiet inline sentence.

A compact overflow menu exposes only `Not useful`. Confirming is not required;
the action is reversible only by editing the source content and reprocessing,
so keep the menu label unambiguous.

The source link asks `NotesFeed` to switch to the correct lesson/practice tab,
clears search/tag filters, and scrolls to `id="journal-entry-<lessonId>"`.
Add that stable ID to the LessonCard wrapper.

- [ ] **Step 6: Match approved responsive treatment**

Desktop uses full `+ Working On`; narrow mobile uses `+ Add`. Cards remain one
column, source text truncates before the action, and the Recollect tabs do not
compress below readable touch targets.

Hide the ordinary search, tag rail, and Working On panel while the Recollect
tab is active. The reminders themselves retain the direct Working On action.

- [ ] **Step 7: Implement notice and empty states**

Show the one-time quiet notice above Recollect content and post
`acknowledge_notice` after it is displayed. Copy:

```text
Recollect is on. It turns your lesson and practice notes into private
reminders. Manage this in Account.
```

Processing copy:

```text
Finding useful things from your lessons and practice notes…
```

Empty copy:

```text
Nothing to revisit right now.
Useful coaching points will return here over time.
```

- [ ] **Step 8: Verify GREEN and inspect both breakpoints**

Run:

```bash
npm run test:journal
npm run lint
npm run dev
```

Using the signed-in browser, inspect `/journal` at approximately 390 px and
1280 px widths. Verify keyboard reveal, horizontal tab scrolling, no clipped
actions, empty state, revealed state, and source navigation.

- [ ] **Step 9: Commit**

```bash
git add src/app/journal src/lib/recollect
git commit -m "feat: add the Recollect Journal experience"
```

---

### Task 7: Default-on Account preference and deletion

**Files:**
- Create: `src/app/api/recollect/settings/route.ts`
- Create: `src/app/account/RecollectSetting.tsx`
- Create: `src/lib/recollect/settings.test.ts`
- Modify: `src/app/account/page.tsx`
- Modify: `src/app/journal/NotesFeed.tsx`

**Interfaces:**
- `GET /api/recollect/settings` returns `{ enabled: boolean }`.
- `POST /api/recollect/settings` consumes `{ enabled: boolean }`.
- Produces `<RecollectSetting initialEnabled={boolean} />`.

- [ ] **Step 1: Write failing setting contracts**

Tests cover:

- a missing preference resolves to true;
- request bodies other than an exact boolean return 400;
- the route authenticates before using the service client;
- disabling calls `set_recollect_enabled` and never deletes from `lessons`;
- enabling after explicit opt-out queues existing eligible entries;
- the Account copy says the feature uses lesson and practice notes.

- [ ] **Step 2: Run and verify RED**

Run `npm run test:journal`.

- [ ] **Step 3: Implement authenticated settings route**

The route first calls `supabase.auth.getUser()`. It passes only the verified
`user.id` and exact boolean to `set_recollect_enabled`.

On disable, return success only after derived deletion completes. On enable,
return the queued source count from the RPC. A failed call restores the
previous UI toggle and shows `Couldn't update Recollect. Try again.`

- [ ] **Step 4: Add Account Preferences**

Insert a `Preferences` group after `Your game`, using the existing card and
section-label style:

```text
Recollect
Surface useful reminders from my lesson and practice notes.
```

Use a native checkbox with switch styling, an accessible label, visible focus,
and optimistic state that rolls back on failure.

- [ ] **Step 5: Keep Journal state consistent**

When Journal's initial Recollect read reports disabled, do not render the tab.
If a stale URL or state requests the section, fall back to `all`.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm run test:journal
npm run lint
```

Manually verify that disabling removes the tab after returning to Journal and
that original lessons remain visible.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/recollect/settings src/app/account src/app/journal/NotesFeed.tsx src/lib/recollect
git commit -m "feat: add the Recollect account preference"
```

---

### Task 8: Admin Recollect cost attribution

**Files:**
- Modify: `src/app/admin/costDashboardView.ts`
- Modify: `src/app/admin/costDashboardView.test.ts`
- Modify: `src/app/admin/CostDashboardSection.tsx`

**Interfaces:**
- Produces `buildOperationCostRows(data: CostDashboardData): OperationCostRow[]`.
- Recollect rows are labeled `Recollect extraction` and
  `Recollect quality check`.

- [ ] **Step 1: Write the failing operation-rollup test**

Construct input rows for extraction input/output tokens and validation input
tokens. Assert:

```ts
assert.deepEqual(buildOperationCostRows(data), [
  {
    provider: "OpenAI",
    operation: "recollect_extraction",
    label: "Recollect extraction",
    costUsd: 0.012,
    usageSummary: ["30K input tokens", "2K output tokens"],
  },
  {
    provider: "OpenAI",
    operation: "recollect_validation",
    label: "Recollect quality check",
    costUsd: 0.003,
    usageSummary: ["8K input tokens"],
  },
]);
```

Also assert the builder includes other operations generically instead of
hard-coding a Recollect-only table.

- [ ] **Step 2: Run and verify RED**

Run `npm run test:costs`.

- [ ] **Step 3: Implement operation grouping**

Group `data.usage` by `(provider, operation)`, sum cost, aggregate units, map
the two Recollect labels, humanize unknown snake-case operations, and sort by
cost descending.

Do not change aggregate provider totals or reconciliation logic.

- [ ] **Step 4: Render the feature breakdown**

Add a responsive `Feature operations` table/card beneath Vendor breakdown with:

- feature/operation label;
- provider;
- measured usage;
- estimated cost.

This uses existing dashboard RPC data; no database migration is required.
Recollect extraction and validation therefore appear independently as soon as
their first metered events arrive.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm run test:costs
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/app/admin
git commit -m "feat: show feature operations in cost management"
```

---

### Task 9: Correct Privacy Policy and Terms

**Files:**
- Create: `src/lib/recollect/legalCopy.test.ts`
- Modify: `src/app/privacy/page.tsx`
- Modify: `src/app/terms/page.tsx`

**Interfaces:**
- Legal pages accurately describe current OpenAI processing as well as
  Recollect.

- [ ] **Step 1: Write failing legal-copy contracts**

Read both pages as source and assert:

```ts
assert.doesNotMatch(privacy, /No other external analysis provider receives your content/);
assert.match(privacy, /OpenAI/);
assert.match(privacy, /Recollect/);
assert.match(privacy, /lesson and practice notes/i);
assert.match(privacy, /turn Recollect off/i);
assert.match(privacy, /not used to train/i);
assert.match(terms, /automated/i);
assert.match(terms, /incomplete or inaccurate/i);
assert.match(terms, /not a substitute for professional coaching/i);
```

- [ ] **Step 2: Run and verify RED**

Run `npm run test:journal`.

- [ ] **Step 3: Correct the Privacy Policy**

Update the effective date and:

- add lesson/practice entries, images, takeaways, and Recollect reminders to
  collected/derived data;
- replace the inaccurate Deepgram-only external-processing statement;
- name OpenAI and the purposes for OCR, image checks, feedback assistance,
  lesson summaries, and Recollect;
- explain that Recollect is on by default and can be disabled in Account;
- explain that disabling deletes generated prompts, cues, and scheduling state
  but not original notes;
- state that OpenAI API data is not used for model training by default unless
  PongLens opts in, and that provider abuse-monitoring logs may be retained for
  up to 30 days under the current API policy;
- distinguish persistent match voice audio from ephemeral Journal dictation;
- retain deletion, rights, security, and contact language.

- [ ] **Step 4: Correct the Terms**

Update the effective date and:

- describe Journal summaries, takeaways, and Recollect reminders;
- add OpenAI to subprocessors;
- extend the limited processing license only as needed to provide those
  features;
- preserve user ownership of original content;
- explain that automated output may be incomplete or inaccurate;
- state that Recollect is a training aid, not professional coaching, medical,
  or safety advice.

Do not market Recollect as AI in the product-facing short description; the
legal disclosure must still plainly describe automated processing.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm run test:journal
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/app/privacy/page.tsx src/app/terms/page.tsx src/lib/recollect/legalCopy.test.ts
git commit -m "docs: disclose Recollect data processing"
```

---

### Task 10: Apply, seed only Jonathan lessons, and verify end to end

**Files:**
- No new source files expected.
- Database mutation: apply `057_recollect.sql` through the connected Supabase
  project after repository verification.

**Interfaces:**
- Exactly two verified owner lessons with Jonathan receive historical jobs.
- Every future eligible save enqueues normally.

- [ ] **Step 1: Run the complete local verification gate**

Run:

```bash
npm run test:auth
npm run test:learn
npm run test:match-structure
npm run test:costs
npm run test:placement
npm run test:research
npm run test:journal
npm run lint
npm run build
worker/venv/bin/python -m unittest discover -s worker/tests -q
git diff --check
```

Expected: every command passes before database mutation.

- [ ] **Step 2: Apply migration 057**

Use the Supabase MCP migration tool against the PongLens project. Then verify
the tables, indexes, RLS flags, grants, and function definitions with read-only
queries.

- [ ] **Step 3: Resolve the two Jonathan sources read-only**

Query owner-scoped lesson candidates with identifiers, creation dates, title,
and a short preview:

```sql
select
  l.id,
  l.user_id,
  l.created_at,
  l.takeaways ->> 'title' as title,
  left(regexp_replace(l.transcript, '\s+', ' ', 'g'), 180) as preview
from public.lessons l
where l.kind = 'lesson'
order by l.created_at desc;
```

Identify the product owner's account and exactly two Jonathan lessons from
their contents and metadata. If more or fewer than two records are
unambiguously identifiable, stop before writing and ask the user for the exact
records.

- [ ] **Step 4: Seed exactly those two jobs**

For the two verified UUIDs only, call `enqueue_recollect_source` with:

- the current processor version;
- `p_first_due_at=now()`.

Run a read query proving that no other preexisting lesson has a Recollect job.

- [ ] **Step 5: Trigger and inspect processing**

Open the signed-in Recollect tab. Let its bounded processing calls finish both
jobs. Verify:

- both source jobs become `complete`;
- zero-result sources remain successful if applicable;
- stored reminders contain no evidence text or raw transcript duplicate;
- every item has one of the two source IDs;
- no more than three due cards are returned;
- sources and Working On behavior work in the UI.

- [ ] **Step 6: Verify cost management**

After successful provider calls, query aggregate cost usage:

```sql
select operation, sku, unit, sum(quantity) as quantity
from public.cost_usage_events
where operation in ('recollect_extraction', 'recollect_validation')
group by operation, sku, unit
order by operation, unit;
```

Confirm both operations use `gpt-5-mini`, have priced token units, contain no
identifying metadata, and appear separately under Admin → Platform costs →
Feature operations. Confirm OpenAI provider reconciliation remains healthy.

- [ ] **Step 7: Verify privacy deletion on a disposable test user**

Using a fake test account, create a Recollect item, disable the setting, and
confirm:

- the preference remains with `enabled=false`;
- jobs, items, and provenance are gone;
- the original lesson remains;
- no new output from an in-flight job appears.

Do not perform this destructive toggle on the product owner's account.

- [ ] **Step 8: Push the reviewed commits to main and inspect deployment**

Confirm `git status --short` contains no unrelated files. Push `main`, wait for
the automatic Vercel deployment, and verify the production deployment reaches
Ready before reporting completion.

- [ ] **Step 9: Final smoke test**

On the deployed app:

- open Recollect at desktop and mobile widths;
- reveal one card once and confirm its schedule advances once;
- add a disposable reminder to Working On and confirm it pauses;
- dismiss a disposable reminder and confirm it does not return;
- confirm the Account toggle and legal pages;
- confirm the two Jonathan lessons are the only historical seed.
