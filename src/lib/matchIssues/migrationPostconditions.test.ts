import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const path =
  "supabase/migrations/20260907200000_match_version_postconditions.sql";
const sql = existsSync(path) ? readFileSync(path, "utf8") : "";

test("version migration rewrites have explicit deployment postconditions", () => {
  for (const token of [
    "require_active_point",
    "require_active_reel_manifest",
    "active_point_version",
    "match_processing_versions pv",
    "active_match_points",
    "match_reprocessing_enabled",
  ]) {
    assert.ok(sql.includes(token), token);
  }
  assert.match(sql, /raise exception 'match version migration postcondition failed/i);
});

test("admin review rewrites have explicit deployment postconditions", () => {
  for (const token of [
    "_match_issue_refundable_minutes",
    "candidate_ready",
    "execution_failed",
    "reverses_id",
    "previous run has not failed",
    "unsupported option",
  ]) {
    assert.ok(sql.includes(token), token);
  }
  assert.match(sql, /raise exception 'match admin migration postcondition failed/i);
});
