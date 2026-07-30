# Late Placement Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner request normal placement generation from the Tools menu for a match uploaded without placement, then offer one stronger retry if normal generation fails, while retaining raw uploads for 30 days.

**Architecture:** Add an atomic `placement_generate` queue path beside the existing `placement_retry` path. Both use shared placement-only reconstruction and consistency verification, but normal generation is deterministic-only and does not consume the retry count. Lift client lifecycle control into one hook shared by a Tools-row sheet and informational bottom/point surfaces.

**Tech Stack:** PostgreSQL/Supabase RPC and RLS, Next.js 15 App Router, React 19, TypeScript, Python 3 worker, pgmq, OpenCV/BlurBall, Cloudflare R2, Resend, Node test runner, Python `unittest`.

## Global Constraints

- Raw-upload retention and placement eligibility are exactly 30 days from the original source job's `created_at`.
- A late opt-in receives one normal deterministic attempt and at most one stronger vision-assisted retry.
- Only the stronger retry may call OpenAI vision.
- Placement jobs may mutate only `points.placement`, placement data in `match.json`, and match placement lifecycle fields.
- Point IDs, ranges, clips, scores, notes, tags, match metadata, and non-placement JSON must remain unchanged.
- Placement actions are owner-only and originate from atomic database RPCs.
- The only placement CTA appears in the Tools-row sheet; bottom and point surfaces are informational.
- Existing UI styling must use `TOOL_ROW_CLASS`, the current sheet conventions, current status-card tones, and current typography.
- Pre-rollout `not_requested` rows are made eligible only when their source job is at most seven days old at migration time.
- Expected calibration inability is a terminal queue outcome, never a poison error.
- Public Privacy Policy, Terms, homepage, Learn guidance, API/UI copy, and operator docs must all promise the same 30-day raw retention.
- No new runtime dependency is permitted.

---

### Task 1: Database Lifecycle, Atomic Generation RPC, and Shared Types

**Files:**
- Create: `supabase/migrations/055_late_placement_generation.sql`
- Create: `src/lib/placement/placementGenerationMigration.test.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/placement/placementRetry.ts`
- Modify: `src/lib/placement/placementRetry.test.ts`
- Modify: `src/lib/placement/placementRetryView.test.ts`

**Interfaces:**
- Consumes: existing `matches` placement lifecycle from migration 049 and `jobs_enqueue` trigger behavior.
- Produces: `matches.placement_generation_job_id`, RPC `request_placement_generation(uuid)`, 30-day source deadlines, and `placementLifecycleView()`.

- [ ] **Step 1: Write the failing migration tests**

Create `placementGenerationMigration.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/055_late_placement_generation.sql",
    import.meta.url,
  ),
  "utf8",
);

test("late placement migration adds an exact generation job reference", () => {
  assert.match(sql, /placement_generation_job_id uuid references public\.jobs/);
  assert.match(sql, /create or replace function public\.request_placement_generation/);
  assert.match(sql, /values \(auth\.uid\(\), 'placement_generate'/);
  assert.match(sql, /placement_generation_job_id = v_job_id/);
});

test("generation enqueue is owner checked, locked, one-time, and atomic", () => {
  assert.match(sql, /auth\.uid\(\) is null/);
  assert.match(sql, /for update/);
  assert.match(sql, /v_match\.user_id <> auth\.uid\(\)/);
  assert.match(sql, /v_match\.status <> 'ready'/);
  assert.match(sql, /v_match\.placement_status <> 'not_requested'/);
  assert.match(sql, /v_match\.placement_retry_count <> 0/);
  assert.match(sql, /v_match\.placement_generation_job_id is not null/);
  assert.match(sql, /placement_retry_expires_at <= now\(\)/);
});

test("only reliably retained legacy rows receive a 30-day deadline", () => {
  assert.match(sql, /j\.created_at \+ interval '30 days'/);
  assert.match(sql, /j\.created_at >= now\(\) - interval '7 days'/);
  assert.match(sql, /m\.placement_status = 'not_requested'/);
  assert.doesNotMatch(sql, /where m\.placement_status = 'final_failed'/);
});
```

- [ ] **Step 2: Run the migration test and confirm RED**

Run:

```bash
node --test --experimental-strip-types \
  src/lib/placement/placementGenerationMigration.test.ts
```

Expected: FAIL because migration 055 does not exist.

- [ ] **Step 3: Write migration 055**

Create `055_late_placement_generation.sql` with:

