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
const placement = readFileSync(
  new URL(
    "../../../supabase/migrations/055_placement_calibration_research.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();
const serveDetection = readFileSync(
  new URL(
    "../../../supabase/migrations/056_serve_detection_research.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();
const winnerConstrainedEnding = readFileSync(
  new URL(
    "../../../supabase/migrations/057_winner_constrained_ending_research.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();
const serveFollowupExport = readFileSync(
  new URL(
    "../../../supabase/migrations/059_serve_followup_export.sql",
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

test("placement research migration allows only the two permanent media namespaces", () => {
  assert.match(placement, /drop constraint if exists research_sources_media_key_check/);
  assert.match(placement, /fused-labeling/);
  assert.match(placement, /placement-calibration/);
  assert.doesNotMatch(placement, /research\/\.\*/);
  assert.doesNotMatch(placement, /grant\s/);
  assert.doesNotMatch(placement, /disable row level security/);
});

test("serve research migration narrowly adds the third permanent media namespace", () => {
  assert.match(
    serveDetection,
    /drop constraint if exists research_sources_media_key_check/,
  );
  assert.match(serveDetection, /fused-labeling/);
  assert.match(serveDetection, /placement-calibration/);
  assert.match(serveDetection, /serve-detection/);
  assert.match(serveDetection, /v\[0-9\]\+/);
  assert.match(serveDetection, /\[0-9a-f-\]\{36\}/);
  assert.doesNotMatch(serveDetection, /research\/\.\*/);
  assert.doesNotMatch(serveDetection, /grant\s/);
  assert.doesNotMatch(serveDetection, /disable row level security/);
});

test("winner ending migration narrowly adds the fourth permanent media namespace", () => {
  assert.match(
    winnerConstrainedEnding,
    /fused-labeling\|placement-calibration\|serve-detection\|winner-constrained-endings/,
  );
  assert.match(winnerConstrainedEnding, /v\[0-9\]\+\/sources/);
  assert.match(winnerConstrainedEnding, /\[0-9a-f-\]\{36\}/);
  assert.doesNotMatch(winnerConstrainedEnding, /research\/\.\*/);
});

test("serve follow-up export includes evidence while retaining the admin gate", () => {
  assert.match(serveFollowupExport, /'proposal', s\.proposal/);
  assert.match(serveFollowupExport, /'prefill', s\.prefill/);
  assert.match(
    serveFollowupExport,
    /when not public\.is_admin\(\) then/,
  );
  assert.match(
    serveFollowupExport,
    /security definer[\s\S]*set search_path = public/,
  );
  assert.match(
    serveFollowupExport,
    /revoke execute on function public\.research_export_batch\(uuid\)[\s\S]*from public, anon/,
  );
  assert.match(
    serveFollowupExport,
    /grant execute on function public\.research_export_batch\(uuid\)[\s\S]*to authenticated/,
  );
});
