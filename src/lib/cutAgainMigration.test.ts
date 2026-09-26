import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// The guards that make cutting a match again safe, read out of the
// migration so a later edit cannot quietly drop one. Behaviour is checked
// against a real Postgres by supabase/tests/cut_again.sql (commands in
// supabase/tests/cut_again_stubs.sql); the hand lane's half by
// worker/tests/test_hand_recut.py.
const sql = readFileSync("supabase/migrations/20260925124616_cut_again.sql", "utf8");
const handoff = readFileSync(
  "supabase/migrations/20260925105830_device_hand_cut_silent_handoff.sql",
  "utf8",
);
const device = readFileSync("supabase/migrations/20260925061009_device_hand_cut.sql", "utf8");
const code = sql.replace(/--.*$/gm, "");

function definitionIn(text: string, name: string): string | null {
  const start = text.search(
    new RegExp(`create or replace function public\\.${name}\\(`, "i"),
  );
  if (start < 0) return null;
  const rest = text.slice(start);
  const end = rest.search(/\n\$(function)?\$;/);
  return rest.slice(0, end);
}

function fn(name: string, text = sql): string {
  const body = definitionIn(text, name);
  assert.ok(body, `${name} is defined`);
  return body;
}

/** The marks loop, with the one name that differs between the two. */
function marksLoop(body: string, duration: string): string {
  const start = body.indexOf("for v_mark in select * from jsonb_array_elements(p_marks) loop");
  const end = body.indexOf("end loop;", start);
  assert.ok(start >= 0 && end > start, "marks loop");
  return body
    .slice(start, end)
    .replace(duration, "DURATION")
    .replace(/\s+/g, " ");
}