```sql
alter table public.matches
  add column placement_generation_job_id uuid references public.jobs(id)
    on delete set null;

update public.matches m
set placement_retry_expires_at = j.created_at + interval '30 days'
from public.jobs j
where j.id = m.job_id
  and m.placement_status = 'not_requested'
  and m.placement_retry_count = 0
  and m.placement_generation_job_id is null
  and j.created_at >= now() - interval '7 days';

update public.matches m
set placement_retry_expires_at = j.created_at + interval '30 days'
from public.jobs j
where j.id = m.job_id
  and m.placement_status = 'retry_available'
  and m.placement_retry_count = 0
  and j.created_at >= now() - interval '7 days';

create or replace function public.request_placement_generation(
  p_match_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_job_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'match not found' using errcode = 'P0002';
  end if;
  if v_match.user_id <> auth.uid() then
    raise exception 'not owner' using errcode = '42501';
  end if;
  if v_match.status <> 'ready' then
    raise exception 'match is not ready' using errcode = 'P0001';
  end if;
  if v_match.placement_status = 'processing'
     or v_match.placement_generation_job_id is not null then
    raise exception 'placement generation already queued'
      using errcode = 'P0001';
  end if;
  if v_match.placement_status <> 'not_requested' then
    raise exception 'placement generation unavailable'
      using errcode = 'P0001';
  end if;
  if v_match.placement_retry_count <> 0 then
    raise exception 'placement generation already used'
      using errcode = '23514';
  end if;
  if v_match.placement_retry_expires_at is null
     or v_match.placement_retry_expires_at <= now() then
    update public.matches
    set placement_failure_code = 'source_expired'
    where id = p_match_id;
    return null;
  end if;

  insert into public.jobs (
    user_id, kind, status, input_path, original_name, options
  )
  values (
    auth.uid(), 'placement_generate', 'queued', null,
    'Placement generation', jsonb_build_object('match_id', p_match_id)
  )
  returning id into v_job_id;

  update public.matches
  set placement_status = 'processing',
      placement_generation_job_id = v_job_id,
      placement_failure_code = null
  where id = p_match_id;

  return v_job_id;
end;
$$;

revoke all on function public.request_placement_generation(uuid)
  from public, anon;
grant execute on function public.request_placement_generation(uuid)
  to authenticated;
```

Keep the existing retry RPC, but replace its seven-day assumptions in
comments with the shared 30-day source deadline. Do not let it accept
`not_requested`.

- [ ] **Step 4: Run the migration tests and confirm GREEN**

Run:

```bash
node --test --experimental-strip-types \
  src/lib/placement/placementGenerationMigration.test.ts \
  src/lib/placement/placementRetryMigration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing lifecycle-view tests**

Extend `placementRetryView.test.ts` to import
`placementLifecycleView` and assert:

```ts
test("live not-requested placement offers normal generation", () => {
  assert.deepEqual(
    placementLifecycleView("not_requested", 0, future, now),
    {
      tone: "muted",
      toolStatus: "Generate",
      sheetTitle: "Generate placement maps?",
      sheetBody:
        "We'll analyze the original recording and generate placement maps "
        + "without changing your points, clips, score, or notes.",
      noticeTitle: "Placement maps haven't been generated",
      noticeBody:
        "You can request placement maps from Tools while the original "
        + "recording is available.",
      actionKind: "generate",
      actionLabel: "Generate placement maps",
      poll: false,
      showAggregate: false,
    },
  );
});

test("expired not-requested placement has no action", () => {
  const view = placementLifecycleView(
    "not_requested",
    0,
    "2026-07-28T12:00:00Z",
    now,
  );
  assert.equal(view.toolStatus, "Unavailable");
  assert.equal(view.actionKind, null);
  assert.match(view.noticeBody ?? "", /original recording is no longer available/i);
});

test("normal processing and stronger retry have distinct copy", () => {
  assert.equal(
    placementLifecycleView("processing", 0, future, now).toolStatus,
    "Generating…",
  );
  assert.match(
    placementLifecycleView("processing", 0, future, now).sheetBody,
    /normal placement analysis/i,
  );
  assert.equal(
    placementLifecycleView("retrying", 1, future, now).toolStatus,
    "Retrying…",
  );
  assert.match(
    placementLifecycleView("retrying", 1, future, now).sheetBody,
    /stronger table-calibration/i,
  );
});

test("ready placement renders the aggregate", () => {
  const view = placementLifecycleView("ready", 0, null, now);
  assert.equal(view.toolStatus, "Ready");
  assert.equal(view.showAggregate, true);
  assert.equal(view.noticeBody, null);
});
```

Extend `placementRetry.test.ts` so a pure
`placementActionAvailability()` returns:

```ts
const expired = "2026-07-28T12:00:00Z";

assert.equal(
  placementActionAvailability("not_requested", 0, future, now),
  "generate",
);
assert.equal(
  placementActionAvailability("retry_available", 0, future, now),
  "retry",
);
assert.equal(
  placementActionAvailability("not_requested", 0, expired, now),
  "expired",
);
```

- [ ] **Step 6: Run the lifecycle tests and confirm RED**

Run:

```bash
node --test --experimental-strip-types \
  src/lib/placement/placementRetry.test.ts \
  src/lib/placement/placementRetryView.test.ts
```

Expected: FAIL because the generic lifecycle exports do not exist.

- [ ] **Step 7: Implement shared TypeScript lifecycle types**

Add `placement_generation_job_id: string | null` to `Match`.

In `placementRetry.ts`, export:

```ts
export type PlacementActionAvailability =
  | "generate"
  | "retry"
  | "expired"
  | "already_processing"
  | "used"
  | "unavailable";

export type PlacementActionKind = "generate" | "retry";

export interface PlacementLifecycleView {
  tone: "warning" | "progress" | "muted";
  toolStatus: "Generate" | "Generating…" | "Try again" | "Retrying…"
    | "Ready" | "Unavailable";
  sheetTitle: string;
  sheetBody: string;
  noticeTitle: string | null;
  noticeBody: string | null;
  actionKind: PlacementActionKind | null;
  actionLabel: string | null;
  poll: boolean;
  showAggregate: boolean;
}
```

Implement:

```ts
export function placementActionAvailability(
  status: MatchPlacementStatus,
  retryCount: number,
  expiresAt: string | null,
  now = new Date(),
): PlacementActionAvailability
```

and:

```ts
export function placementLifecycleView(
  status: MatchPlacementStatus,
  retryCount: number,
  expiresAt: string | null,
  now = new Date(),
): PlacementLifecycleView
```

Use the exact strings asserted in Step 5. Preserve the existing retry copy
for `retry_available`, `retrying`, and `final_failed`. Replace old
`placementRetryView` callers in later tasks; do not maintain two independent
copy sources.

- [ ] **Step 8: Run all placement tests and commit**

Run:

```bash
npm run test:placement
git diff --check
```

Expected: all placement tests PASS.

Commit:

```bash
git add supabase/migrations/055_late_placement_generation.sql \
  src/lib/types.ts src/lib/placement/placementRetry.ts \
  src/lib/placement/placementRetry.test.ts \
  src/lib/placement/placementRetryView.test.ts \
  src/lib/placement/placementGenerationMigration.test.ts
