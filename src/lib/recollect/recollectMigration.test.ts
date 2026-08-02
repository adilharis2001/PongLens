import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RECOLLECT_PROCESSOR_VERSION } from "./types.ts";

const sql = readFileSync(
  new URL("../../../supabase/migrations/057_recollect.sql", import.meta.url),
  "utf8",
);
const qualitySql = readFileSync(
  new URL("../../../supabase/migrations/058_recollect_quality.sql", import.meta.url),
  "utf8",
);
const v3Sql = readFileSync(
  new URL("../../../supabase/migrations/059_recollect_v3.sql", import.meta.url),
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

test("re-enabling uses the current quality-gate version", () => {
  assert.match(sql, /'recollect-v2'/);
  assert.match(qualitySql, /create or replace function public\.set_recollect_enabled/);
  assert.match(qualitySql, /'recollect-v2'/);
  // The newest migration wins, and it has to agree with the processor.
  assert.match(v3Sql, /create or replace function public\.set_recollect_enabled/);
  assert.match(v3Sql, new RegExp(`'${RECOLLECT_PROCESSOR_VERSION}'`));
  assert.equal(RECOLLECT_PROCESSOR_VERSION, "recollect-v3");
});

test("re-enabling dates reminders from the lesson, not from the re-enable", () => {
  const reenableSql = readFileSync(
    new URL(
      "../../../supabase/migrations/064_recollect_reenable_due.sql",
      import.meta.url,
    ),
    "utf8",
  );
  // Comments quote the old value, so assert against the statements only.
  const statements = reenableSql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  assert.match(
    statements,
    /create or replace function public\.set_recollect_enabled/,
  );
  // next_due_at is copied from first_due_at on completion, so dating the
  // backfill from now() hid every reminder for 24 hours after a re-enable.
  assert.match(statements, /l\.created_at \+ interval '1 day'/);
  assert.doesNotMatch(statements, /now\(\) \+ interval '1 day'/);
  // 058 and 059 both replace this function; copying 058's body would
  // silently downgrade the processor version.
  assert.match(statements, new RegExp(`'${RECOLLECT_PROCESSOR_VERSION}'`));
  assert.doesNotMatch(statements, /'recollect-v2'/);
});
