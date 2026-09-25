import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The guards that make a phone cut safe, read out of the migration so a
// later edit cannot quietly drop one. Behaviour is checked against a real
// Postgres by supabase/tests/device_hand_cut.sql (commands in
// supabase/tests/device_hand_cut_stubs.sql).
const sql = readFileSync(
  "supabase/migrations/20260925160000_device_hand_cut.sql",
  "utf8",
);

function fn(name: string): string {
  const start = sql.search(
    new RegExp(`create or replace function public\\.${name}\\(`, "i"),
  );
  assert.ok(start >= 0, `${name} is defined`);
  const rest = sql.slice(start);
  const end = rest.search(/\n\$(function)?\$;/);
  return rest.slice(0, end);
}

test("a phone cut is never queued, and everything else is sent as before", () => {
  const enqueue = fn("enqueue_job");
  assert.match(
    enqueue,
    /if new\.kind = 'hand_cut' and coalesce\(new\.options->>'phase', ''\) = 'device' then\s+return new;/,
  );
  assert.match(enqueue, /when new\.kind in \('deadspace_cut', 'youtube_import'\) then 60/);
  assert.match(enqueue, /when new\.kind = 'reclip' then 5/);
  const send = fn("_send_job_message");
  assert.match(send, /pgmq\.send\(\s*public\.job_queue_name\(p_job\.kind, p_job\.options\)/);
  for (const key of ["job_id", "user_id", "kind", "input_path", "options"]) {
    assert.match(send, new RegExp(`'${key}', p_job\\.`));
  }
  assert.doesNotMatch(sql, /create or replace function public\.job_queue_name/);
});

test("both claims make the same checks", () => {
  const checks = fn("_hand_cut_claim_checks");
  for (const code of [
    "not_authenticated", "not_enabled", "not_found", "bad_state", "no_source",
    "duration_unknown", "check_pending", "already_cut", "already_processing",
    "queue_full", "invalid_marks",
  ]) {
    assert.match(checks, new RegExp(`raise exception '${code}'`), code);
  }
  assert.match(checks, /for update;/);
  assert.match(checks, /_release_stale_device_hand_cuts\(p_match_id\)/);
  assert.match(fn("claim_hand_cut"), /_hand_cut_claim_checks\(p_match_id, p_marks\)/);
  const device = fn("claim_device_hand_cut");
  assert.match(device, /device_hand_cut_enabled\(v_me\)/);
  assert.match(device, /_hand_cut_claim_checks\(p_match_id, p_marks\)/);
  assert.match(device, /'hand_cut', 'processing', 0/);
  assert.match(device, /'cutter', 'device',\s+'phase', 'device'/);
  // lpad would cut 100 down to "10"; the Mac names it 100.mp4.
  assert.doesNotMatch(device, /lpad/);
  assert.match(device, /case when i < 10 then '0' \|\| i::text else i::text end/);
});

test("only the owner's phone moves a phone job, and only forward", () => {
  for (const name of ["report_device_hand_cut", "submit_device_hand_cut", "release_device_hand_cut"]) {
    const body = fn(name);
    assert.match(body, /where id = p_job and user_id = v_me and kind = 'hand_cut'\s+for update/, name);
  }
  assert.match(
    fn("report_device_hand_cut"),
    /\('device_cut', 'device_clips', 'device_upload', 'device_paused'\)/,
  );
  const submit = fn("submit_device_hand_cut");
  assert.match(submit, /p_manifest->>'key' is distinct from v_key/);
  assert.match(submit, /'phase', 'verify'/);
  assert.match(submit, /_send_job_message\(v_job, 0\)/);
  const release = fn("release_device_hand_cut");
  assert.match(release, /'cutter', 'mac', 'phase', 'mac'/);
  assert.match(release, /set status = 'cancelled'/);
  assert.match(release, /_hand_cut_hand_back\(p_job\)/);
});

test("a quiet phone is released with the Cut failed bell and its marks handed back", () => {
  const stale = fn("_release_stale_device_hand_cuts");
  assert.match(stale, /interval '72 hours'/);
  assert.match(stale, /_try_timestamptz\(j\.options->>'device_reported_at'\)/);
  assert.match(stale, /for update of j skip locked/);
  assert.match(stale, /set status = 'failed'/);
  assert.match(
    stale,
    /The cut on your iPhone didn''t finish\. Your marks are saved\./,
  );
  const back = fn("_hand_cut_hand_back");
  assert.match(back, /where job_id = p_job/);
  assert.match(back, /cut_source = 'auto', job_id = null/);
  assert.match(back, /set submitted_at = null/);
});

test("private helpers are private and the phone's calls are the owner's", () => {
  for (const signature of [
    "_try_timestamptz\\(text\\)",
    "_send_job_message\\(public\\.jobs, integer\\)",
    "_hand_cut_hand_back\\(uuid\\)",
    "_release_stale_device_hand_cuts\\(uuid\\)",
    "release_stale_device_hand_cuts\\(\\)",
    "_hand_cut_claim_checks\\(uuid, jsonb\\)",
  ]) {
    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${signature}\\s+from public, anon, authenticated`),
      signature,
    );
  }
  for (const signature of [
    "claim_device_hand_cut\\(uuid, jsonb\\)",
    "report_device_hand_cut\\(uuid, text, integer\\)",
    "submit_device_hand_cut\\(uuid, jsonb\\)",
    "release_device_hand_cut\\(uuid, boolean\\)",
    "device_hand_cut_enabled\\(uuid\\)",
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${signature} from public, anon;`), signature);
    assert.match(sql, new RegExp(`grant execute on function public\\.${signature} to authenticated;`), signature);
  }
});

test("the switch is on the public list, which keeps every live key", () => {
  assert.match(sql, /values \('device_hand_cut', 'admins'\)/);
  const list = sql.slice(sql.indexOf('create policy "Public app config is readable"'));
  for (const key of [
    "support_email", "commerce_enabled", "device_reclip", "recordings_to_photos",
    "ai_consent_version", "terms_version", "device_hand_cut",
  ]) {
    assert.match(list, new RegExp(`'${key}'`), key);
  }
});

test("the processing page never reads a phone as a Mac worker", () => {
  const overview = fn("admin_processing_overview");
  assert.match(overview, /admin_processing_overview_pre_device_hand_cut_20260925\(\)/);
  assert.match(overview, /'devices', v_devices/);
  assert.match(overview, /not \(\(r\.value->>'id'\) = any \(v_ids\)\)/);
  const counts = fn("admin_processing_counts");
  assert.match(counts, /and not \(j\.kind = 'hand_cut'/);
  assert.match(counts, /and not \(j2\.kind = 'hand_cut'/);
  assert.match(fn("my_match_processing_feedback"), /'device_seen_at'/);
});