git commit -m "feat: add late placement generation lifecycle"
```

---

### Task 2: Authenticated Late-Generation API

**Files:**
- Create: `src/app/api/placement-generate/route.ts`
- Create: `src/lib/placement/placementGenerateApi.test.ts`
- Modify: `src/lib/placement/placementRetry.ts`

**Interfaces:**
- Consumes: `request_placement_generation(p_match_id)` from Task 1.
- Produces: `POST /api/placement-generate` returning queued job IDs or stable error codes.

- [ ] **Step 1: Write failing stable-error tests**

Add to the pure helper module:

```ts
test("generation database errors become stable API codes", () => {
  assert.deepEqual(
    placementGenerationError({
      code: "P0001",
      message: "placement generation already queued",
    }),
    { status: 409, code: "generation_already_processing" },
  );
  assert.deepEqual(
    placementGenerationError({
      code: "P0001",
      message: "placement generation unavailable",
    }),
    { status: 409, code: "generation_unavailable" },
  );
  assert.deepEqual(
    placementGenerationError({ code: "42501", message: "not owner" }),
    { status: 403, code: "not_owner" },
  );
});
```

Create `placementGenerateApi.test.ts` to statically verify the route:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../app/api/placement-generate/route.ts", import.meta.url),
  "utf8",
);

test("late generation route authenticates and delegates to the atomic RPC", () => {
  assert.match(source, /auth\.getUser\(\)/);
  assert.match(source, /request_placement_generation/);
  assert.match(source, /p_match_id: matchId/);
  assert.doesNotMatch(source, /\.from\\(["']matches["']\\).*\.update/s);
});
```

- [ ] **Step 2: Run the API tests and confirm RED**

Run:

```bash
node --test --experimental-strip-types \
  src/lib/placement/placementGenerateApi.test.ts \
  src/lib/placement/placementRetry.test.ts
```

Expected: FAIL because the route and error mapper do not exist.

- [ ] **Step 3: Implement the error mapper and route**

Export:

```ts
export function placementGenerationError(error: {
  code?: string;
  message?: string;
}): { status: number; code: string }
```

Map `P0002`, `42501`, explicit already-queued `P0001`, unavailable `P0001`,
`23514`, and the fallback to:

```text
match_not_found
not_owner
generation_already_processing
generation_unavailable
generation_already_used
queue_failed
```

Create the route by following the authenticated UUID-validation structure of
`/api/placement-retry`. Call:

```ts
const { data, error } = await supabase.rpc(
  "request_placement_generation",
  { p_match_id: matchId },
);
```

Return `410 { code: "source_expired" }` when `data === null`, otherwise
`202 { status: "queued", jobId: data }`.

- [ ] **Step 4: Run API tests, lint, and commit**

Run:

```bash
node --test --experimental-strip-types \
  src/lib/placement/placementGenerateApi.test.ts \
  src/lib/placement/placementRetry.test.ts
npx eslint src/app/api/placement-generate/route.ts \
  src/lib/placement/placementRetry.ts
```

Expected: PASS with zero errors.

Commit:

```bash
git add src/app/api/placement-generate/route.ts \
  src/lib/placement/placementRetry.ts \
  src/lib/placement/placementRetry.test.ts \
  src/lib/placement/placementGenerateApi.test.ts
git commit -m "feat: add late placement generation API"
```

---

### Task 3: Deterministic-Only Calibration Strategy

**Files:**
- Modify: `worker/placement_retry_calibration.py`
- Modify: `worker/tests/test_placement_retry_calibration.py`

**Interfaces:**
- Consumes: existing deterministic calibration and validated vision fallback.
- Produces: `calibrate_for_retry(..., allow_vision: bool)` and CLI `--strategy deterministic|stronger`.

- [ ] **Step 1: Write failing deterministic-strategy tests**

Add:

```python
def test_normal_generation_never_calls_vision_after_deterministic_failure(self):
    vision_calls = []

    outcome = retry_calibration.calibrate_for_retry(
        self.video,
        self.blurball,
        self.workdir,
        api_key="unused",
        model="unused",
        allow_vision=False,
        deterministic_calibrator=lambda *args, **kwargs: None,
        vision_request=lambda *args, **kwargs: vision_calls.append(True),
    )

    self.assertFalse(outcome.ok)
    self.assertEqual(outcome.code, "deterministic_calibration_failed")
    self.assertEqual(vision_calls, [])

def test_stronger_strategy_still_calls_vision_after_deterministic_failure(self):
    # Reuse the existing valid proposal/rim fixtures.
    outcome = retry_calibration.calibrate_for_retry(
        self.video,
        self.blurball,
        self.workdir,
        api_key="test",
        model="test-model",
        allow_vision=True,
        deterministic_calibrator=lambda *args, **kwargs: None,
        vision_request=self.valid_vision_request,
        rim_snapper=self.valid_rim_snapper,
    )
    self.assertTrue(outcome.ok)
```

