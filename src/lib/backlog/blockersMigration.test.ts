/**
 * Migration contract test for 090 (backlog dependencies). Same job as
 * backlogMigration.test.ts: the SQL must still carry the pieces the page
 * and the logic module assume.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/090_backlog_blockers.sql"),
  "utf8",
);

test("the edge table exists with both ends", () => {
  assert.ok(sql.includes("create table public.backlog_blockers"));
  assert.ok(sql.includes("item_id"));
  assert.ok(sql.includes("blocker_id"));
  assert.ok(sql.includes("primary key (item_id, blocker_id)"));
});

test("deleting either item drops the edge rather than orphaning it", () => {
  const cascades = sql.match(/on delete cascade/g) ?? [];
  assert.ok(cascades.length >= 2, "both foreign keys cascade");
});

test("an item cannot wait on itself", () => {
  assert.ok(sql.includes("backlog_blockers_not_self"));
  assert.ok(sql.includes("check (item_id <> blocker_id)"));
});

// Without this the readiness walk recurses forever and neither item can
// ever be startable.
test("longer cycles are refused by a trigger, not left to the client", () => {
  assert.ok(sql.includes("backlog_blockers_no_cycle"));
  assert.ok(sql.includes("with recursive upstream"));
  assert.ok(sql.includes("create trigger backlog_blockers_no_cycle"));
  assert.ok(sql.includes("before insert or update"));
});

// The blocker_id half of `with check` is the one that is easy to omit and
// would let an edge point at somebody else's row.
test("RLS checks BOTH ends belong to the caller", () => {
  assert.ok(sql.includes("enable row level security"));
  const withCheck = sql.slice(sql.indexOf("with check"));
  assert.ok(withCheck.includes("i.id = backlog_blockers.item_id"));
  assert.ok(withCheck.includes("b.id = backlog_blockers.blocker_id"));
  assert.ok(withCheck.includes("public.is_admin()"));
  assert.ok(sql.includes("revoke all on public.backlog_blockers from anon"));
});

// Edges are added and removed, never edited in place.
test("the grant covers select, insert and delete", () => {
  assert.ok(
    sql.includes(
      "grant select, insert, delete on public.backlog_blockers to authenticated",
    ),
  );
});

test("the reverse lookup is indexed", () => {
  assert.ok(sql.includes("backlog_blockers_blocker_idx"));
});
