import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const path =
  "supabase/migrations/20260907220000_match_reprocess_rollout_gate.sql";
const sql = existsSync(path) ? readFileSync(path, "utf8") : "";

test("match reprocessing is default-off with a server-owned QA path", () => {
  assert.match(
    sql,
    /insert into public\.app_config \(key, value\)[\s\S]*'match_reprocessing_enabled',\s*'false'/i,
  );
  assert.match(sql, /create or replace function public\.match_reprocessing_enabled\(p_owner_id uuid\)/i);
  assert.match(sql, /public\.is_admin\(\)/i);
  assert.match(sql, /from public\.app_config[\s\S]*key = 'match_reprocessing_enabled'/i);
  assert.match(
    sql,
    /revoke all on function public\.match_reprocessing_enabled\(uuid\)\s+from public, anon, authenticated/i,
  );
});

test("the gate covers eligibility, owner submission, and candidate mutation", () => {
  assert.match(
    sql,
    /'canReprocess',[\s\S]*public\.match_reprocessing_enabled\(v_match\.user_id\)/i,
  );
  assert.match(
    sql,
    /new\.kind = 'reprocess'[\s\S]*not public\.match_reprocessing_enabled\(new\.owner_id\)/i,
  );
  assert.match(
    sql,
    /new\.kind = 'match_reprocess'[\s\S]*not public\.match_reprocessing_enabled\(new\.user_id\)/i,
  );
  assert.match(sql, /raise exception 'match reprocessing is not enabled'/i);
});

test("function rewrites abort if the installed baseline drifts", () => {
  assert.match(sql, /v_matches\s*:=\s*\(length\(definition\)/i);
  assert.match(sql, /if v_matches <> 1 then[\s\S]*raise exception/i);
  assert.match(sql, /unexpected match issue state definition/i);
});
