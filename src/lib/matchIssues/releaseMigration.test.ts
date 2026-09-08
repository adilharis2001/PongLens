import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const enabled = process.env.MATCH_ISSUES_LOCAL_DB_TEST === "1";
const directory = "supabase/migrations";
const stems = [
  "match_processing_feedback", "match_issue_player_history", "match_processing_versions",
  "match_issue_admin_review", "match_issue_refund_total", "match_issue_refresh_receipt",
  "match_reprocess_rollout_gate", "derived_job_versions", "match_issue_email_delivery",
  "match_version_postconditions",
];
function migration(stem: string) {
  const files = readdirSync(directory).filter(file => file.endsWith(`_${stem}.sql`));
  assert.equal(files.length, 1, `${stem} must have one migration`);
  return { file: files[0], sql: readFileSync(`${directory}/${files[0]}`, "utf8") };
}
function section(text: string, start: string, end?: string) {
  const from = text.indexOf(start);
  return from < 0 ? "" : text.slice(from, end ? text.indexOf(end, from) : undefined);
}
const version = () => migration("match_processing_versions").sql;
const rollout = () => section(migration("match_reprocess_rollout_gate").sql,
  "create or replace function public.guard_match_reprocess_job_rollout()",
  "create trigger jobs_guard_reprocess_rollout");
const activation = () => section(version(), "create function public.activate_match_processing_version(",
  "create function public.admin_publish_match_version(").replace("create function", "create or replace function");
const synchronization = () => section(version(), "create function public.sync_active_match_processing_version()",
  "create trigger matches_sync_processing_version").replace("create function", "create or replace function");
