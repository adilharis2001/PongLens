# Placement Retry and Failure Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface placement-generation failures in email and the match UI, and let the match owner enqueue exactly one focused placement retry with a validated OpenAI vision-assisted calibration fallback.

**Architecture:** Add a server-owned placement lifecycle to `public.matches` and an atomic security-definer enqueue function. The original worker records placement success or retry eligibility; a new `placement_retry` branch reuses existing point ranges, tries deterministic then vision-assisted calibration, and commits only verified placement data. A small retry API and client status component expose stable states and messages without letting the browser control retry counts.

**Tech Stack:** PostgreSQL/Supabase RLS and pgmq, Python 3.12 worker with unittest/OpenCV/NumPy/requests, Next.js 15 App Router, React 19, TypeScript, Node's built-in test runner.

> Superseded on 2026-07-29: raw-source and placement-action retention is
> 30 days under the late-placement-generation design.

## Global Constraints

- A user may request at most one placement retry per match.
- The retry must not create a match, point, clip, thumbnail, temporary R2 object, backup R2 object, or storage-ledger row.
- Existing point IDs, indices, `t0`/`t1`, clips, scores, edits, notes, tags, suggestions, and match metadata are immutable during the retry.
- Vision calibration runs only after the owner explicitly requests the retry and deterministic calibration did not produce drawable placement.
- OpenAI coordinates are proposals; local snapping and geometry/evidence validation are mandatory before reconstruction.
- Invalid JSON, model/network failure, or rejected geometry must fail closed without placement writes.
- Email is best-effort and cannot change match or job status.
- The raw-source retry window is seven days from the originating job's creation.
- Existing historical failures do not gain retry eligibility during migration.
- All implementation follows red-green-refactor: write and observe a relevant failing test before production code.

---

### Task 1: Placement Lifecycle Schema and Atomic Retry RPC

**Files:**
- Create: `supabase/migrations/049_placement_retry.sql`
- Create: `src/lib/placement/placementRetryMigration.test.ts`
- Modify: `src/lib/types.ts:24-60`

**Interfaces:**
- Consumes: existing `public.matches`, `public.jobs`, `public.enqueue_job()` trigger, and authenticated `auth.uid()`.
- Produces: `PlacementStatus`, lifecycle columns on `Match`, and `public.request_placement_retry(p_match_id uuid) returns uuid`.

- [ ] **Step 1: Write the failing migration contract test**

Create `src/lib/placement/placementRetryMigration.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../../../supabase/migrations/049_placement_retry.sql", import.meta.url),
  "utf8",
).toLowerCase();

test("placement retry migration defines the complete lifecycle", () => {
  for (const status of [
    "not_requested",
    "processing",
    "ready",
    "retry_available",
    "retrying",
    "final_failed",
  ]) {
    assert.match(sql, new RegExp(`'${status}'`));
  }
  assert.match(sql, /placement_retry_count[\s\S]*between 0 and 1/);
  assert.match(sql, /placement_retry_job_id[\s\S]*references public\.jobs/);
});

test("retry enqueue is owner checked, locked, expiring, and atomic", () => {
  assert.match(sql, /create or replace function public\.request_placement_retry/);
  assert.match(sql, /for update/);
  assert.match(sql, /v_match\.user_id <> auth\.uid\(\)/);
  assert.match(sql, /placement_status <> 'retry_available'/);
  assert.match(sql, /placement_retry_count <> 0/);
  assert.match(sql, /placement_retry_expires_at <= now\(\)/);
  assert.match(sql, /values \(auth\.uid\(\), 'placement_retry'/);
  assert.match(sql, /placement_retry_job_id = v_job_id/);
});

test("historical failures are not made retryable", () => {
  assert.match(sql, /else 'final_failed'/);
  assert.doesNotMatch(sql, /else 'retry_available'/);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
node --test --experimental-strip-types src/lib/placement/placementRetryMigration.test.ts
```

Expected: FAIL with `ENOENT` for `049_placement_retry.sql`.

- [ ] **Step 3: Add the lifecycle migration**

Create `supabase/migrations/049_placement_retry.sql` with:

```sql
alter table public.matches
  add column placement_status text not null default 'not_requested',
  add column placement_retry_count smallint not null default 0,
  add column placement_mapped_points integer not null default 0,
  add column placement_failure_code text,
  add column placement_retry_expires_at timestamptz,
  add column placement_retry_job_id uuid references public.jobs(id)
    on delete set null;

alter table public.matches
  add constraint matches_placement_status_check check (
    placement_status in (
      'not_requested', 'processing', 'ready',
      'retry_available', 'retrying', 'final_failed'
    )
  ),
  add constraint matches_placement_retry_count_check
    check (placement_retry_count between 0 and 1),
  add constraint matches_placement_mapped_points_check
    check (placement_mapped_points >= 0);

with placement_rollup as (
  select
    m.id,
    coalesce(bool_or(
      coalesce((j.options->>'placement')::boolean, false)
    ), false) as requested,
    count(p.id) filter (
      where jsonb_path_exists(
        coalesce(p.placement, '{}'::jsonb),
        '$.hypotheses.*.shots[*] ? (@.landing != null || @.terminal != null)'
      )
      or jsonb_array_length(coalesce(
        p.placement->'bounces', '[]'::jsonb
      )) > 0
    )::integer as mapped_points
  from public.matches m
  left join public.jobs j on j.id = m.job_id
  left join public.points p on p.match_id = m.id
  group by m.id
)
update public.matches m
set placement_mapped_points = r.mapped_points,
    placement_status = case
      when r.mapped_points > 0 then 'ready'
      when r.requested is false then 'not_requested'
      else 'final_failed'
    end
from placement_rollup r
where r.id = m.id;

create or replace function public.request_placement_retry(p_match_id uuid)
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
  if v_match.placement_status = 'retrying' then
    raise exception 'placement retry already queued' using errcode = 'P0001';
  end if;
  if v_match.placement_status <> 'retry_available' then
    raise exception 'placement retry unavailable' using errcode = 'P0001';
  end if;
  if v_match.placement_retry_count <> 0 then
    raise exception 'placement retry already used' using errcode = '23514';
  end if;
  if v_match.placement_retry_expires_at is null
     or v_match.placement_retry_expires_at <= now() then
    update public.matches
    set placement_status = 'final_failed',
        placement_failure_code = 'source_expired'
    where id = p_match_id;
    return null;
  end if;

  insert into public.jobs (user_id, kind, status, input_path,
                           original_name, options)
  values (auth.uid(), 'placement_retry', 'queued', null,
          'Placement retry',
          jsonb_build_object('match_id', p_match_id))
  returning id into v_job_id;

  update public.matches
  set placement_status = 'retrying',
      placement_retry_count = 1,
      placement_retry_job_id = v_job_id,
      placement_failure_code = null
  where id = p_match_id;

  return v_job_id;
end;
$$;

revoke all on function public.request_placement_retry(uuid) from public;
grant execute on function public.request_placement_retry(uuid)
  to authenticated;
```

