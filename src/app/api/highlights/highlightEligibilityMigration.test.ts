import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const eligibilityPath =
  "supabase/migrations/20260910190000_highlight_score_eligibility.sql";
const guardPath =
  "supabase/migrations/20260910191000_highlight_enqueue_score_guard.sql";
const eligibilitySql = existsSync(eligibilityPath)
  ? readFileSync(eligibilityPath, "utf8")
  : "";
const guardSql = existsSync(guardPath) ? readFileSync(guardPath, "utf8") : "";

test("highlight eligibility counts only active scorable points", () => {
  assert.match(
    eligibilitySql,
    /create or replace function public\.highlight_generation_eligibility\(p_match_id uuid\)/i,
  );
  assert.match(
    eligibilitySql,
    /p\.processing_version_id\s*=\s*m\.active_processing_version_id/i,
  );
  assert.match(eligibilitySql, /not p\.deleted/i);
  assert.match(eligibilitySql, /not p\.is_let/i);
  assert.match(
    eligibilitySql,
    /p\.confirmed_winner\s+in\s*\('user',\s*'opponent'\)/i,
  );
});

test("highlight eligibility uses exact 75 percent arithmetic and rejects non-matches", () => {
  assert.match(eligibilitySql, /v_scored \* 4 >= v_scorable \* 3/i);
  assert.match(eligibilitySql, /\(v_scorable \* 3 \+ 3\) \/ 4/i);
  assert.match(eligibilitySql, /v_scorable > 0/i);
  assert.match(eligibilitySql, /match_type in \('drills', 'practice'\)/i);
  assert.match(eligibilitySql, /required_percent[\s\S]*75/i);
});

test("highlight availability is private and copied without enabling new users", () => {
  assert.match(eligibilitySql, /'highlights_enabled'/i);
  assert.match(eligibilitySql, /'automatic_highlights'/i);
  assert.match(
    eligibilitySql,
    /revoke all on function public\.highlight_generation_eligibility\(uuid\)\s+from public, anon, authenticated/i,
  );
  assert.match(
    eligibilitySql,
    /grant execute on function public\.highlight_generation_eligibility\(uuid\)\s+to service_role/i,
  );
});

test("the separately deployable queue guard protects highlights only", () => {
  assert.match(guardSql, /pg_get_functiondef\([\s\S]*'public\.enqueue_reel/i);
  assert.match(guardSql, /p_scope = ''highlights''/i);
  assert.match(guardSql, /highlight_generation_eligibility\(p_match_id\)/i);
  assert.match(guardSql, /highlights_score_required/i);
  assert.match(guardSql, /errcode\s*=\s*''P0001''/i);
  assert.match(guardSql, /match not found[\s\S]*highlights_score_required/i);
});
