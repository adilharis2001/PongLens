# Lesson Recap Cloud Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Modal a low-cost lesson-recap backup that cannot claim work while the Mac is healthy and the queue is below the overload threshold.

**Architecture:** PostgreSQL is the authority for fallback eligibility and enforces it during claims. A tiny scheduled Modal dispatcher reads that decision and spawns the unscheduled heavy worker only when allowed. The admin Processing page renders the database switch rather than inferring it from historical heartbeats.

**Tech Stack:** PostgreSQL/Supabase, Python 3.12, Modal, TypeScript/Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-06-lesson-cloud-fallback-design.md`

## Global Constraints

- Keep `lesson_video_release.cloud_enabled` false in production.
- Outage is a 15-minute missing Mac heartbeat plus a 30-minute queued lesson.
- Overload is an oldest queued lesson age of 3 hours.
- The scheduled dispatcher requests 0.125 CPU and 128 MiB and scales down after two seconds.
- The heavy worker remains one container and has no schedule.
- No production upload test is part of this change.

---

### Task 1: Database fallback authority

**Files:**
- Create: `supabase/migrations/20260906223000_lesson_cloud_fallback.sql`
- Test: `worker/tests/test_lesson_cloud_fallback_db.py`

**Interfaces:**
- Produces: `public.lesson_video_cloud_dispatch_ready(text) returns boolean`
- Modifies: `public.claim_lesson_video(text,text,boolean)`

- [ ] Write local-Postgres tests proving disabled and healthy/fresh cloud claims refuse, while outage and overload claims succeed.
- [ ] Run the focused test against the old function and confirm the healthy/fresh case fails by claiming a lesson.
- [ ] Add the readiness function and enforce it inside cloud claims without changing Mac claims.
- [ ] Apply the migration locally and run the focused database tests green.

### Task 2: Cheap dispatcher and unscheduled heavy worker

**Files:**
- Create: `worker/lesson_cloud_dispatch.py`
- Modify: `worker/lesson_release/modal_app.py`
- Modify: `worker/lesson_release/package.py`
- Modify: `worker/tests/test_lesson_release.py`

**Interfaces:**
- Produces: `cloud_dispatch_ready(release_id: str, environ=None, opener=None) -> bool`
- Consumes: `public.lesson_video_cloud_dispatch_ready(text)`

- [ ] Write tests for literal true/false RPC responses and for the sealed payload containing the dispatcher.
- [ ] Run the focused tests and confirm they fail because the dispatcher does not exist.
- [ ] Implement the standard-library RPC client.
- [ ] Replace the expensive scheduled `poll_once` with a tiny scheduled `dispatch_once`; move processing to unscheduled `run_cloud_job`.
- [ ] Run the lesson release tests green.

### Task 3: Honest Processing page state

**Files:**
- Modify: `src/app/admin/processing/processingView.ts`
- Modify: `src/app/admin/processing/processingView.test.ts`
- Modify: `supabase/migrations/20260906223000_lesson_cloud_fallback.sql`

**Interfaces:**
- Adds: `LessonWorkers.cloud_enabled?: boolean`

- [ ] Write a failing test that historical cloud heartbeats still render `Off` when cloud processing is disabled.
- [ ] Make the cloud row use `cloud_enabled`, with plain disabled copy.
- [ ] Extend `admin_processing_overview()` to return the switch.
- [ ] Run the focused TypeScript tests green.

### Task 4: Deploy safely and verify

**Files:**
- Modify: `docs/modal-worker-operations.md`

- [ ] Document the lesson fallback thresholds, switch, and dispatcher/heavy-worker split.
- [ ] Run focused Python, database, TypeScript, migration, and build verification.
- [ ] Apply the database migration while `cloud_enabled` is false.
- [ ] Stop the deployed lesson and match Modal apps while cloud processing is disabled; keep the corrected lesson bundle ready for the final synchronized rollout.
- [ ] Verify production reports cloud disabled and Modal has no running containers.
- [ ] Commit the isolated branch and report exactly what was and was not tested.