Add the existing-project grants needed for authenticated users to select the
new match columns; do not grant direct updates.

- [ ] **Step 4: Add TypeScript lifecycle types**

In `src/lib/types.ts`, add:

```ts
export type PlacementStatus =
  | "not_requested"
  | "processing"
  | "ready"
  | "retry_available"
  | "retrying"
  | "final_failed";
```

Extend `Match` with:

```ts
placement_status: PlacementStatus;
placement_retry_count: 0 | 1;
placement_mapped_points: number;
placement_failure_code: string | null;
placement_retry_expires_at: string | null;
placement_retry_job_id: string | null;
```

- [ ] **Step 5: Run the migration contract and placement tests**

Run:

```bash
node --test --experimental-strip-types src/lib/placement/placementRetryMigration.test.ts
npm run test:placement
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the schema contract**

```bash
git add supabase/migrations/049_placement_retry.sql \
  src/lib/types.ts \
  src/lib/placement/placementRetryMigration.test.ts
git commit -m "feat: add placement retry lifecycle"
```

---

### Task 2: Stable Retry API Contract

**Files:**
- Create: `src/lib/placement/placementRetry.ts`
- Create: `src/lib/placement/placementRetry.test.ts`
- Create: `src/app/api/placement-retry/route.ts`

**Interfaces:**
- Consumes: `PlacementStatus`, authenticated Supabase server client, and `request_placement_retry`.
- Produces: `placementRetryAction(status, retryCount, expiresAt, now)`, `placementRetryError(error)`, and `POST /api/placement-retry`.

- [ ] **Step 1: Write failing tests for eligibility and stable errors**

Create `src/lib/placement/placementRetry.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  placementRetryAction,
  placementRetryError,
} from "./placementRetry.ts";

test("only a live unused retry_available match can enqueue", () => {
  const now = new Date("2026-07-29T12:00:00Z");
  assert.equal(
    placementRetryAction(
      "retry_available", 0, "2026-07-30T12:00:00Z", now,
    ),
    "enqueue",
  );
  assert.equal(
    placementRetryAction(
      "retry_available", 0, "2026-07-28T12:00:00Z", now,
    ),
    "expired",
  );
  assert.equal(
    placementRetryAction("retry_available", 1, null, now),
    "used",
  );
  assert.equal(
    placementRetryAction("retrying", 1, null, now),
    "already_retrying",
  );
});