Add a CLI-source assertion that `--strategy` has choices
`deterministic,stronger`.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python \
  -m unittest worker.tests.test_placement_retry_calibration -v
```

Expected: FAIL because `allow_vision` and `--strategy` are missing.

- [ ] **Step 3: Implement the strategy gate**

Change the signature:

```python
def calibrate_for_retry(
    video_path,
    blurball_path,
    workdir,
    *,
    api_key,
    model,
    allow_vision: bool = True,
    deterministic_calibrator: Callable = calibrate,
    vision_request: Callable = request_corner_proposal,
    rim_snapper: Callable = snap_quad_to_rim,
) -> CalibrationOutcome:
```

Immediately after deterministic calibration produces no valid result:

```python
if not allow_vision:
    return CalibrationOutcome(
        ok=False,
        code="deterministic_calibration_failed",
        calibration=None,
    )
```

Add:

```python
calibrate_parser.add_argument(
    "--strategy",
    choices=("deterministic", "stronger"),
    default="stronger",
)
```

and pass:

```python
allow_vision=args.strategy == "stronger"
```

- [ ] **Step 4: Run calibration and reconstruction tests**

Run:

```bash
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python \
  -m unittest \
  worker.tests.test_placement_retry_calibration \
  worker.tests.test_placement_reconstruction -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/placement_retry_calibration.py \
  worker/tests/test_placement_retry_calibration.py
git commit -m "feat: add deterministic placement calibration mode"
```

---

### Task 4: Placement-Generate Worker Job and Outcome Emails

**Files:**
- Modify: `worker/worker.py`
- Modify: `worker/tests/test_placement_retry_job.py`
- Modify: `worker/tests/test_placement_notifications.py`

**Interfaces:**
- Consumes: migration fields/RPC from Task 1 and calibration strategies from Task 3.
- Produces: exact-job-authorized `placement_generate` processing, normal outcome emails, cost stage `placement_generate_compute`, and retry availability after normal failure.

- [ ] **Step 1: Write failing generation authorization and outcome tests**

Extend `test_placement_retry_job.py`. Add the generation record beside
`retry_record`:

```python
def generation_record(**overrides):
    record = retry_record(
        placement_status="processing",
        placement_retry_count=0,
        placement_retry_job_id=None,
        placement_generation_job_id=JOB_ID,
    )
    record.update(overrides)
    return record

class PlacementGenerationAuthorizationTests(unittest.TestCase):
    def test_rejects_job_not_recorded_as_generation_job(self):
        conn = AuthorizationConnection(
            generation_record(placement_generation_job_id=OTHER_JOB_ID)
        )
        with self.assertRaisesRegex(
            RuntimeError, "authorized generation job"
        ):
            load_placement_attempt_record(
                conn,
                JOB_ID,
                USER_ID,
                MATCH_ID,
                NORMAL_PLACEMENT_ATTEMPT,
            )
```

Refactor `PlacementRetryOutcomeTests.setUp` so its loader/calibration patches
target `load_placement_attempt_record` and `run_placement_calibration`, and
its calls use:

```python
placement_for_match(
    self.connection,
    JOB_ID,
    USER_ID,
    MATCH_ID,
    STRONGER_PLACEMENT_ATTEMPT,
)
```

Then add:

```python
class PlacementGenerationOutcomeTests(unittest.TestCase):
    def setUp(self):
        self.fixture = PlacementRetryOutcomeTests(
            "test_success_updates_only_placement_and_lifecycle"
        )
        self.fixture.setUp()
        self.connection = self.fixture.connection
        self.record = self.fixture.record
        self.mocks = self.fixture.mocks
        self.record.clear()
        self.record.update(generation_record())
        self.connection.lifecycle["placement_status"] = "processing"
        self.connection.pending_lifecycle = copy.deepcopy(
            self.connection.lifecycle
        )

    def tearDown(self):
        self.fixture.tearDown()

    def run_attempt(self):
        return placement_for_match(
            self.connection,
            JOB_ID,
            USER_ID,
            MATCH_ID,
            NORMAL_PLACEMENT_ATTEMPT,
        )

    def test_normal_success_updates_only_placement_and_lifecycle(self):
        result = self.run_attempt()
        self.assertTrue(result.succeeded)
        self.assertEqual(result.terminal_status, "ready")
        self.assertEqual(result.mapped_points, 1)
        self.assertEqual(self.connection.point_updates, [(MATCH_ID, 1)])

    def test_normal_calibration_failure_exposes_stronger_retry(self):
        self.mocks[3].return_value = {
            "ok": False,
            "code": "deterministic_calibration_failed",
            "calibration": None,
        }
        result = self.run_attempt()
        self.assertFalse(result.succeeded)
        self.assertEqual(result.terminal_status, "retry_available")
        self.assertEqual(self.connection.point_updates, [])
        self.assertEqual(
            self.connection.lifecycle["placement_status"],
            "retry_available",
        )
```

Add parallel methods to cover missing source -> `final_failed`, terminal redelivery -> no-op,
transient error -> still `processing`, poison while source live ->
`retry_available`, poison after expiry -> `final_failed`, and verification
compensation.

- [ ] **Step 2: Write failing normal-email tests**

Extend `test_placement_notifications.py`:

```python
def test_normal_generation_success_email_links_to_map(self):
    body = worker.placement_generation_email_html(
        MATCH_ID, outcome="ready"
    )
    self.assertIn("Your placement maps are ready", body)
    self.assertIn(f"/match/{MATCH_ID}#ball-map", body)

