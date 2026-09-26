import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Replace, processed automatically (Cut again, phase 2): the guards read out
// of the migration, and the one call three surfaces make, checked against
// each other. Behaviour is proved on a real Postgres by
// supabase/tests/cut_again_auto.sql (commands in
// supabase/tests/cut_again_auto_stubs.sql); the main lane's half by
// worker/tests/test_auto_recut.py.
const sql = readFileSync("supabase/migrations/20260925170532_cut_again_auto_replace.sql", "utf8");
const code = sql.replace(/--.*$/gm, "");
const web = readFileSync("src/app/match/[id]/recut/MoreOptions.tsx", "utf8");
const ios = readFileSync("ios/PongLens/PongLens/Core/CutAgainModel.swift", "utf8");
const iosCore = readFileSync("ios/PongLens/PongLens/Core/CutAgain.swift", "utf8");

function fn(name: string): string {
  const start = code.search(new RegExp(`create or replace function public\\.${name}\\(`, "i"));
  assert.ok(start >= 0, `${name} is defined`);
  const rest = code.slice(start);
  return rest.slice(0, rest.search(/\n\$(function)?\$;/));
}

test("the switch stays off until the release step turns it on", () => {
  assert.doesNotMatch(code, /update public\.app_config/i);
  assert.doesNotMatch(code, /insert into public\.app_config/i);
  // One reading of it, by the options and by the claim.
  assert.match(fn("recut_options"), /v_auto_on := public\._recut_auto_replace_on\(\);/);
  assert.match(fn("claim_auto_recut"), /if not public\._recut_auto_replace_on\(\) then/);
  assert.match(fn("_recut_auto_replace_on"), /when 'admins' then public\.is_admin\(\)/);
});

test("claim_auto_recut is the contract's call, the owner's only", () => {
  assert.match(
    code,
    /create or replace function public\.claim_auto_recut\(p_match_id uuid,\s*p_replace boolean,\s*p_trim_start_s numeric,\s*p_trim_end_s numeric,\s*p_strictness text\)\s*returns jsonb/,
  );
  assert.match(code, /revoke all on function public\.claim_auto_recut\(uuid, boolean, numeric, numeric, text\)\s*from public, anon;/);
  assert.match(code, /grant execute on function public\.claim_auto_recut\(uuid, boolean, numeric, numeric, text\)\s*to authenticated;/);
  const claim = fn("claim_auto_recut");
  assert.match(claim, /security definer/);
  assert.match(claim, /where id = p_match_id and user_id = v_me\s*for update/);
  assert.match(claim, /return jsonb_build_object\('job_id', v_job, 'match_id', p_match_id\);/);
  // The same refusals as the hand claim, in its order, then the charge's.
  const order = ["_recut_busy", "bad_state", "_recut_support_request_open", "no_source",
    "duration_unknown", "_recut_has_coach_review", "_recut_auto_replace_on", "commerce_disabled",
    "trim_too_short", "queue_full", "insufficient_minutes"];
  let at = -1;
  for (const marker of order) {
    const next = claim.indexOf(marker, at + 1);
    assert.ok(next > at, `${marker} comes after the one before`);
    at = next;
  }
  // claim_processing's charge, to the line.
  assert.match(claim, /v_charge := greatest\(1, ceil\(\(v_end - v_start\) \/ 60\.0\)\)::integer;/);
  assert.match(claim, /\(v_me, -v_charge, 'spend', 'personal', v_mode, p_match_id, v_job, null\)/);
});

test("web and iOS send exactly the claim's parameters", () => {
  const params = ["p_match_id", "p_replace", "p_trim_start_s", "p_trim_end_s", "p_strictness"];
  const webCall = web.slice(web.indexOf('rpc("claim_auto_recut"'), web.indexOf('rpc("claim_auto_recut"') + 300);
  const iosCall = ios.slice(ios.indexOf("claimAutoRecut: { id, settings, replace in"), ios.indexOf("claimAutoRecut: { id, settings, replace in") + 900);
  // The iPhone's parameters are a struct of their own (AutoRecutParams,
  // Core/CutAgain.swift) since strictness became a constant there; Keep
  // and Replace both go through it since 2026-09-26 (one step for Keep).
  assert.match(iosCall, /"claim_auto_recut",\s*params: AutoRecutParams\(matchId: id, settings: settings, replace: replace\)/);
  const iosParams = iosCore.slice(iosCore.indexOf("struct AutoRecutParams"), iosCore.indexOf("// MARK: - start_recut"));
  for (const name of params) {
    assert.ok(webCall.includes(`${name}:`), `web sends ${name}`);
    assert.ok(iosParams.includes(`let ${name}:`), `iOS sends ${name}`);
  }
  // Both always ask for "normal" (Adil, 2026-09-25).
  assert.match(iosParams, /p_strictness = ProcessSettings\.strictness/);
  assert.match(iosCore, /static let strictness = "normal"/);
});

test("a failed re-cut never touches the live match and gives the minutes back", () => {
  const fail = fn("fail_auto_recut");
  assert.match(fail, /if v\.status <> 'candidate' then\s*return false;/);
  assert.match(fail, /processing_version_id = v\.id/);
  assert.match(fail, /public\._refund_auto_recut\(p_job_id\)/);
  assert.doesNotMatch(fail, /update public\.matches/);
  assert.match(fn("_refund_auto_recut"), /on conflict \(reverses_id\) where kind = 'refund' do nothing/);
});

test("the replaced cut's files: retired only by the player's own re-cut, and restores refuse once swept", () => {
  const retired = fn("retired_processing_versions");
  assert.match(retired, /w\.issue_id is null/);
  assert.match(retired, /w\.activated_at is not null/);
  assert.match(retired, /v\.media_swept_at is null/);
  assert.match(fn("activate_match_processing_version"), /if v\.media_swept_at is not null then raise exception 'version files were removed'/);
  for (const signature of [
    "retired_processing_versions\\(interval\\)",
    "media_keys_in_use\\(text\\[\\], uuid\\[\\]\\)",
    "claim_retired_version_sweep\\(uuid, interval\\)",
    "publish_auto_recut\\(uuid, text, text, text, jsonb, jsonb, text\\)",
    "activate_pending_auto_recuts\\(\\)",
    "fail_auto_recut\\(uuid, text\\)",
  ]) {
    assert.match(code, new RegExp(`revoke all on function public\\.${signature}\\s*from public, anon, authenticated;`), signature);
    assert.match(code, new RegExp(`grant execute on function public\\.${signature}\\s+to service_role;`), signature);
  }
});

test("the rollout guard lets the player's job through without a helper the apps cannot run", () => {
  const guard = fn("guard_match_reprocess_job_rollout");
  assert.doesNotMatch(guard, /security definer/i);
  assert.doesNotMatch(guard, /public\._/);
  assert.match(guard, /not \(new\.options \? 'issue_id'\)/);
});
