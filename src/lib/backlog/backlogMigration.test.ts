/**
 * Migration contract test for 088 (the backlog), in the style of
 * reviewsMigration.test.ts: assert the SQL carries the DDL the page
 * depends on, so a hand-edit that drops a piece fails here rather than in
 * the browser.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { LANE_LABEL } from "./types.ts";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/088_backlog.sql"),
  "utf8",
);

test("the table exists with the columns the page reads", () => {
  assert.ok(sql.includes("create table public.backlog_items"));
  for (const column of [
    "author_id",
    "title",
    "notes",
    "tag",
    "lane",
    "target_date",
    "created_at",
    "updated_at",
    "done_at",
  ]) {
    assert.ok(sql.includes(column), column);
  }
});

test("the lane vocabulary matches the app's", () => {
  for (const lane of Object.keys(LANE_LABEL)) {
    assert.ok(sql.includes(`'${lane}'`), lane);
  }
});

test("target_date is nullable — capture must never require a date", () => {
  assert.ok(/target_date date,/.test(sql));
  assert.ok(!/target_date date not null/.test(sql));
});

test("tag is free text, not an enum", () => {
  assert.ok(/tag\s+text not null default ''/.test(sql));
  assert.ok(!/tag\s+text[^,]*check \(tag in \(/.test(sql));
});

test("done_at can never disagree with the lane", () => {
  assert.ok(sql.includes("backlog_done_at_matches_lane"));
  assert.ok(sql.includes("check ((lane = 'done') = (done_at is not null))"));
  assert.ok(sql.includes("create or replace function public.backlog_stamp_done"));
  assert.ok(sql.includes("create trigger backlog_items_stamp_done"));
});

test("updated_at is maintained by the shared trigger", () => {
  assert.ok(sql.includes("create trigger backlog_items_set_updated_at"));
  assert.ok(sql.includes("public.set_updated_at()"));
});

// Authorship alone would expose the table to any signed-in account once a
// row existed under another id; is_admin() alone would let a second admin
// read this one's notebook. Both halves, on both sides.
test("RLS requires admin AND authorship, for using and with check", () => {
  assert.ok(sql.includes("alter table public.backlog_items enable row level security"));
  assert.ok(
    sql.includes(
      "using (author_id = (select auth.uid()) and public.is_admin())",
    ),
  );
  assert.ok(
    sql.includes(
      "with check (author_id = (select auth.uid()) and public.is_admin())",
    ),
  );
  assert.ok(sql.includes("revoke all on public.backlog_items from anon"));
});

test("the page's two reads are indexed", () => {
  assert.ok(sql.includes("backlog_items_open_idx"));
  assert.ok(sql.includes("backlog_items_done_idx"));
});
