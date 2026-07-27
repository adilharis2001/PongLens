import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/034_research_fused_labeling.sql", import.meta.url),
  "utf8",
).toLowerCase();
const hardening = readFileSync(
  new URL(
    "../../../supabase/migrations/035_research_reviewer_assignment.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();

test("research migration enables RLS on every exposed research table", () => {
  for (const table of [
    "research_batches",
    "research_reviewers",
    "research_sources",
    "research_assignments",
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
});

test("research migration explicitly blocks anonymous access", () => {
  for (const table of [
    "research_batches",
    "research_reviewers",
    "research_sources",
    "research_assignments",
  ]) {
    assert.match(migration, new RegExp(`revoke all on public\\.${table} from anon`));
  }
});

test("reviewers cannot mutate immutable source or proposal rows", () => {
  assert.match(
    migration,
    /revoke insert, update, delete on public\.research_sources from authenticated/,
  );
  assert.match(
    migration,
    /grant update \(status, human_label, review_metrics, started_at, submitted_at\)/,
  );
});

test("source visibility is tied to an assignment or administrator", () => {
  assert.match(migration, /research_sources_assigned_select/);
  assert.match(migration, /a\.reviewer_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /public\.is_admin\(\)/);
});

test("hardening revokes the inherited public role and adds admin assignment", () => {
  assert.match(hardening, /revoke all on public\.research_sources from public/);
  assert.match(hardening, /create or replace function public\.research_assign_batch/);
  assert.match(hardening, /if not public\.is_admin\(\)/);
  assert.match(hardening, /on conflict \(batch_id, reviewer_id, sequence\) do nothing/);
});
