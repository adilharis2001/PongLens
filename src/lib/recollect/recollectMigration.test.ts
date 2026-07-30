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
    assert.match(
      sql,
      new RegExp(`alter table public\\.${table} enable row level security`),
    );
  }
  assert.match(
    sql,
    /unique \(lesson_id, content_hash, processor_version\)/,
  );
  assert.match(
    sql,
    /references public\.lessons \(id\) on delete cascade/,
  );
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
  assert.match(
    sql,
    /revoke execute on function public\.claim_recollect_job[\s\S]*from public/,
  );
  assert.match(
    sql,
    /grant execute on function public\.claim_recollect_job[\s\S]*to service_role/,
  );
  assert.match(sql, /p_owner_id/);
  assert.match(sql, /for update skip locked/);
});

test("disabling deletes derived data but preserves lessons and preference", () => {
  assert.match(sql, /delete from public\.recollect_jobs/);
  assert.match(sql, /delete from public\.recollect_items/);
  assert.match(sql, /insert into public\.recollect_preferences/);
  assert.doesNotMatch(sql, /delete from public\.lessons/);
});

test("reveals are idempotent and use the approved schedule", () => {
  assert.match(sql, /last_review_key = p_review_key/);
  for (const days of [3, 7, 14, 30, 60]) {
    assert.match(sql, new RegExp(`interval '${days} days'`));
  }
});
