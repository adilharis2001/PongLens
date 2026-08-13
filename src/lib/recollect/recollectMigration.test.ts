import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RECOLLECT_PROCESSOR_VERSION,
  RECOLLECT_TOPIC_KEYS,
} from "./types.ts";

const sql = readFileSync(
  new URL("../../../supabase/migrations/108_recollect_topics.sql", import.meta.url),
  "utf8",
);

test("the topic migration creates private durable state", () => {
  for (const table of ["recollect_topics", "recollect_points", "recollect_jobs"]) {
    assert.match(sql, new RegExp(`create table public\\.${table}`));
    assert.match(
      sql,
      new RegExp(`alter table public\\.${table} enable row level security`),
    );
  }
  assert.match(sql, /unique \(user_id, topic_key\)/);
  assert.match(sql, /references public\.lessons \(id\) on delete cascade/);
});

test("the question-card tables and functions are gone", () => {
  assert.match(sql, /drop table if exists public\.recollect_items/);
  assert.match(sql, /drop table if exists public\.recollect_item_sources/);
  assert.match(sql, /drop function if exists public\.reveal_recollect_item/);
});

test("the closed topic list agrees between SQL and code", () => {
  const constraint = sql.match(/topic_key in \(([\s\S]*?)\)/)?.[1] ?? "";
  const inSql = [...constraint.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...inSql].sort(), [...RECOLLECT_TOPIC_KEYS].sort());
});

test("Recollect mutations stay service-only and owner-scoped", () => {
  for (const fn of [
    "enqueue_recollect_source",
    "claim_recollect_job",
    "complete_recollect_job",
    "open_recollect_topic",
    "dismiss_recollect_point",
    "add_recollect_point_to_working_on",
    "set_recollect_enabled",
  ]) {
    assert.match(sql, new RegExp(`function public\\.${fn}`));
    assert.match(
      sql,
      new RegExp(`revoke execute on function public\\.${fn}[\\s\\S]*?from public`),
    );
  }
  assert.match(sql, /p_owner_id/);
  assert.match(sql, /for update skip locked/);
});

test("a long entry that was never distilled is not queued", () => {
  // Recollect reads distilled text or a short note, never raw speech-to-text.
  assert.match(sql, /takeaways is null[\s\S]*?>= 600[\s\S]*?'queued', false/);
});

test("disabling deletes derived data but never the journal", () => {
  assert.match(sql, /delete from public\.recollect_points where user_id/);
  assert.match(sql, /delete from public\.recollect_topics where user_id/);
  assert.doesNotMatch(sql, /delete from public\.lessons/);
  assert.match(sql, new RegExp(`'${RECOLLECT_PROCESSOR_VERSION}'`));
});

test("opening a topic is idempotent within one review", () => {
  assert.match(sql, /last_review_key is not distinct from p_review_key/);
  assert.match(sql, /order by last_shown_at asc nulls first/);
});