def test_normal_generation_failure_email_offers_stronger_retry(self):
    body = worker.placement_generation_email_html(
        MATCH_ID, outcome="retry_available"
    )
    self.assertIn("Placement maps need another try", body)
    self.assertIn("one stronger", body)
    self.assertIn(f"/match/{MATCH_ID}#placement-tools", body)
```

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```bash
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python \
  -m unittest \
  worker.tests.test_placement_retry_job \
  worker.tests.test_placement_notifications -v
```

Expected: FAIL because generation worker functions and emails do not exist.

- [ ] **Step 4: Generalize exact-job authorization**

Introduce:

```python
@dataclass(frozen=True)
class PlacementAttemptSpec:
    name: str
    job_field: str
    active_status: str
    expected_retry_count: int
    calibration_strategy: str
    expected_failure_status: str

NORMAL_PLACEMENT_ATTEMPT = PlacementAttemptSpec(
    name="normal",
    job_field="placement_generation_job_id",
    active_status="processing",
    expected_retry_count=0,
    calibration_strategy="deterministic",
    expected_failure_status="retry_available",
)

STRONGER_PLACEMENT_ATTEMPT = PlacementAttemptSpec(
    name="stronger",
    job_field="placement_retry_job_id",
    active_status="retrying",
    expected_retry_count=1,
    calibration_strategy="stronger",
    expected_failure_status="final_failed",
)
```

Extend the result type so stage-aware notifications do not infer state:

```python
@dataclass(frozen=True)
class PlacementRetryResult:
    match_id: str
    succeeded: bool
    mapped_points: int
    failure_code: str | None
    terminal_status: str
    already_terminal: bool = False
```

Refactor the existing retry loader into:

```python
def load_placement_attempt_record(
    conn,
    job_id: str,
    user_id: str,
    match_id: str,
    attempt: PlacementAttemptSpec,
    *,
    for_update: bool = False,
) -> dict:
```

Select both job-ID fields. Require the field named by `attempt.job_field`,
the owner, ready match, expected retry count, and either the active state or
that attempt's terminal states. Normal terminal states are
`ready,retry_available,final_failed`; stronger terminal states are
`ready,final_failed`.

- [ ] **Step 5: Generalize calibration and placement-only commit**

Rename `run_retry_calibration` to:

```python
def run_placement_calibration(
    video_path,
    blurball_path,
    workdir,
    *,
    strategy: str,
    command_runner=subprocess.run,
) -> dict:
```

Pass `--strategy`, and pass the model/API key only for `stronger`. The normal
command receives no usable OpenAI key:

```python
child_env["OPENAI_API_KEY"] = (
    (OPENAI_API_KEY or "") if strategy == "stronger" else ""
)
```

Refactor the shared compute/commit path into:

```python
def placement_for_match(
    conn,
    job_id: str,
    user_id: str,
    match_id: str,
    attempt: PlacementAttemptSpec,
    *,
    progress=None,
) -> PlacementRetryResult:
```

On expected zero-map normal outcomes, commit lifecycle
`retry_available`, mapped count `0`, and the structured failure code without
changing point placements. On expected stronger failure, commit
`final_failed`.

Keep the existing compute-before-mutation, transaction lock, match/point
snapshot comparison, R2 upload verification, and compensation behavior.

- [ ] **Step 6: Dispatch and poison-handle the new job**

Add:

```python
def process_placement_generation(conn, job_id, user_id, payload):
    options = get_job_options(conn, job_id, payload)
    match_id = require_match_id(options)
    return placement_for_match(
        conn,
        job_id,
        user_id,
        match_id,
        NORMAL_PLACEMENT_ATTEMPT,
        progress=lambda value: update_job(conn, job_id, progress=value),
    )
```

In `process_job`, before the retry branch:

```python
if kind == "placement_generate":
    update_job(conn, job_id, status="processing", progress=5, error=None)
    with COST_METER.timed_stage(
        "placement_generate_compute", attempt_key
    ):
        result = process_placement_generation(
            conn, job_id, user_id, payload
        )
    update_job(conn, job_id, status="done", progress=100)
    archive_message(conn, msg["msg_id"])
    if not result.already_terminal:
        notify_placement_generation_done(
            conn, user_id, result.match_id, result.terminal_status
        )
    return
```

Generalize poison finalization so normal poison becomes `retry_available`
while the source deadline is live, otherwise `final_failed`. Do not send the
generic admin failure email for expected normal inability.

- [ ] **Step 7: Implement stage-specific emails**

Add:

```python
def placement_generation_email_html(
    match_id: str,
    *,
    outcome: str,
) -> str:
```

Accept only `ready` and `retry_available`. Use the exact subject/body/link
contract from the spec. Add `notify_placement_generation_done` mirroring the
existing non-fatal retry notification.

- [ ] **Step 8: Run worker tests and commit**

Run:

```bash
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python \
  -m unittest \
  worker.tests.test_placement_retry_job \
  worker.tests.test_placement_retry_calibration \
  worker.tests.test_placement_notifications -v
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python \
  -m py_compile worker/worker.py worker/placement_retry_calibration.py
git diff --check
```

Expected: PASS.

Commit:

```bash
git add worker/worker.py \
  worker/tests/test_placement_retry_job.py \
  worker/tests/test_placement_notifications.py