test("the four contract calls are the owner's, and only theirs", () => {
  for (const signature of [
    "recut_options\\(uuid\\)",
    "start_recut\\(uuid, boolean\\)",
    "claim_hand_recut\\(uuid, jsonb, boolean\\)",
    "copy_match_for_recut\\(uuid\\)",
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${signature} from public, anon;`), signature);
    assert.match(sql, new RegExp(`grant execute on function public\\.${signature} to authenticated;`), signature);
  }
  for (const name of ["recut_options", "start_recut", "claim_hand_recut", "copy_match_for_recut"]) {
    assert.match(fn(name), /security definer/, name);
    assert.match(fn(name), /where id = p_match_id and user_id = v_me/, name);
  }
  assert.match(fn("start_recut"), /p_fresh boolean default false/);
});

test("every new private function is closed to clients", () => {
  const replaced = new Set([
    "sync_active_match_processing_version", "activate_match_processing_version",
    "resolve_share_placement", "_hand_cut_hand_back", "normalize_manual_cut_observations",
    "jobs_notify_failed", "admin_start_match_reprocess", "ledger_on_match_delete",
    "recut_options", "start_recut", "claim_hand_recut", "copy_match_for_recut",
  ]);
  const names = [...code.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
  for (const name of names) {
    if (replaced.has(name)) continue;
    assert.match(
      code,
      new RegExp(`revoke all on function public\\.${name}\\([^)]*\\)\\s+from public, anon, authenticated;`),
      name,
    );
  }
  for (const name of ["publish_hand_recut", "activate_hand_recut", "activate_pending_hand_recuts"]) {
    assert.match(code, new RegExp(`grant execute on function public\\.${name}\\([^)]*\\)\\s+to service_role;`), name);
    assert.doesNotMatch(code, new RegExp(`grant execute on function public\\.${name}\\([^)]*\\)\\s+to authenticated`), name);
  }
});

test("options say why nothing can start, with the contract's reasons", () => {
  const reason = fn("_recut_reason");
  for (const code of ["processing", "not_ready", "support_request", "no_source"]) {
    assert.match(reason, new RegExp(`then '${code}'`), code);
  }
  const options = fn("recut_options");
  for (const key of [
    "available", "reason", "replace_by_hand", "replace_automatic",
    "has_coach_review", "has_match_notes", "cut_source",
  ]) {
    assert.match(options, new RegExp(`'${key}',`), key);
  }
  assert.match(options, /'replace_by_hand', v_reason is null and v_hand and not v_review/);
  assert.match(options, /'replace_automatic', v_reason is null and v_auto_on and not v_review/);
  assert.match(options, /key = 'recut_auto_replace'/);
  // Assumption A: every review order except one that never became a review.
  assert.match(fn("_recut_has_coach_review"), /o\.status not in \('declined', 'cancelled'\)/);
  // Assumption C: the open support request is the active-remedy predicate.
  assert.match(
    fn("_recut_support_request_open"),
    /f\.kind in \('reprocess', 'refund'\)\s+and f\.status in \('pending', 'reprocess_queued', 'reprocessing',\s+'candidate_ready'\)/,
  );
  // One open cut per match: a cut job, the content check, or a waiting re-cut.
  const busy = fn("_recut_busy");
  assert.match(busy, /'deadspace_cut', 'youtube_import', 'hand_cut',\s+'match_reprocess', 'content_check'/);
  assert.match(busy, /v\.issue_id is null\s+and v\.status in \('candidate', 'ready'\)/);
});

test("the Replace claim builds a candidate and never touches the match", () => {
  const claim = fn("claim_hand_recut");
  for (const code of [
    "not_authenticated", "invalid_request", "not_enabled", "not_found",
    "already_processing", "bad_state", "support_request", "no_source",
    "duration_unknown", "coach_review", "queue_full",
  ]) {
    assert.match(claim, new RegExp(`raise exception '${code}'`), code);
  }
  assert.match(claim, /hand_cut_enabled\(v_me\)/);
  assert.match(claim, /for update;/);
  assert.match(claim, /_hand_cut_validate_marks\(p_marks, v_match\.duration_s\)/);
  const replace = claim.slice(claim.indexOf("if public._recut_has_coach_review"));
  assert.match(replace, /'candidate', v_match\.raw_path/);
  assert.match(replace, /'recut', 'replace'/);
  assert.match(replace, /'processing_version_id', v_version/);
  assert.match(replace, /update public\.match_processing_versions set job_id = v_job/);
  assert.doesNotMatch(replace, /update public\.matches/);
  // The Keep claim is the ordinary hand cut on the copy.
  assert.match(claim, /v_new := public\._copy_match_for_recut\(v_match\);\s+[\s\S]*?public\.claim_hand_cut\(v_new, p_marks\)/);
  // The mark checks are claim_hand_cut's, word for word.
  assert.equal(
    marksLoop(fn("_hand_cut_validate_marks"), "p_duration_s"),
    marksLoop(fn("_hand_cut_claim_checks", handoff), "v_match.duration_s"),
  );
});

test("the copy shares the original without a second storage row or a content check", () => {
  const copy = fn("_copy_match_for_recut");
  assert.match(copy, /coalesce\(p_match\.content_checked_at, now\(\)\)/);
  assert.match(copy, /'uploaded', p_match\.raw_path/);
  assert.doesNotMatch(copy, /storage_ledger|content_check'|insert into public\.jobs|public\.points|public\.notes/);
  const del = fn("ledger_on_match_delete");
  assert.match(del, /m\.raw_path = old\.raw_path\s+and m\.user_id = old\.user_id\s+and m\.id <> old\.id/);
  assert.match(del, /set match_id = v_survivor/);
  assert.ok(del.indexOf("v_survivor is not null") < del.indexOf("-- 1. rows recorded"));
});

test("a re-cut's candidate is published beside the live cut and swapped in one step", () => {
  const publish = fn("publish_hand_recut");
  assert.match(publish, /v\.issue_id is not null/);
  assert.match(publish, /v\.source_version_id is distinct from m\.active_processing_version_id/);
  assert.match(publish, /_normalize_manual_cut_observations_for_version\(\s*p_match_id, v\.id\)/);
  assert.match(publish, /set status = 'done', progress = 100, result_path = p_cut_path/);
  assert.match(publish, /'placement_status', 'not_requested'/);
  assert.match(publish, /'match_structure', null/);
  assert.doesNotMatch(publish, /update public\.matches/);
  const activate = fn("_activate_hand_recut");
  assert.match(activate, /exception when raise_exception then\s+if sqlerrm <> 'match has unfinished derived work' then\s+raise;/);
  assert.match(activate, /_ledger_uncount_version_media\(p_match_id, v_old\)/);
  assert.match(activate, /request_reclip\(p_match_id\)/);
  assert.match(activate, /refresh_match_score_state\(p_match_id\)/);
  assert.match(activate, /'match_ready', m\.id, 'Match ready'/);
  assert.match(activate, /'owner_score', 'publish_hand_cut'/);
  // The ordinary normalize is the version function on the active version.
  assert.match(
    fn("normalize_manual_cut_observations"),
    /_normalize_manual_cut_observations_for_version\(\s+p_match_id, v_match\.active_processing_version_id\)/,
  );
  const perVersion = fn("_normalize_manual_cut_observations_for_version");
  assert.doesNotMatch(perVersion, /active_processing_version_id/);
  assert.match(perVersion, /p\.processing_version_id = p_version_id/);
});

test("the public link says how the match was cut, and keeps its grants", () => {
  const body = sql.slice(sql.indexOf("create function public.resolve_share_link("));
  const def = body.slice(0, body.search(/\n\$function\$;/));
  assert.match(def, /raw_path text, cut_source text\)/);
  assert.match(def, /case when p\.id is not null then pv\.cut_source else m\.cut_source end/);
  assert.match(sql, /drop function if exists public\.resolve_share_link\(text\);/);
  assert.match(sql, /grant execute on function public\.resolve_share_link\(text\)\s+to anon, authenticated, service_role;/);
});

// start_recut as it is now: the post-rollout audit (2026-09-26) replaced it
// last. Behaviour: supabase/tests/audit_db_fixes.sql.
const auditFile = readdirSync("supabase/migrations").find((name) =>
  name.endsWith("_post_rollout_audit_fixes.sql"),
);
assert.ok(auditFile, "the post-rollout audit migration is present");
const audit = readFileSync(`supabase/migrations/${auditFile}`, "utf8");

test("start_recut resumes only marks made for this cut", () => {
  const start = fn("start_recut", audit);
  assert.match(start, /greatest\(v\.created_at, v\.completed_at, v\.activated_at\)/);
  // An unsent draft of the owner's own, with at least one mark, made
  // since this cut; anything else is written again from the points (an
  // empty draft after "Start again" used to reopen the match empty).
  assert.match(
    start,
    /v_draft\.submitted_at is null and not coalesce\(p_fresh, false\)\s+and not v_draft\.prefilled\s+and v_draft\.user_id = v_me\s+and jsonb_typeof\(v_draft\.marks\) = 'array'\s+and jsonb_array_length\(v_draft\.marks\) > 0\s+and v_draft\.updated_at >= coalesce\(v_cut_since, '-infinity'::timestamptz\)/,
  );
  // The prefill takes the row over, whoever wrote it.
  assert.match(start, /on conflict \(match_id\) do update\s+set user_id = excluded\.user_id,/);
  assert.match(start, /where id = p_match_id and user_id = v_me/);
  assert.match(audit, /revoke all on function public\.start_recut\(uuid, boolean\) from public, anon;/);
  assert.match(audit, /grant execute on function public\.start_recut\(uuid, boolean\) to authenticated, service_role;/);
});

test("the three fixes that had to land first", () => {
  assert.match(fn("resolve_share_placement"), /and p\.processing_version_id = m\.active_processing_version_id/);
  const back = fn("_hand_cut_hand_back");
  assert.doesNotMatch(back, /delete from public\.points where match_id = v_match;/);
  assert.match(back, /processing_version_id = v_candidate\.id/);
  assert.match(back, /processing_version_id = v_match\.active_processing_version_id/);
  assert.match(back, /v_match\.status = 'ready' then\s+return false;/);
  // The device hand-cut migration's version, for contrast: unscoped.
  assert.match(device, /delete from public\.points where match_id = v_match;/);
});

test("cut_source is recorded per version and projected on activation", () => {
  assert.match(sql, /add column if not exists cut_source text not null default 'auto'/);
  assert.match(fn("activate_match_processing_version"), /status='ready',cut_source=v\.cut_source,/);
  assert.match(fn("activate_match_processing_version"), /superseded_at=now\(\),cut_source=m\.cut_source where id=m\.active_processing_version_id/);
  assert.match(fn("sync_active_match_processing_version"), /cut_source=new\.cut_source,/);
});

test("clients cannot make a hand-cut job, and support waits for a re-cut", () => {
  const guard = fn("guard_hand_cut_job_client");
  assert.doesNotMatch(guard, /security definer/);
  assert.match(guard, /current_user in \('authenticated', 'anon'\)/);
  assert.match(sql, /before insert or update on public\.jobs\s+for each row execute function public\.guard_hand_cut_job_client\(\)/);
  assert.match(sql, /match_processing_versions_one_open_candidate\s+on public\.match_processing_versions \(match_id\)\s+where status in \('candidate', 'ready'\)/);
  const start = fn("admin_start_match_reprocess");
  assert.match(start, /if public\._recut_busy\(m\.id\) then raise exception 'player re-cut running'/);
  assert.ok(start.indexOf("_recut_busy(m.id)") > start.indexOf("select * into m from public.matches where id=i.match_id for update"));
});

test("the failure bell for a re-cut says only what the contract says", () => {
  const bell = fn("jobs_notify_failed");
  assert.match(bell, /coalesce\(new\.options->>'recut', ''\) = 'replace'/);
  assert.match(bell, /'The new cut didn''t finish\.',\s+'Your marks are saved\.'/);
  assert.doesNotMatch(code, /iPhone|the Mac\b|\bfree\b/i);
});

test("the switch is on the public list, which keeps every live key", () => {
  assert.match(sql, /values \('recut_auto_replace', 'off'\)/);
  const list = (text: string) => {
    const from = text.indexOf('create policy "Public app config is readable"');
    const block = text.slice(from, text.indexOf(");", from));
    return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  };
  const before = list(device);
  const after = list(sql);
  for (const key of before) assert.ok(after.includes(key), key);
  assert.deepEqual(after.filter((key) => !before.includes(key)), ["recut_auto_replace"]);
});