test("database errors become stable API codes", () => {
  assert.deepEqual(
    placementRetryError({ code: "P0002", message: "match not found" }),
    { status: 404, code: "match_not_found" },
  );
  assert.deepEqual(
    placementRetryError({ code: "23514", message: "already used" }),
    { status: 409, code: "retry_already_used" },
  );
  assert.deepEqual(
    placementRetryError({ code: "P0001", message: "unavailable" }),
    { status: 409, code: "retry_unavailable" },
  );
  assert.deepEqual(
    placementRetryError({
      code: "P0001",
      message: "placement retry already queued",
    }),
    { status: 409, code: "already_retrying" },
  );
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
node --test --experimental-strip-types src/lib/placement/placementRetry.test.ts
```

Expected: FAIL because `placementRetry.ts` does not exist.

- [ ] **Step 3: Implement the pure retry contract**

Create `src/lib/placement/placementRetry.ts`:

```ts
import type { PlacementStatus } from "../types.ts";

export type PlacementRetryAction =
  | "enqueue"
  | "expired"
  | "used"
  | "already_retrying"
  | "unavailable";

export function placementRetryAction(
  status: PlacementStatus,
  retryCount: number,
  expiresAt: string | null,
  now = new Date(),
): PlacementRetryAction {
  if (status === "retrying") return "already_retrying";
  if (status !== "retry_available") return "unavailable";
  if (retryCount !== 0) return "used";
  if (!expiresAt || new Date(expiresAt).getTime() <= now.getTime()) {
    return "expired";
  }
  return "enqueue";
}

export function placementRetryError(error: {
  code?: string;
  message?: string;
}): { status: number; code: string } {
  if (error.code === "P0002") {
    return { status: 404, code: "match_not_found" };
  }
  if (error.code === "23514") {
    return { status: 409, code: "retry_already_used" };
  }
  if (error.code === "P0001") {
    if ((error.message ?? "").includes("already queued")) {
      return { status: 409, code: "already_retrying" };
    }
    return { status: 409, code: "retry_unavailable" };
  }
  if (error.code === "42501") {
    return { status: 403, code: "not_owner" };
  }
  return { status: 500, code: "queue_failed" };
}
```

- [ ] **Step 4: Implement the authenticated API route**

Create `src/app/api/placement-retry/route.ts` that:

1. parses `{matchId}` with the existing UUID regex used by other API routes;
2. calls `supabase.auth.getUser()` and returns 401 when absent;
3. calls `supabase.rpc("request_placement_retry", {p_match_id: matchId})`;
4. returns `410 {code:"source_expired"}` when the RPC data is null;
5. returns `202 {status:"queued", jobId:data}` on success; and
6. uses `placementRetryError()` for database errors.

Use this concrete response form:

```ts
return NextResponse.json(
  { status: "queued", jobId: data as string },
  { status: 202 },
);
```

- [ ] **Step 5: Run focused tests, lint the files, and build**

Run:

```bash
node --test --experimental-strip-types src/lib/placement/placementRetry.test.ts
npx eslint src/lib/placement/placementRetry.ts \
  src/lib/placement/placementRetry.test.ts \
  src/app/api/placement-retry/route.ts
npm run build
```

Expected: tests, lint, and build PASS.

- [ ] **Step 6: Commit the retry API**

```bash
git add src/lib/placement/placementRetry.ts \
  src/lib/placement/placementRetry.test.ts \
  src/app/api/placement-retry/route.ts
git commit -m "feat: add placement retry API"
```

---

### Task 3: Original-Run Placement State and Outcome Emails

**Files:**
- Create: `worker/tests/test_placement_notifications.py`
- Modify: `worker/worker.py:380-448`
- Modify: `worker/worker.py:1351-1540`
- Modify: `worker/worker.py:2990-3022`

**Interfaces:**
- Consumes: original job options, `match.json.calibration`, reconstructed point payloads, match lifecycle columns.
- Produces: `count_drawable_placements(points) -> int`, placement-aware `finish_match()`, `PlacementEmailContext`, and initial/retry outcome emails.

- [ ] **Step 1: Write failing worker tests**

Create `worker/tests/test_placement_notifications.py`:

```python
import unittest

from worker.worker import (
    count_drawable_placements,
    done_email_html,
    placement_retry_email_html,
)


def placement(landing):
    shot = {
        "landing": landing,
        "terminal": None,
    }
    return {
        "v": 3,
        "hypotheses": {
            "near": {"shots": [shot]},
            "far": {"shots": []},
        },
    }


class PlacementSummaryTests(unittest.TestCase):
    def test_counts_each_point_with_a_drawable_event_once(self):
        points = [
            {"placement": placement({"u": 0.5, "v": 2.0})},
            {"placement": placement(None)},
            {"placement": None},
        ]
        self.assertEqual(count_drawable_placements(points), 1)


class PlacementEmailTests(unittest.TestCase):
    def test_initial_failure_email_discloses_retry_and_direct_link(self):
        html = done_email_html(
            "vaibhav.mov",
            match_id="10000000-0000-0000-0000-000000000001",
            placement_status="retry_available",
        )
        self.assertIn("couldn&#x27;t generate reliable placement maps", html)
        self.assertIn("/match/10000000-0000-0000-0000-000000000001", html)
        self.assertIn("Try placement again", html)

    def test_retry_outcomes_have_distinct_friendly_copy(self):
        success = placement_retry_email_html(
            "10000000-0000-0000-0000-000000000001", succeeded=True
        )
        failed = placement_retry_email_html(
            "10000000-0000-0000-0000-000000000001", succeeded=False
        )
        self.assertIn("placement maps are ready", success.lower())
        self.assertIn("still couldn&#x27;t generate", failed.lower())
        self.assertNotIn("vision_calibration_rejected", failed)
```

- [ ] **Step 2: Run the tests and confirm RED**

Run:

```bash
worker/venv/bin/python -m unittest \
  worker.tests.test_placement_notifications -v
```

Expected: import failures for the new summary and email interfaces.

- [ ] **Step 3: Implement drawable counting and lifecycle writes**

In `worker/worker.py`, add:

```python
PLACEMENT_STATUSES = {
    "not_requested", "processing", "ready",
    "retry_available", "retrying", "final_failed",
}


def count_drawable_placements(points: list[dict]) -> int:
    count = 0
    for point in points:
        placement = point.get("placement")
        if not isinstance(placement, dict):
            continue
        hypotheses = placement.get("hypotheses")
        if not isinstance(hypotheses, dict):
            bounces = placement.get("bounces")
            count += int(isinstance(bounces, list) and bool(bounces))
            continue
        drawable = any(
            isinstance(hypothesis, dict)
            and any(
                shot.get("landing") is not None
                or shot.get("terminal") is not None
                for shot in hypothesis.get("shots", [])
                if isinstance(shot, dict)
            )
            for hypothesis in hypotheses.values()
        )
        count += int(drawable)
    return count
```

Extend match creation to receive `placement_requested: bool` and insert
`placement_status = 'processing'` when true, otherwise `not_requested`.

After reading the original `match.json`, compute:

```python
mapped = count_drawable_placements(points)
if not options.get("placement"):
    placement_status = "not_requested"
    failure_code = None
elif mapped:
    placement_status = "ready"
    failure_code = None
else:
    placement_status = "retry_available"
    failure_code = (
        "calibration_failed"
        if not (match_json.get("calibration") or {}).get("ok")
        else "no_mappable_points"
    )
```

Persist the status, mapped count, failure code, and originating
`jobs.created_at + interval '7 days'` expiry in the same match-ready update.

- [ ] **Step 4: Implement placement-aware emails**

Add `APP_URL = "https://ponglens.com"` beside `DASHBOARD_URL`. Refactor
`done_email_html()` to accept keyword-only `match_id` and
`placement_status`. Preserve the current body for ordinary ready matches.
For `retry_available`, use:

```python
title = "Your match is ready — placement needs another try"
message = (
    "Your match and point clips are ready, but we couldn't generate "
    "reliable placement maps this time. You have one stronger retry "
    "available for seven days."
)
cta_label = "Try placement again"
cta_url = f"{APP_URL}/match/{match_id}#ball-map"
```

Add:

```python
def placement_retry_email_html(match_id: str, *, succeeded: bool) -> str:
    url = f"{APP_URL}/match/{match_id}#ball-map"
    if succeeded:
        title = "Your placement maps are ready"
        message = (
            "The stronger placement retry worked. Open your match to "
            "review where the ball landed."
        )
        cta = "Review placement maps"
    else:
        title = "We still couldn't generate reliable placement maps"
        message = (
            "We tried both table-calibration methods, but this recording "
            "couldn't be mapped reliably. Your points, score, clips, and "
            "notes are still available, and there is nothing wrong with "
            "your account or upload."
        )
        cta = "Review your match"
    return email_card_html(title, message, cta, url)
```

Extract the current table-based email chrome into:

```python
def email_card_html(
    title: str,
    message: str,
    cta_label: str,
    cta_url: str,
) -> str:
    return (
        '<div style="display:none;max-height:0;overflow:hidden">'
        + html.escape(title)
        + '</div><table role="presentation" width="100%">'
        + '<tr><td align="center">'
        + f'<h1>{html.escape(title)}</h1>'
        + f'<p>{html.escape(message)}</p>'
        + f'<a href="{html.escape(cta_url, quote=True)}">'
        + html.escape(cta_label)
        + "</a></td></tr></table>"
    )
```

Keep the existing inline visual styles when extracting the production helper;
the snippet fixes the exact escaping and content contract.

Add `notify_placement_retry_done(conn, user_id, match_id, succeeded)` using
subjects:

```text
Your placement maps are ready
We still couldn't generate reliable placement maps
```

Change `notify_job_done()` to query the match created by `job_id` and select
the proper initial email variant.

- [ ] **Step 5: Run focused and worker regression tests**

Run:

```bash
worker/venv/bin/python -m unittest \
  worker.tests.test_placement_notifications \
  worker.tests.test_worker_backfill \
  worker.tests.test_backfill_runner -v
```

Expected: all tests PASS.

- [ ] **Step 6: Commit original-run state and email behavior**

```bash
git add worker/worker.py worker/tests/test_placement_notifications.py
git commit -m "feat: report placement processing outcomes"
```

---

### Task 4: Vision-Assisted Calibration Boundary

**Files:**
- Create: `worker/placement_retry_calibration.py`
- Create: `worker/tests/test_placement_retry_calibration.py`

**Interfaces:**
- Consumes: raw video, BlurBall JSONL, current deterministic `calibrate()`, OpenAI vision response JSON, and temporary work directory.
- Produces: `CalibrationOutcome`, `parse_corner_proposal()`, `validate_quad()`, `snap_quad_to_rim()`, `calibrate_for_retry()`, and a `calibrate` CLI subcommand.

- [ ] **Step 1: Write failing proposal and geometry tests**

Create `worker/tests/test_placement_retry_calibration.py` with:

```python
import unittest
from unittest.mock import Mock

import numpy as np

from worker.placement_retry_calibration import (
    parse_corner_proposal,
    validate_quad,
)


VALID = {
    "width": 1920,
    "height": 1080,
    "confidence": 0.91,
    "corners": {
        "A_near_1": [783, 697],
        "B_near_2": [578, 577],
        "C_far_2": [1074, 461],
        "D_far_1": [1327, 499],
    },
}


class ProposalTests(unittest.TestCase):
    def test_parses_finite_in_frame_corner_proposal(self):
        proposal = parse_corner_proposal(VALID, 1920, 1080)
        self.assertEqual(proposal.corners.shape, (4, 2))
        self.assertGreater(proposal.confidence, 0.8)

    def test_rejects_out_of_frame_or_low_confidence_proposal(self):
        bad = {**VALID, "confidence": 0.2}
        with self.assertRaisesRegex(ValueError, "confidence"):
            parse_corner_proposal(bad, 1920, 1080)
        bad = {
            **VALID,
            "corners": {**VALID["corners"], "D_far_1": [2500, 499]},
        }
        with self.assertRaisesRegex(ValueError, "frame"):
            parse_corner_proposal(bad, 1920, 1080)

    def test_quad_validation_rejects_nonconvex_and_accepts_table_geometry(self):
        good = np.array(
            [[783, 697], [578, 577], [1074, 461], [1327, 499]],
            dtype=np.float32,
        )
        validate_quad(good, 1920, 1080, bounce_core=(512, 1280, 448, 640))
        bad = good[[0, 2, 1, 3]]
        with self.assertRaisesRegex(ValueError, "convex"):
            validate_quad(bad, 1920, 1080, bounce_core=None)
```

Add a second test class with injected `vision_request` and `rim_snapper`
callables proving:

- deterministic success skips OpenAI;
- deterministic failure calls OpenAI once;
- an invalid vision proposal returns
  `CalibrationOutcome(ok=False, code="vision_calibration_rejected")`; and
- a snapped, validated proposal returns stored corners and length axis.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
worker/venv/bin/python -m unittest \
  worker.tests.test_placement_retry_calibration -v
```

Expected: FAIL because `placement_retry_calibration.py` does not exist.

- [ ] **Step 3: Implement parsing and geometry validation**

Create dataclasses:

```python
@dataclass(frozen=True)
class CornerProposal:
    corners: np.ndarray
    confidence: float


@dataclass(frozen=True)
class CalibrationOutcome:
    ok: bool
    code: str | None
    calibration: dict | None
```

Implement `parse_corner_proposal()` with strict object/key/type/finite/bounds
checks and a minimum model confidence of `0.65`.

Implement `validate_quad()` with:

- convexity and non-self-intersection;
- frame area between `0.002` and `0.35`;
- minimum edge length `25 * width / 1920`;
- opposite-edge and perspective ratio bounds;
- optional bounce-core overlap; and
- finite, nonsingular OpenCV forward/inverse homographies.

Return the ordered float32 quad on success; raise `ValueError` with a
machine-readable phrase on rejection.

- [ ] **Step 4: Implement representative frames, OpenAI request, and rim snapping**

Implement:

```python
def representative_frames(
    video_path: str | Path,
    output_dir: str | Path,
) -> list[Path]:
    """Write one median background and up to two high-rim-support JPEGs."""


def request_corner_proposal(
    image_paths: list[Path],
    *,
    api_key: str,
    model: str,
    timeout_s: int = 90,
) -> dict:
    """One OpenAI Responses API request returning strict parsed JSON."""


def snap_quad_to_rim(
    proposal: np.ndarray,
    background_bgr: np.ndarray,
    *,
    search_radius: int = 36,
) -> np.ndarray:
    """Fit nearby magenta rim evidence without moving any corner > radius."""
```

The OpenAI prompt must define A/B/C/D exactly, require the near end as the
larger camera-facing end line, and request only JSON. Downscale images to a
bounded maximum dimension before base64 encoding.

Rim snapping builds the same HSV magenta mask as the deterministic calibrator,
fits supported line segments near each proposed edge, intersects adjacent
lines for refined corners, and retains the original proposal for an edge with
insufficient local support. Reject a final quad if fewer than three edges have
minimum support.

- [ ] **Step 5: Implement the retry calibration cascade and CLI**

Implement:

```python
def calibrate_for_retry(
    video_path,
    blurball_path,
    workdir,
    *,
    api_key,
    model,
    deterministic_calibrator=calibrate,
    vision_request=request_corner_proposal,
    rim_snapper=snap_quad_to_rim,
) -> CalibrationOutcome:
    detections = load_detections(Path(blurball_path))
    metadata = probe(str(video_path))
    px = Px(int(metadata["width"]))
    gate = activity_gate(
        detections, int(metadata["width"]), int(metadata["height"])
    )
    try:
        deterministic = deterministic_calibrator(
            str(video_path),
            str(workdir),
            detections,
            px,
            gate_core=gate["core"] if gate else None,
        )
    except Exception:
        deterministic = None
    if deterministic is not None:
        corners = np.asarray(
            [
                deterministic["corners_px"][name]
                for name in (
                    "A_near_1", "B_near_2", "C_far_2", "D_far_1"
                )
            ],
            dtype=np.float32,
        )
        validate_quad(
            corners,
            int(metadata["width"]),
            int(metadata["height"]),
            bounce_core=gate["core"] if gate else None,
        )
        return CalibrationOutcome(
            ok=True,
            code=None,
            calibration={
                "ok": True,
                "table_corners_px": deterministic["corners_px"],
                "length_axis": list(deterministic["e"]),
                "note": deterministic["note"],
            },
        )

    try:
        images = representative_frames(video_path, workdir)
        raw = vision_request(images, api_key=api_key, model=model)
        proposal = parse_corner_proposal(
            raw, int(metadata["width"]), int(metadata["height"])
        )
        background = cv2.imread(str(images[0]))
        snapped = rim_snapper(proposal.corners, background)
        quad = validate_quad(
            snapped,
            int(metadata["width"]),
            int(metadata["height"]),
            bounce_core=gate["core"] if gate else None,
        )
    except (
        ValueError,
        json.JSONDecodeError,
        requests.RequestException,
        TimeoutError,
    ):
        return CalibrationOutcome(
            ok=False,
            code="vision_calibration_rejected",
            calibration=None,
        )

    A, B, C, D = quad
    axis = ((D - A) + (C - B)) / 2.0
    axis = axis / np.linalg.norm(axis)
    names = ("A_near_1", "B_near_2", "C_far_2", "D_far_1")
    return CalibrationOutcome(
        ok=True,
        code=None,
        calibration={
            "ok": True,
            "table_corners_px": {
                name: [round(float(p[0]), 1), round(float(p[1]), 1)]
                for name, p in zip(names, quad)
            },
            "length_axis": [float(axis[0]), float(axis[1])],
            "note": (
                "vision-proposed calibration snapped to local rim evidence "
                "and validated against the bounce region"
            ),
        },
    )
```

It must:

1. load detections and activity gate;
2. call the deterministic calibrator first;
3. return its validated stored calibration when successful;
4. otherwise create representative frames and make one vision request;
5. parse, snap, and validate the proposal;
6. compute `length_axis`; and
7. return `vision_calibration_rejected` on expected fallback failure.

Add CLI:

```bash
python placement_retry_calibration.py calibrate \
  --video source.mp4 \
  --blurball blurball.jsonl \
  --workdir /tmp/retry \
  --output calibration.json
```

The output always contains all three keys. On success, `calibration` is the
stored object containing `ok`, `table_corners_px`, `length_axis`, and `note`,
while `code` is null. Expected rejection uses:
`{"ok": false, "code": "vision_calibration_rejected", "calibration": null}`.
Unexpected infrastructure exceptions exit nonzero; expected inability to
calibrate exits zero with `ok:false`.

- [ ] **Step 6: Run calibration and reconstruction regressions**

Run:

```bash
worker/venv/bin/python -m unittest \
  worker.tests.test_placement_retry_calibration \
  worker.tests.test_placement_backfill_reconstruction \
  worker.tests.test_placement_reconstruction -v
```

Expected: all tests PASS without network access.

- [ ] **Step 7: Commit the calibration fallback**

```bash
git add worker/placement_retry_calibration.py \
  worker/tests/test_placement_retry_calibration.py
git commit -m "feat: add vision-assisted placement calibration"
```

---

### Task 5: Transactional Placement Retry Worker Job

**Files:**
- Create: `worker/tests/test_placement_retry_job.py`
- Modify: `worker/worker.py:809-1325`
- Modify: `worker/worker.py:2892-2925`
- Modify: `worker/worker.py:3180-3210`

**Interfaces:**
- Consumes: exact authorized retry job, existing backfill input/download/reconstruction/verification helpers, and `placement_retry_calibration.py` CLI.
- Produces: `PlacementRetryResult`, `load_placement_retry_record()`, `run_retry_calibration()`, `retry_placement_for_match()`, and `process_placement_retry()`.

- [ ] **Step 1: Write failing authorization and outcome tests**

Create `worker/tests/test_placement_retry_job.py` with fake connection/cursor
fixtures following `test_worker_backfill.py`. Cover these concrete behaviors:

```python
class PlacementRetryAuthorizationTests(unittest.TestCase):
    def test_rejects_job_that_is_not_the_match_recorded_retry_job(self):
        conn = retry_connection(
            match_status="retrying",
            retry_count=1,
            retry_job_id=EXPECTED_JOB_ID,
        )
        with self.assertRaisesRegex(RuntimeError, "authorized retry job"):
            load_placement_retry_record(conn, OTHER_JOB_ID, USER_ID, MATCH_ID)


class PlacementRetryOutcomeTests(unittest.TestCase):
    @patch("worker.worker.run_retry_calibration")
    def test_expected_calibration_exhaustion_is_final_not_poison(self, calibration):
        calibration.return_value = {
            "ok": False,
            "code": "vision_calibration_rejected",
            "calibration": None,
        }
        result = retry_placement_for_match(
            self.connection, JOB_ID, USER_ID, MATCH_ID
        )
        self.assertFalse(result.succeeded)
        self.assertEqual(result.failure_code, "vision_calibration_rejected")
        self.assertEqual(self.connection.match_status, "final_failed")
        self.assertEqual(self.connection.point_updates, [])

    @patch("worker.worker.run_placement_reconstruction")
    def test_zero_drawable_outputs_do_not_mutate_points(self, reconstruct):
        reconstruct.return_value = unavailable_output_fixture()
        result = retry_placement_for_match(
            self.connection, JOB_ID, USER_ID, MATCH_ID
        )
        self.assertFalse(result.succeeded)
        self.assertEqual(result.failure_code, "no_mappable_points")
        self.assertEqual(self.connection.point_updates, [])
```

Also test successful placement-only mutation, R2 compensation,
source-expired finalization, terminal redelivery no-op, and transient exception
leaving the match `retrying` until poison handling.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
worker/venv/bin/python -m unittest \
  worker.tests.test_placement_retry_job -v
```

Expected: import failures for the new retry interfaces.

- [ ] **Step 3: Implement retry record authorization and calibration subprocess**

Add:

```python
@dataclass(frozen=True)
class PlacementRetryResult:
    match_id: str
    succeeded: bool
    mapped_points: int
    failure_code: str | None


def load_placement_retry_record(
    conn, job_id: str, user_id: str, match_id: str, *, for_update=False
) -> dict:
    """Require owner, retrying/1 state, and exact placement_retry_job_id."""
```

Add `run_retry_calibration()` that invokes the new CLI with `VENV_PY`,
passes `OPENAI_API_KEY` only through the child environment, uses
`WORKER_PLACEMENT_VISION_MODEL` defaulting to the configured vision model,
and reads the bounded JSON result.

- [ ] **Step 4: Implement compute-before-mutate retry orchestration**

Implement `retry_placement_for_match()`:

1. authorize and snapshot the retry record;
2. download retained source and `match.json`;
3. run BlurBall once;
4. run the calibration cascade;
5. on expected calibration failure, set only lifecycle fields to
   `final_failed`;
6. write accepted calibration into the local match document;
7. call existing placement reconstruction with authoritative Postgres points;
8. validate every v3 payload;
9. require `count_drawable_placements(...) > 0`;
10. lock and re-authorize the unchanged match;
11. update point placements and match lifecycle in one short transaction;
12. upload and fully verify `match.json`; and
13. compensate database placements, lifecycle fields, and R2 document on
    verification failure.

On success set `ready`, mapped count, and null failure code. On expected
exhaustion set `final_failed`, mapped count zero, and the terminal code.

- [ ] **Step 5: Add queue dispatch, progress, email, and poison handling**

In `process_job()` add a `placement_retry` branch before the generic kind
guard:

```python
if kind == "placement_retry":
    update_job(conn, job_id, status="processing", progress=5, error=None)
    result = process_placement_retry(conn, job_id, user_id, payload)
    update_job(conn, job_id, status="done", progress=100)
    archive_message(conn, msg["msg_id"])
    notify_placement_retry_done(
        conn, user_id, result.match_id, result.succeeded
    )
    return
```

For unexpected retry exceptions, leave the match `retrying` while pgmq may
redeliver. When `read_ct >= MAX_READ_CT`, atomically set the exact authorized
match to `final_failed`/`retry_processing_failed`, archive the message, and
send the friendly final email once. Do not send the generic admin failure
email as the only user-facing outcome.

Add expiry normalization to `retention_sweep()`:

```sql
update public.matches
set placement_status = 'final_failed',
    placement_failure_code = 'source_expired'
where placement_status = 'retry_available'
  and placement_retry_expires_at <= now()
```

- [ ] **Step 6: Run focused and full worker tests**

Run:

```bash
worker/venv/bin/python -m unittest \
  worker.tests.test_placement_retry_job \
  worker.tests.test_placement_notifications \
  worker.tests.test_worker_backfill \
  worker.tests.test_backfill_runner \
  worker.tests.test_placement_retry_calibration \
  worker.tests.test_placement_backfill_reconstruction \
  worker.tests.test_placement_reconstruction -v
```

Expected: all tests PASS.

- [ ] **Step 7: Commit the retry worker**

```bash
git add worker/worker.py worker/tests/test_placement_retry_job.py
git commit -m "feat: process one-time placement retries"
```

---

### Task 6: Match and Point Placement Status UI

**Files:**
- Create: `src/app/match/[id]/PlacementStatusCard.tsx`
- Create: `src/lib/placement/placementRetryView.test.ts`
- Modify: `src/lib/placement/placementRetry.ts`
- Modify: `src/app/match/[id]/MatchView.tsx:820-920`
- Modify: `src/app/match/[id]/MatchView.tsx:2979-3010`
- Modify: `src/app/match/[id]/PointDetail.tsx:75-120`
- Modify: `src/app/match/[id]/PointDetail.tsx:895-920`

**Interfaces:**
- Consumes: server-owned placement lifecycle fields, retry API, Supabase match-row polling, and existing placement aggregate/detail components.
- Produces: `placementRetryView()`, `PlacementStatusCard`, visible match-level retry/progress/final states, and compact point-level unavailable messaging.

- [ ] **Step 1: Write failing view-model tests**

Create `src/lib/placement/placementRetryView.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { placementRetryView } from "./placementRetry.ts";

const future = "2026-07-30T12:00:00Z";
const now = new Date("2026-07-29T12:00:00Z");

test("retry available exposes one friendly primary action", () => {
  assert.deepEqual(
    placementRetryView("retry_available", 0, future, now),
    {
      tone: "warning",
      title: "Placement maps need another try",
      action: "Try placement again",
      poll: false,
    },
  );
});

test("retrying polls and final failure never offers another action", () => {
  assert.equal(
    placementRetryView("retrying", 1, future, now).poll,
    true,
  );
  assert.equal(
    placementRetryView("final_failed", 1, future, now).action,
    null,
  );
  assert.equal(
    placementRetryView("ready", 1, future, now),
    null,
  );
});

test("expired retry shows final source-retention copy", () => {
  const view = placementRetryView(
    "retry_available", 0, "2026-07-28T12:00:00Z", now,
  );
  assert.equal(view.tone, "muted");
  assert.match(view.title, /no longer available/i);
  assert.equal(view.action, null);
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run:

```bash
node --test --experimental-strip-types \
  src/lib/placement/placementRetryView.test.ts
```

Expected: FAIL because `placementRetryView` is not exported.

- [ ] **Step 3: Implement the pure view model**

Extend `placementRetry.ts` with:

```ts
export interface PlacementRetryView {
  tone: "warning" | "progress" | "muted";
  title: string;
  body: string;
  action: string | null;
  poll: boolean;
}

export function placementRetryView(
  status: PlacementStatus,
  retryCount: number,
  expiresAt: string | null,
  now = new Date(),
): PlacementRetryView | null {
  if (
    status === "ready"
    || status === "not_requested"
    || status === "processing"
  ) {
    return null;
  }
  const expired =
    status === "retry_available"
    && (!expiresAt || new Date(expiresAt).getTime() <= now.getTime());
  if (expired) {
    return {
      tone: "muted",
      title: "Placement retry is no longer available",
      body:
        "The original recording has passed its processing-retention window. "
        + "Your points, score, clips, and notes are still available.",
      action: null,
      poll: false,
    };
  }
  if (status === "retry_available" && retryCount === 0) {
    return {
      tone: "warning",
      title: "Placement maps need another try",
      body:
        "Your match is ready, but we couldn't map the table reliably enough "
        + "to generate placement maps. The stronger retry is available once.",
      action: "Try placement again",
      poll: false,
    };
  }
  if (status === "retrying") {
    return {
      tone: "progress",
      title: "Generating placement maps…",
      body:
        "We're trying a stronger table-calibration method. You can leave "
        + "this page; we'll email you when it finishes.",
      action: null,
      poll: true,
    };
  }
  if (status === "final_failed" || retryCount > 0) {
    return {
      tone: "muted",
      title: "Placement maps couldn't be generated",
      body:
        "We tried again, but couldn't generate reliable placement maps from "
        + "this recording. Your points, score, clips, and notes are still "
        + "available.",
      action: null,
      poll: false,
    };
  }
  return null;
}
```

Keep these strings as the single copy source for both match-level and
point-level status surfaces.

- [ ] **Step 4: Build the client status card**

Create `PlacementStatusCard.tsx` with props:

```ts
interface PlacementStatusCardProps {
  matchId: string;
  initialStatus: PlacementStatus;
  retryCount: number;
  expiresAt: string | null;
  isOwner: boolean;
  onStatusChange: (status: PlacementStatus) => void;
}
```

Behavior:

- render nothing when `placementRetryView()` returns null;
- POST `{matchId}` to `/api/placement-retry` on the one action;
- disable immediately and show `retrying`;
- surface stable friendly API errors in an `aria-live` region;
- poll `matches.placement_status` and related fields every ten seconds while
  retrying;
- stop polling on unmount or terminal state;
- call `router.refresh()` when status becomes `ready` or `final_failed`; and
- never render the retry action for coaches/non-owners.

- [ ] **Step 5: Integrate match-level and point-level messaging**

In `MatchView`, keep local placement status synchronized with incoming match
props. Render `PlacementStatusCard` immediately before `PlacementAggregate`.
Suppress the aggregate's generic empty state while the explicit lifecycle
card is active.

Pass `placementStatus` into `PointDetail`. When the point has no drawable
placement and the match is `retry_available`, `retrying`, or `final_failed`,
pass the `body` returned by `placementRetryView()` as
`placementStatusMessage` and render:

```tsx
<section aria-label="Placement status">
  <h3 className="text-sm font-semibold text-zinc-200">
    Where the ball landed
  </h3>
  <p className="mt-2 text-sm text-zinc-500">
    {placementStatusMessage}
  </p>
</section>
```

Keep the retry action match-level; the point notice contains no button.

- [ ] **Step 6: Run UI tests, lint, and production build**

Run:

```bash
node --test --experimental-strip-types \
  src/lib/placement/placementRetry.test.ts \
  src/lib/placement/placementRetryView.test.ts \
  src/lib/placement/placementRetryMigration.test.ts
npm run test:placement
npx eslint src/lib/placement/placementRetry.ts \
  src/app/match/'[id]'/PlacementStatusCard.tsx \
  src/app/match/'[id]'/MatchView.tsx \
  src/app/match/'[id]'/PointDetail.tsx
npm run build
```

Expected: tests, lint, and build PASS.

- [ ] **Step 7: Commit the visible recovery experience**

```bash
git add src/lib/placement/placementRetry.ts \
  src/lib/placement/placementRetryView.test.ts \
  src/app/match/'[id]'/PlacementStatusCard.tsx \
  src/app/match/'[id]'/MatchView.tsx \
  src/app/match/'[id]'/PointDetail.tsx
git commit -m "feat: show and retry placement failures"
```

---

### Task 7: Operator Documentation and Full Verification

**Files:**
- Modify: `worker/README.md:212-235`
- Modify: `supabase/README-SETUP.md:134-165`

**Interfaces:**
- Consumes: completed schema, API, worker, email, and UI behavior.
- Produces: operator runbook for retry states/model configuration and complete verification evidence.

- [ ] **Step 1: Document worker configuration and support queries**

Add to `worker/README.md`:

```text
WORKER_PLACEMENT_VISION_MODEL
  Vision-capable OpenAI model used only for an owner-requested placement retry
  after deterministic calibration fails.
```

Document:

- `placement_retry` does not regenerate clips;
- the one-retry and seven-day rules;
- expected `ready` versus `final_failed` outcomes;
- structured failure codes;
- the SQL fields support should inspect; and
- that model output is temporary and locally validated.

Add migration `049_placement_retry.sql` to the setup/application order in
`supabase/README-SETUP.md`.

- [ ] **Step 2: Run the complete Python verification suite**

Run:

```bash
worker/venv/bin/python -m unittest discover -s worker/tests -v
```

Expected: all worker tests PASS with zero failures/errors.

- [ ] **Step 3: Run all JavaScript/TypeScript tests**

Run:

```bash
npm run test:auth
npm run test:placement
npm run test:research
node --test --experimental-strip-types src/app/learn/guides.test.ts
```

Expected: all tests PASS.

- [ ] **Step 4: Run lint and production build**

Run:

```bash
npm run lint
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 5: Inspect the final diff and lifecycle coverage**

Run:

```bash
git diff --check
git status --short
rg -n "placement_(status|retry_count|mapped_points|failure_code|retry_expires_at|retry_job_id)" \
  supabase/migrations/049_placement_retry.sql src worker
```

Confirm:

- every lifecycle field is written and read by the intended layer;
- only `request_placement_retry` creates retry jobs;
- expected inability to calibrate is not a poison queue failure;
- emails use direct match links and friendly copy; and
- no unrelated files or user changes are included.

- [ ] **Step 6: Commit documentation**

```bash
git add worker/README.md supabase/README-SETUP.md
git commit -m "docs: explain placement retry operations"
```

- [ ] **Step 7: Apply migration and perform a production-safe smoke test**

Apply only `supabase/migrations/049_placement_retry.sql` through the existing
direct Postgres migration workflow. Then use a designated test match or a
transaction-rolled-back fixture to verify:

1. owner RPC creates one queued `placement_retry` job;
2. a second RPC call creates no job;
3. worker picks up the exact recorded retry job;
4. status progresses `retry_available -> retrying -> ready|final_failed`;
5. terminal email is emitted once; and
6. existing point IDs, ranges, clips, scores, notes, and metadata are
   unchanged.

Do not manufacture a retry on an unrelated user's production match.