git commit -m "feat: process late placement generation jobs"
```

---

### Task 5: Shared Client Controller, Tools Row, Sheet, and Informational Surfaces

**Files:**
- Create: `src/app/match/[id]/usePlacementLifecycle.ts`
- Create: `src/app/match/[id]/PlacementToolsRow.tsx`
- Modify: `src/app/match/[id]/PlacementStatusCard.tsx`
- Modify: `src/app/match/[id]/MatchView.tsx`
- Modify: `src/app/match/[id]/PointDetail.tsx`
- Modify: `src/app/match/[id]/PointSheet.tsx`
- Modify: `src/app/match/[id]/PlacementAggregate.tsx`
- Test: `src/lib/placement/placementRetryView.test.ts`

**Interfaces:**
- Consumes: `placementLifecycleView`, generation/retry APIs, match lifecycle fields, and current Tools/sheet styling.
- Produces: one shared controller, `Placement maps` Tools row, confirmation/status sheet, and action-free informational bottom/point states.

- [ ] **Step 1: Complete the failing pure UI-state matrix**

Add table-driven assertions:

```ts
const cases = [
  ["not_requested", 0, future, "Generate", "generate", false],
  ["processing", 0, future, "Generating…", null, true],
  ["retry_available", 0, future, "Try again", "retry", false],
  ["retrying", 1, future, "Retrying…", null, true],
  ["ready", 0, null, "Ready", null, false],
  ["final_failed", 1, null, "Unavailable", null, false],
] as const;

for (const [status, count, expiry, tool, action, poll] of cases) {
  test(`${status} produces the approved placement tools state`, () => {
    const view = placementLifecycleView(status, count, expiry, now);
    assert.equal(view.toolStatus, tool);
    assert.equal(view.actionKind, action);
    assert.equal(view.poll, poll);
  });
}
```

Run the file and confirm any missing state fails before component work.

- [ ] **Step 2: Implement the shared controller hook**

Create:

```ts
export interface PlacementLifecycleController {
  status: MatchPlacementStatus;
  retryCount: 0 | 1;
  expiresAt: string | null;
  view: PlacementLifecycleView;
  submitting: boolean;
  error: string | null;
  requestAction: () => Promise<void>;
  clearError: () => void;
}

export function usePlacementLifecycle({
  matchId,
  initialStatus,
  initialRetryCount,
  initialExpiresAt,
}: {
  matchId: string;
  initialStatus: MatchPlacementStatus;
  initialRetryCount: 0 | 1;
  initialExpiresAt: string | null;
}): PlacementLifecycleController
```

Behavior:

- synchronize incoming server props;
- derive one `placementLifecycleView`;
- choose `/api/placement-generate` for `generate` and
  `/api/placement-retry` for `retry`;
- optimistically move to `processing` or `retrying` only after `202`;
- poll the match lifecycle columns every ten seconds while `view.poll`;
- stop polling on unmount/terminal state;
- call `router.refresh()` on `ready`, `retry_available`, or `final_failed`;
- expose stable copy for source expiry, duplicate processing, used retry,
  owner/auth, and default queue errors.

The hook must be the only component performing placement POSTs or polling.

- [ ] **Step 3: Build the Tools row and sheet**

Create:

```tsx
export function PlacementToolsRow({
  controller,
  onReady,
}: {
  controller: PlacementLifecycleController;
  onReady: () => void;
})
```

Render:

```tsx
<button
  id="placement-tools"
  type="button"
  onClick={() => {
    if (controller.status === "ready") onReady();
    else setOpen(true);
  }}
  className={TOOL_ROW_CLASS}
>
  <span className="text-sm font-semibold">Placement maps</span>
  <span className="flex shrink-0 items-center gap-2">
    <span className="text-xs text-zinc-500">
      {controller.view.toolStatus}
    </span>
    <ToolRowChevron />
  </span>
</button>
```

Use a portal/fixed bottom sheet matching current rounded top corners,
`bg-surface`, `border-edge`, backdrop, Escape handling, and mobile safe-area
padding. The sheet renders `sheetTitle`, `sheetBody`, a spinner for poll
states, the action button only when `actionKind` is non-null, and an
`aria-live` error region.

- [ ] **Step 4: Make the bottom card informational only**

Change `PlacementStatusCard` props to:

```ts
{
  view: PlacementLifecycleView;
  hasDrawablePlacement: boolean;
}
```

It returns null when `hasDrawablePlacement` or `view.noticeBody` is null.
Otherwise render the existing tone styling, title, body, and spinner with no
button, API call, or polling.

- [ ] **Step 5: Integrate once in MatchView**

Call the hook once:

```ts
const placement = usePlacementLifecycle({
  matchId: match.id,
  initialStatus: match.placement_status,
  initialRetryCount: match.placement_retry_count,
  initialExpiresAt: match.placement_retry_expires_at,
});
```

Add `PlacementToolsRow` beside current Tools rows:

```tsx
<PlacementToolsRow
  controller={placement}
  onReady={() => scrollToSection(matchStatsRef)}
/>
```

At `#ball-map`, render:

```tsx
<PlacementStatusCard
  view={placement.view}
  hasDrawablePlacement={placementMappedPoints > 0}
/>
{(placement.view.showAggregate || placementMappedPoints > 0) && (
  <PlacementAggregate
    points={visiblePoints}
    userSide={userSide}
    gameIndexByPoint={gameIndexByPoint}
    serving={serving}
    labels={mapLabels}
    ownerHandedness={ownerHandedness ?? null}
  />
)}
```