function currentReaders() {
  // This disposable DB predates these production readers. Install the actual
  // definitions, then apply the feature migration's real reader adaptations.
  return [
    "153_share_raw_fallback.sql", "20260907010000_highlight_share_links.sql",
    "20260907154448_match_point_fingerprints.sql", "20260907180000_highlight_share_score_and_stats.sql",
  ].map(file => readFileSync(`${directory}/${file}`, "utf8")).join("\n")
    + section(version(), "-- SECURITY DEFINER summary/share readers", "-- Calls from anon share resolvers")
    + section(version(), "-- Current statistics use exactly the active point set.");
}
function sql(body: string) {
  try {
    return execFileSync("docker", ["exec", "-i", "supabase_db_match-processing-feedback", "psql",
      "-q", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"],
    { input: body, encoding: "utf8", stdio: "pipe" }).trim();
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    throw new Error(failure.stderr || failure.message);
  }
}
const O = "b5111111-1111-4111-8111-111111111101";
const A = "b5444444-4444-4444-8444-444444444404";
const M = "b5666666-6666-4666-8666-666666666606";
const J = "b5555555-5555-4555-8555-555555555505";
const P = "b5777777-7777-4777-8777-777777777707";
const Q = "b5777777-7777-4777-8777-777777777708";
const TOKEN = "release-highlight-token-123456789012";
function actor(id: string, role = "authenticated") {
  return `select set_config('request.jwt.claims','${JSON.stringify({ sub: id, role,
    email: id === A ? "adilharis2001@gmail.com" : "release-owner@example.com" })}',true); set local role ${role};`;
}
const reset = "reset role; select set_config('request.jwt.claims','{}',true);";
function fixture() {
  return `insert into app_config(key,value) values('match_reprocessing_enabled','true') on conflict(key) do update set value=excluded.value;
    insert into auth.users(id,email) values('${O}','release-owner@example.com'),('${A}','adilharis2001@gmail.com');
    insert into jobs(id,user_id,status,kind,input_path,options) values('${J}','${O}','done','deadspace_cut','r2://raw/${O}/source.mp4','{"strictness":"normal"}');
    insert into matches(id,user_id,job_id,status,raw_path,cut_path,match_json_path,duration_s) values('${M}','${O}','${J}','ready','r2://raw/${O}/source.mp4','r2://media/old.mp4','r2://media/old.json',620);
    insert into points(id,match_id,idx,t0,t1,cut_t0,confirmed_winner,clip_path) values('${P}','${M}',0,10,20,0,'user','r2://media/old-point.mp4');
    ${actor(O)} select set_config('release.issue',submit_match_issue('${M}','reprocess','Try again','b5aaaaaa-1234-4234-8234-aaaaaaaaaaaa')->>'id',true); ${reset}
    select set_config('release.source',(select active_processing_version_id::text from matches where id='${M}'),true);`;
}
function candidate() {
  return `${actor(A)} select admin_start_match_reprocess(current_setting('release.issue')::uuid,'{}','QA'); ${reset}
    select set_config('release.candidate',(select replacement_version_id::text from match_processing_feedback where id=current_setting('release.issue')::uuid),true);
    select set_config('release.job',(select replacement_job_id::text from match_processing_feedback where id=current_setting('release.issue')::uuid),true);
    insert into points(id,match_id,processing_version_id,idx,t0,t1,cut_t0,confirmed_winner,clip_path)
      values('${Q}','${M}',current_setting('release.candidate')::uuid,0,30,40,0,'opponent','r2://media/new-point.mp4');`;
}
const job = "current_setting('release.job')::uuid";
const ready = `update match_processing_versions set status='ready',completed_at=now(),cut_path='r2://media/new.mp4',match_json_path='r2://media/new.json'
    where id=current_setting('release.candidate')::uuid;
  update match_processing_feedback set status='candidate_ready' where id=current_setting('release.issue')::uuid;
  update jobs set status='done',progress=100,result_path='r2://media/new.mp4' where id=${job};`;
const publish = `${actor(A)} select admin_publish_match_version(current_setting('release.issue')::uuid,'Reviewed.',''); ${reset}`;
const restore = `${actor(A)} select admin_restore_match_issue_version(current_setting('release.issue')::uuid,'Restore original.'); ${reset}`;

test("release migrations have unique valid versions ordered after their production dependencies", () => {
  const files = readdirSync(directory);
  const feature = stems.map(stem => migration(stem).file);
  assert.deepEqual([...feature].sort(), feature);
  assert.ok(feature[0] > "20260907190000_second_listener_rates.sql");
  for (const file of feature) {
    const stamp = file.split("_")[0];
    assert.match(stamp, /^20260907(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/);
    assert.equal(files.filter(other => other.startsWith(`${stamp}_`)).length, 1, stamp);
  }
});

for (const role of ["postgres", "service_role"]) test(`default-off admin QA jobs can finish through the trusted direct database worker (${role})`, { skip: !enabled }, () => {
  const out = sql(`begin; ${rollout()} ${activation()} ${fixture()}
    update app_config set value='false' where key='match_reprocessing_enabled'; ${candidate()}
    set local role ${role}; update jobs set status='processing',progress=35,error=null where id=${job};
    ${ready}
    select 'worker|'||status||'|'||progress||'|'||result_path from jobs where id=${job};
    ${publish}
    select 'published|'||(active_processing_version_id=current_setting('release.candidate')::uuid) from matches where id='${M}'; rollback;`);
  assert.match(out, /worker\|done\|100\|r2:\/\/media\/new.mp4/);
  assert.match(out, /published\|true/);
});

test("default-off direct worker failures remain terminal and available for admin retry", { skip: !enabled }, () => {
  const out = sql(`begin; ${rollout()} ${fixture()}
    update app_config set value='false' where key='match_reprocessing_enabled'; ${candidate()}
    update jobs set status='processing',progress=35 where id=${job};
    update match_processing_versions set status='failed' where id=current_setting('release.candidate')::uuid;
    update match_processing_feedback set status='execution_failed' where id=current_setting('release.issue')::uuid;
    update jobs set status='failed',progress=100,error='Fixture failure' where id=${job};
    ${actor(A)} select admin_start_match_reprocess(current_setting('release.issue')::uuid,'{}','Retry'); ${reset}
    select 'retry|'||status from match_processing_feedback where id=current_setting('release.issue')::uuid;
    select 'attempts|'||count(*) from jobs where user_id='${O}' and kind='match_reprocess'; rollback;`);
  assert.match(out, /retry\|reprocess_queued/);
  assert.match(out, /attempts\|2/);
});

for (const mutation of ["options=options||'{\"placement\":true}'", "input_path='r2://raw/another-source.mp4'", "user_id='" + A + "'", "kind='deadspace_cut'"]) {
  test(`direct worker exception cannot change QA job identity: ${mutation}`, { skip: !enabled }, () => {
    assert.throws(() => sql(`begin; ${rollout()} ${fixture()}
      update app_config set value='false' where key='match_reprocessing_enabled'; ${candidate()}
      update jobs set ${mutation} where id=${job}; rollback;`), /match reprocessing is not enabled/);
  });
}

test("direct worker exception cannot create an unapproved QA job or reactivate a terminal job", { skip: !enabled }, () => {
  const prefix = `begin; ${rollout()} ${fixture()} update app_config set value='false' where key='match_reprocessing_enabled';`;
  assert.throws(() => sql(`${prefix} insert into jobs(user_id,kind,status,options) values('${O}','match_reprocess','queued','{}'); rollback;`), /match reprocessing is not enabled/);
  assert.throws(() => sql(`${prefix} ${candidate()} ${ready} update jobs set status='queued' where id=${job}; rollback;`), /match reprocessing is not enabled/);
});

test("default-off still rejects ordinary owner creation and job activation", { skip: !enabled }, () => {
  const prefix = `begin; ${rollout()} ${fixture()} update app_config set value='false' where key='match_reprocessing_enabled';`;
  assert.throws(() => sql(`${prefix} ${actor(O)} select cancel_match_issue(current_setting('release.issue')::uuid); select submit_match_issue('${M}','reprocess','Again','b5bbbbbb-1234-4234-8234-aaaaaaaaaaaa'); rollback;`), /match reprocessing is not enabled/);
  assert.throws(() => sql(`${prefix} ${candidate()} ${actor(O)} update jobs set status='processing' where id=${job}; rollback;`), /reprocessing jobs are admin-managed|permission denied/);
});

test("current statistics fingerprint ignores candidates and changes on publish and restore", { skip: !enabled }, () => {
  const capture = (stage: string) => `${actor(O)} select '${stage}|'||fingerprint from my_match_point_fingerprints() where match_id='${M}'; ${reset}`;
  const out = sql(`begin; ${currentReaders()} ${activation()} ${fixture()}
    ${capture("original")} ${candidate()} ${ready} ${capture("candidate")}
    ${publish} ${capture("published")} ${restore} ${capture("restored")} rollback;`);
  const fingerprints = Object.fromEntries(out.split("\n").filter(line => /^(original|candidate|published|restored)\|/.test(line)).map(line => line.split("|")));
  assert.equal(fingerprints.candidate, fingerprints.original, "inactive candidate must not invalidate the active statistics");
  assert.notEqual(fingerprints.published, fingerprints.original, "publication must invalidate the old point cache");
  assert.equal(fingerprints.restored, fingerprints.original);
});

test("public highlights lose inactive media on publish and restore while archives retain both reels", { skip: !enabled }, () => {
  const capture = (stage: string) => `set local role anon; select '${stage}|'||count(*) from resolve_share_highlights('${TOKEN}'); reset role;`;
  const out = sql(`begin; ${currentReaders()} ${activation()} ${fixture()}
    insert into share_links(owner,match_id,kind,token,show_score) values('${O}','${M}','highlights','${TOKEN}',true);
    insert into match_reels(match_id,scope,status,show_score,manifest,r2_key,duration_s,size_bytes)
      values('${M}','highlights','ready',true,'{"points":[{"point_id":"${P}"}]}','reels/original.mp4',10,100);
    ${capture("original")} ${candidate()} ${ready} ${capture("candidate")} ${publish} ${capture("published")}
    set local role anon; select 'points|'||id from resolve_share_points('${TOKEN}'); reset role;
    select 'old-archive|'||(record->>'r2_key') from match_processing_version_reels where version_id=current_setting('release.source')::uuid;
    update match_reels set status='ready',r2_key='reels/replacement.mp4',manifest='{"points":[{"point_id":"${Q}"}]}' where match_id='${M}';
    ${capture("new-reel")} ${restore} ${capture("restored")}
    select 'new-archive|'||(record->>'r2_key') from match_processing_version_reels where version_id=current_setting('release.candidate')::uuid;
    select 'cleared|'||(r2_key is null and duration_s is null and size_bytes is null) from match_reels where match_id='${M}';
    select activate_match_processing_version('${M}',current_setting('release.candidate')::uuid);
    select 'old-archive-again|'||(record->>'r2_key') from match_processing_version_reels where version_id=current_setting('release.source')::uuid; rollback;`);
  for (const expected of ["original|1", "candidate|1", "published|0", `points|${Q}`, "old-archive|reels/original.mp4",
    "new-reel|1", "restored|0", "new-archive|reels/replacement.mp4", "cleared|true",
    "old-archive-again|reels/original.mp4"]) assert.ok(out.includes(expected), expected);
});

test("deployment postconditions reject an unscoped fingerprint and a definer worker exception", { skip: !enabled }, () => {
  const checks = migration("match_version_postconditions").sql;
  const prefix = `begin; ${currentReaders()} ${activation()} ${synchronization()} ${rollout()}`;
  assert.equal(sql(`${prefix} ${checks} select 'valid lifecycle boundaries'; rollback;`), "valid lifecycle boundaries");
  const unscoped = readFileSync(`${directory}/20260907154448_match_point_fingerprints.sql`, "utf8");
  assert.throws(() => sql(`${prefix} ${unscoped} ${checks} rollback;`), /postcondition failed: my_match_point_fingerprints/);
  assert.throws(() => sql(`${prefix} alter function public.guard_match_reprocess_job_rollout() security definer; ${checks} rollback;`), /postcondition failed: worker role boundary/);
});

test("notification migration preserves production and unknown existing kinds while adding match feedback", { skip: !enabled }, () => {
  const append = section(migration("match_processing_feedback").sql, "-- Append notification kinds", "create or replace function public._match_issue_refundable_minutes(");
  const out = sql(`begin;
    do $$ declare original text; begin
      select pg_get_expr(conbin,conrelid) into original from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_kind_check';
      alter table notifications drop constraint notifications_kind_check;
      execute 'alter table notifications add constraint notifications_kind_check check (('||original||') or kind in (''student_lesson'',''future_kind''))';
    end $$;
    ${append} ${fixture()}
    insert into notifications(user_id,kind,title,href) values('${O}','student_lesson','Lesson','/learn'),('${O}','future_kind','Future','/learn');
    select 'preserved|'||count(*) from notifications where user_id='${O}' and kind in ('student_lesson','future_kind');
    select 'feature|'||count(*) from notifications where match_id='${M}' and user_id='${A}' and kind='match_issue_reported'; rollback;`);
  assert.match(out, /preserved\|2/);
  assert.match(out, /feature\|1/);
});
