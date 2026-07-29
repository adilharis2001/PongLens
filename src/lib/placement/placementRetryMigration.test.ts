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