Pass `placement.view.noticeBody` to desktop `PointDetail` and mobile
`PointSheet` only when the point has no drawable placement. Remove all
independent placement state and callbacks previously owned by the bottom
card.

- [ ] **Step 6: Run UI tests, lint, and build**

Run:

```bash
npm run test:placement
npx eslint \
  src/lib/placement/placementRetry.ts \
  'src/app/match/[id]/usePlacementLifecycle.ts' \
  'src/app/match/[id]/PlacementToolsRow.tsx' \
  'src/app/match/[id]/PlacementStatusCard.tsx' \
  'src/app/match/[id]/MatchView.tsx' \
  'src/app/match/[id]/PointDetail.tsx' \
  'src/app/match/[id]/PointSheet.tsx'
npm run build
```

Expected: tests and build PASS; lint has zero new errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/placement/placementRetry.ts \
  src/lib/placement/placementRetryView.test.ts \
  'src/app/match/[id]/usePlacementLifecycle.ts' \
  'src/app/match/[id]/PlacementToolsRow.tsx' \
  'src/app/match/[id]/PlacementStatusCard.tsx' \
  'src/app/match/[id]/MatchView.tsx' \
  'src/app/match/[id]/PointDetail.tsx' \
  'src/app/match/[id]/PointSheet.tsx' \
  'src/app/match/[id]/PlacementAggregate.tsx'
git commit -m "feat: request placement maps from match tools"
```

---

### Task 6: 30-Day Retention, Legal Copy, and Operator Documentation

**Files:**
- Modify: `worker/worker.py`
- Modify: `worker/README.md`
- Modify: `src/lib/r2.ts`
- Modify: `src/app/privacy/page.tsx`
- Modify: `src/app/terms/page.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/learn/guides.ts`
- Modify: `src/app/api/media-url/route.ts`
- Modify: `src/app/match/[id]/ReelBar.tsx`
- Modify: `supabase/README-SETUP.md`
- Modify: `docs/superpowers/specs/2026-07-29-placement-retry-recovery-design.md`
- Modify: `docs/superpowers/plans/2026-07-29-placement-retry-recovery.md`
- Create: `worker/tests/test_raw_retention.py`

**Interfaces:**
- Consumes: source deadline established in Task 1.
- Produces: one consistent 30-day retention policy in runtime behavior, public/legal copy, Learn/export surfaces, and operator docs.

- [ ] **Step 1: Write the failing worker retention test**

Create:

```python
import unittest
import worker.worker as worker

class RawRetentionTests(unittest.TestCase):
    def test_raw_uploads_are_retained_for_thirty_days(self):
        self.assertEqual(worker.R2_RAW_RETENTION_DAYS, 30)
```

Extend placement notification tests to assert `30 days` in the initial
failure email and no `seven days`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python \
  -m unittest \
  worker.tests.test_raw_retention \
  worker.tests.test_placement_notifications -v
```

Expected: FAIL because runtime and email copy still say seven days.

- [ ] **Step 3: Change runtime expiry and raw sweep**

Set:

```python
R2_RAW_RETENTION_DAYS = 30
```

In `finish_match`, write:

```sql
placement_retry_expires_at = case
  when %s in ('not_requested', 'retry_available') then
    (select j.created_at + interval '30 days'
     from public.jobs j where j.id = public.matches.job_id)
  when %s is not null then null
  else placement_retry_expires_at
end
```

Keep expiry normalization of `retry_available`; do not convert an expired
`not_requested` match to `final_failed`, because no attempt failed.

Change user email copy from seven to 30 days.

- [ ] **Step 4: Update all public and operator statements**

Change the live policy text to:

```text
Original uploads are deleted 30 days after upload.
```

Apply that exact period consistently in the listed files. Update raw export
copy to:

```text
The original upload is available for 30 days after upload.
```

Update worker/operator tables to:

```markdown
| Raw uploads | `ponglens-raw` | 30 days |
```

Update the prior placement retry spec/plan as a superseded retention note,
not by rewriting their historical architecture:

```markdown
> Superseded on 2026-07-29: raw-source and placement-action retention is
> 30 days under the late-placement-generation design.
```

- [ ] **Step 5: Verify no live seven-day promise remains**

Run:

```bash
rg -n "7 days|seven days|7-day|seven-day" \
  src/app/privacy/page.tsx \
  src/app/terms/page.tsx \
  src/app/page.tsx \
  src/app/learn/guides.ts \
  src/app/api/media-url/route.ts \
  'src/app/match/[id]/ReelBar.tsx' \
  src/lib/r2.ts worker/README.md worker/worker.py \
  supabase/README-SETUP.md
```

Expected: no output referring to raw-upload retention.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python \
  -m unittest \
  worker.tests.test_raw_retention \
  worker.tests.test_placement_notifications -v
npm run test:learn
npx eslint src/app/privacy/page.tsx src/app/terms/page.tsx \
  src/app/page.tsx src/app/learn/guides.ts
git diff --check
```

Expected: PASS.

Commit:

```bash
git add worker/worker.py worker/README.md \
  worker/tests/test_raw_retention.py \
  worker/tests/test_placement_notifications.py \
  src/lib/r2.ts src/app/privacy/page.tsx src/app/terms/page.tsx \
  src/app/page.tsx src/app/learn/guides.ts \
  src/app/api/media-url/route.ts \
  'src/app/match/[id]/ReelBar.tsx' \
  supabase/README-SETUP.md \
  docs/superpowers/specs/2026-07-29-placement-retry-recovery-design.md \
  docs/superpowers/plans/2026-07-29-placement-retry-recovery.md
