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