git commit -m "feat: retain raw uploads for thirty days"
```

---

### Task 7: Complete Verification, Production Migration, and Deployment

**Files:**
- Verify all files changed in Tasks 1-6.

**Interfaces:**
- Consumes: completed database, API, worker, UI, email, retention, and copy changes.
- Produces: review evidence, deployed migration/worker/web app, and a safe production test path for the latest Vaibhav match.

- [ ] **Step 1: Run the complete worker suite**

Run:

```bash
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python \
  -m unittest discover -s worker/tests -v
```

Expected: zero failures and zero errors.

- [ ] **Step 2: Run all web test suites**

Run:

```bash
npm run test:auth
npm run test:placement
npm run test:research
npm run test:learn
```

Expected: all tests PASS.

- [ ] **Step 3: Run lint and production build**

Run:

```bash
npm run lint
npm run build
```

Expected: zero lint errors and build exit code 0. Pre-existing warnings may
be reported separately but cannot be attributed to this branch.

- [ ] **Step 4: Inspect invariants and final diff**

Run:

```bash
git diff --check
git status --short
rg -n "placement_generate|placement_generation_job_id|30 days" \
  supabase/migrations/055_late_placement_generation.sql \
  src worker
rg -n "update public.points|match_json|placement_status" worker/worker.py
```

Confirm:

- only the new RPC creates `placement_generate`;
- only the retry RPC creates `placement_retry`;
- normal generation passes deterministic strategy;
- stronger retry alone has access to the OpenAI key;
- generation failure exposes retry without mutating points;
- every action is owner-only;
- bottom/point surfaces contain no CTA; and
- no unrelated or other-worktree changes are included.

- [ ] **Step 5: Request code review and resolve findings**

Review the diff from the design commit to `HEAD` against:

```text
docs/superpowers/specs/2026-07-29-late-placement-generation-design.md
```

Fix every Critical or Important finding, rerun its focused test, then rerun
Steps 1-3.

- [ ] **Step 6: Commit any verification fixes**

If review produced changes:

```bash
git add -u
git commit -m "fix: harden late placement generation"
```

If no files changed, do not create an empty commit.

- [ ] **Step 7: Prepare and verify the merged release without exposing it**

After the user chooses integration:

1. merge the branch into the current local `main`;
2. rerun Steps 1-4 on merged `main`;
3. require a clean expected tree and record `MERGED_HEAD`;
4. do not push, migrate, restart, deploy, or expose the web route yet.

If the public Privacy Policy and Terms do not already display the 30-day
retention promise, plan a separately reviewed legal-copy-only release. That
release must not contain the placement route or Tools action. The old worker
must be quiesced before that copy becomes live, and the copy must be live
before the merged 30-day worker starts. If a legal-only release changes
`main`, incorporate it into `MERGED_HEAD` and rerun Steps 1-4.

- [ ] **Step 8: Quiesce, migrate, reconcile, start the worker, then expose web**

Perform this order without overlap:

1. Wait for the old worker to be idle, stop
   `com.adil.ponglens-worker`, and verify that its process is absent. Keep it
   stopped through migration and smoke testing.
2. Satisfy the legal-copy gate from Step 7 while no raw-retention sweep is
   running. Do not expose the placement API or Tools action.
3. Query `information_schema.columns` and require
   `placement_generation_job_id` to be absent. Apply only migration 055
   through the existing direct Postgres/Keychain workflow.
4. Use the owner's latest live, ready, `not_requested` Vaibhav match in one
   transaction that is always rolled back:
   - set the authenticated JWT claim to the match owner;
   - call `request_placement_generation(match_id)`;
   - verify exactly one queued `placement_generate` job;
   - verify `processing`, retry count `0`, and the exact generation job ID;
   - call the RPC again under a savepoint and verify duplicate rejection;
   - roll back; then verify lifecycle, points, notes, jobs, and queue equal
     their complete pre-transaction baselines.
5. Reconcile rows completed near the quiescence boundary. Re-run only the
   migration's guarded deadline updates for `not_requested` and
   `retry_available` rows whose source jobs remain inside the former
   seven-day reliability window. Require every affected deadline to equal
   its source job's `created_at + interval '30 days'`; never grant
   eligibility to older legacy rows.
6. Start the merged worker from `MERGED_HEAD`. Verify its service state,
   startup log commit, placement job support, and 30-day retention behavior.
7. Only after the merged worker is healthy, push `MERGED_HEAD`, wait for and
   promote the matching Vercel production deployment, and require status
   `Ready`.
8. Send an unauthenticated POST to `/api/placement-generate` with an inert
   valid UUID. Require `401 not_authenticated`, proving the route is live
   without enqueueing a job.

Safe order is mandatory:

```text
merge + verify
  -> quiesce old worker
  -> legal-copy gate
  -> migration + rolled-back smoke + deadline reconciliation
  -> start + verify merged worker
  -> push/promote web
  -> inert route probe
```

Do not enqueue a visible production job during migration or smoke testing.

- [ ] **Step 9: Hand off the authenticated production test**

Ask the owner to open the latest Vaibhav match and verify:

```text
Tools -> Placement maps -> Generate
```

On confirmation:

- one visible generation job is queued;
- Tools changes to `Generating…`;
- bottom area shows informational progress;
- normal success yields maps and the ready email; or
- normal inability yields `Try again` and the stronger-retry email.

If `Try again` appears, the owner may explicitly trigger the stronger retry
and verify its existing success/final-failure outcome.
