import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import test from "node:test";

const enabled = process.env.MATCH_ISSUES_LOCAL_DB_TEST === "1";
const container = "supabase_db_match-processing-feedback";
const O = "10111111-1111-4111-8111-111111111101";
const C = "20222222-2222-4222-8222-222222222202";
const A = "40444444-4444-4444-8444-444444444404";
const M = "60666666-6666-4666-8666-666666666606";
const J = "50555555-5555-4555-8555-555555555505";
const P = "70777777-7777-4777-8777-777777777707";
const Q = "70777777-7777-4777-8777-777777777708";
function sql(body: string) {
  return execFileSync("docker", ["exec", "-i", container, "psql", "-q", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"], { input: body, encoding: "utf8", stdio: "pipe" }).trim();
}
function actor(id: string, role = "authenticated") {
  return `select set_config('request.jwt.claims','${JSON.stringify({sub:id,role,email:id===A?"adilharis2001@gmail.com":"version@example.com"})}',true); set local role ${role};`;
}
const reset = `reset role; do $$ begin perform set_config('request.jwt.claims','{}',true); end $$;`;
function fixture() {
  return `insert into app_config(key,value) values('match_reprocessing_enabled','true') on conflict(key) do update set value=excluded.value;
    delete from auth.users where id in ('${O}','${C}','${A}');
    insert into auth.users(id,email) values ('${O}','version-owner@example.com'),('${C}','version-coach@example.com'),('${A}','adilharis2001@gmail.com');
    insert into jobs(id,user_id,status,kind,input_path,options) values('${J}','${O}','done','deadspace_cut','r2://ponglens-raw/${O}/source.mp4','{"strictness":"normal","placement":true,"trim_start_s":2,"trim_end_s":620}');
    insert into matches(id,user_id,job_id,status,raw_path,cut_path,match_json_path,duration_s) values('${M}','${O}','${J}','ready','r2://ponglens-raw/${O}/source.mp4','r2://media/old-cut.mp4','r2://media/old-match.json',620);
    insert into points(id,match_id,idx,t0,t1,clip_path,starred) values('${P}','${M}',0,10,20,'r2://media/old-clip.mp4',true);
    insert into notes(match_id,point_id,author_id,body) values('${M}','${P}','${O}','Keep this note');
    insert into coach_links(player_id,coach_id,status,all_matches) values('${O}','${C}','accepted',true);
    insert into processing_ledger(user_id,minutes,kind,funding,billing_mode,match_id,job_id) values('${O}',-11,'spend','personal','live','${M}','${J}');
    insert into share_links(owner,match_id,point_id,kind,token) values('${O}','${M}','${P}','point','version-point-token-123456789012');
    insert into share_links(owner,match_id,kind,token) values('${O}','${M}','match','version-match-token-123456789012');
    ${actor(O)} select submit_match_issue('${M}','reprocess','Try again','aaaaaaaa-1234-4234-8234-aaaaaaaaaaaa'); ${reset}
    do $$ begin perform set_config('task6.issue_id',(select id::text from match_processing_feedback where match_id='${M}'),true); perform set_config('task6.source_id',(select active_processing_version_id::text from matches where id='${M}'),true); end $$;`;
}
function candidate() {
  return `${actor(A)} select admin_start_match_reprocess(current_setting('task6.issue_id')::uuid,'{}','Check the cut'); ${reset}
    insert into points(id,match_id,processing_version_id,idx,t0,t1,clip_path) select '${Q}','${M}',replacement_version_id,0,30,40,'r2://media/new-clip.mp4' from match_processing_feedback where match_id='${M}';
    do $$ begin perform set_config('task6.candidate_id',(select replacement_version_id::text from match_processing_feedback where match_id='${M}'),true); end $$;`;
}
function ready() {
  return `update match_processing_versions set status='ready',cut_path='r2://media/new-cut.mp4',match_json_path='r2://media/new-match.json',completed_at=now() where id=(select replacement_version_id from match_processing_feedback where match_id='${M}');
    update jobs set status='done' where id=(select replacement_job_id from match_processing_feedback where match_id='${M}');
    update match_processing_feedback set status='candidate_ready' where match_id='${M}';`;
}

function syncVersionDefinition() {
  const migration = readFileSync("supabase/migrations/20260907130000_match_processing_versions.sql", "utf8");
  return migration.slice(migration.indexOf("create function public.sync_active_match_processing_version()"),
    migration.indexOf("create trigger matches_sync_processing_version"))
    .replace("create function", "create or replace function");
}

for (const release of ["executed-candidate-release", null]) {
  test(`completed candidate provenance survives publication, metadata updates and restore (${release ?? "unknown release"})`, { skip: !enabled }, () => {
    const executed = { strictness: "normal", placement: true, pipeline: "v2", actual_pipeline: "v1_fallback", rtmpose_device: "cuda:0" };
    const original = { strictness: "normal", placement: true, pipeline: "v1", actual_pipeline: "v1", rtmpose_device: "cpu" };
    const capture = (stage: string, version = "task6.candidate_id") => `select 'provenance|'||jsonb_build_object(
      'stage','${stage}','settings',settings,'release',release_id,'completedAt',completed_at,
      'active',(id=(select active_processing_version_id from matches where id='${M}')))::text
      from match_processing_versions where id=current_setting('${version}')::uuid;`;
    const out = sql(`begin; ${syncVersionDefinition()} ${fixture()}
      update match_processing_versions set settings='${JSON.stringify(original)}',release_id='executed-original-release',completed_at='2026-09-01T12:00:00Z'
        where id=current_setting('task6.source_id')::uuid;
      ${candidate()}
      -- Worker completion records executed facts, deliberately different from
      -- the queue request. No encoding or worker Python is mocked or run here.
      update jobs set options=options||'{"pipeline":"requested-pipeline","rtmpose_device":"requested-device","release_id":"queued-release"}'
        where id=(select replacement_job_id from match_processing_feedback where match_id='${M}');
      ${ready()}
      update match_processing_versions set settings='${JSON.stringify(executed)}',release_id=${release ? `'${release}'` : "null"},completed_at='2026-09-07T12:00:00Z'
        where id=current_setting('task6.candidate_id')::uuid;
      ${capture("completed")}
      ${actor(A)} select admin_publish_match_version(current_setting('task6.issue_id')::uuid,'Reviewed.',''); ${reset}
      ${capture("published")}
      update jobs set options=options||'{"pipeline":"later-pipeline","actual_pipeline":"invented","rtmpose_device":"later-device","release_id":"later-release"}'
        where id=(select replacement_job_id from match_processing_feedback where match_id='${M}');
      update matches set opponent_name='Updated after publication' where id='${M}';
      ${capture("metadata")}
      update jobs set options=options||'{"pipeline":"edited-source-request","release_id":"edited-source-release"}' where id='${J}';
      ${actor(A)} select admin_restore_match_issue_version(current_setting('task6.issue_id')::uuid,'Restore original.'); ${reset}
      ${capture("retained-candidate")}
      ${capture("restored-original", "task6.source_id")}
      update matches set opponent_name='Updated after restoration' where id='${M}';
      ${capture("restored-metadata", "task6.source_id")}
      select 'projection|'||(match_state->>'opponent_name') from match_processing_versions where id=current_setting('task6.source_id')::uuid;
      rollback;`);
    const snapshots = out.split("\n").filter(line => line.startsWith("provenance|")).map(line => JSON.parse(line.slice(11)));
    assert.deepEqual(snapshots, [
      { stage: "completed", settings: executed, release, completedAt: "2026-09-07T12:00:00+00:00", active: false },
      { stage: "published", settings: executed, release, completedAt: "2026-09-07T12:00:00+00:00", active: true },
      { stage: "metadata", settings: executed, release, completedAt: "2026-09-07T12:00:00+00:00", active: true },
      { stage: "retained-candidate", settings: executed, release, completedAt: "2026-09-07T12:00:00+00:00", active: false },
      { stage: "restored-original", settings: original, release: "executed-original-release", completedAt: "2026-09-01T12:00:00+00:00", active: true },
      { stage: "restored-metadata", settings: original, release: "executed-original-release", completedAt: "2026-09-01T12:00:00+00:00", active: true },
    ]);
    assert.match(out, /projection\|Updated after restoration/);
  });
}

test("ordinary active processing synchronizes queue changes until completion without later rewriting provenance", { skip: !enabled }, () => {
  const nextMatch = "60666666-6666-4666-8666-666666666607";
  const nextJob = "50555555-5555-4555-8555-555555555506";
  const finalOptions = { strictness: "tight", pipeline: "v2", rtmpose_device: "cpu", release_id: "ordinary-release" };
  const out = sql(`begin; ${syncVersionDefinition()} ${fixture()}
    insert into matches(id,user_id,status,raw_path) values('${nextMatch}','${O}','uploaded','r2://raw/ordinary.mp4');
    insert into jobs(id,user_id,status,kind,input_path,options) values('${nextJob}','${O}','processing','deadspace_cut','r2://raw/ordinary.mp4','{"strictness":"normal"}');
    update matches set job_id='${nextJob}',status='processing' where id='${nextMatch}';
    update jobs set options='${JSON.stringify(finalOptions)}' where id='${nextJob}';
    update matches set opponent_name='While processing' where id='${nextMatch}';
    select 'ordinary|'||jsonb_build_object('stage','processing','settings',settings,'release',release_id,'completed',completed_at is not null)::text
      from match_processing_versions where match_id='${nextMatch}';
    update jobs set status='done',result_path='r2://media/ordinary-cut.mp4' where id='${nextJob}';
    update matches set status='ready',cut_path='r2://media/ordinary-cut.mp4',match_json_path='r2://media/ordinary.json' where id='${nextMatch}';
    update jobs set options='{"pipeline":"later-request","release_id":"later-release"}' where id='${nextJob}';
    update matches set opponent_name='After completion',thumb_path='r2://media/new-thumb.jpg' where id='${nextMatch}';
    select 'ordinary|'||jsonb_build_object('stage','completed','settings',settings,'release',release_id,'completed',completed_at is not null)::text
      from match_processing_versions where match_id='${nextMatch}';
    select 'projection|'||(job_id='${nextJob}')||'|'||cut_path||'|'||thumb_path||'|'||(match_state->>'opponent_name')
      from match_processing_versions where match_id='${nextMatch}'; rollback;`);
  const snapshots = out.split("\n").filter(line => line.startsWith("ordinary|")).map(line => JSON.parse(line.slice(9)));
  assert.deepEqual(snapshots, [
    { stage: "processing", settings: finalOptions, release: "ordinary-release", completed: false },
    { stage: "completed", settings: finalOptions, release: "ordinary-release", completed: true },
  ]);
  assert.match(out, /projection\|true\|r2:\/\/media\/ordinary-cut.mp4\|r2:\/\/media\/new-thumb.jpg\|After completion/);
});

test("deployment postconditions reject a synchronization function that lost its provenance boundary", { skip: !enabled }, () => {
  const postconditions = readFileSync("supabase/migrations/20260907200000_match_version_postconditions.sql", "utf8");
  assert.equal(sql(`begin; ${syncVersionDefinition()} ${postconditions} select 'valid provenance synchronization'; rollback;`), "valid provenance synchronization");
  assert.throws(() => sql(`begin;
    create or replace function public.sync_active_match_processing_version() returns trigger
      language plpgsql security definer set search_path=public as $$ begin return new; end $$;
    ${postconditions} rollback;`), /match version migration postcondition failed: sync_active_match_processing_version/);
});

test("a new ordinary processing job replaces old provenance and clears its previous completion receipt", { skip: !enabled }, () => {
  const nextJob = "50555555-5555-4555-8555-555555555506";
  const out = sql(`begin; ${syncVersionDefinition()} ${fixture()}
    update match_processing_versions set settings='{"pipeline":"old-pipeline"}',release_id='old-release',completed_at='2026-09-01T12:00:00Z'
      where id=current_setting('task6.source_id')::uuid;
    insert into jobs(id,user_id,status,kind,input_path,options) values('${nextJob}','${O}','processing','deadspace_cut','r2://raw/new-source.mp4','{"strictness":"loose","pipeline":"new-pipeline"}');
    update matches set status='processing',job_id='${nextJob}' where id='${M}';
    select jsonb_build_object('settings',settings,'release',release_id,'completed',completed_at is not null,'jobId',job_id)
      from match_processing_versions where id=current_setting('task6.source_id')::uuid; rollback;`);
  assert.deepEqual(JSON.parse(out.split("\n").at(-1)!), {
    settings: { strictness: "loose", pipeline: "new-pipeline" }, release: null, completed: false, jobId: nextJob,
  });
});

test("ready historical provenance stays fixed when its completion timestamp is unknown", { skip: !enabled }, () => {
  const out = sql(`begin; ${syncVersionDefinition()} ${fixture()}
    update jobs set options=options||'{"pipeline":"later-request","release_id":"later-release"}' where id='${J}';
    update matches set opponent_name='Historical metadata update' where id='${M}';
    select settings||jsonb_build_object('release',release_id,'completed',completed_at is not null)
      from match_processing_versions where id=current_setting('task6.source_id')::uuid; rollback;`);
  assert.deepEqual(JSON.parse(out.split("\n").at(-1)!), {
    strictness: "normal", placement: true, trim_start_s: 2, trim_end_s: 620, release: null, completed: false,
  });
});

test("every existing point has a same-match active version; new legacy-style writes attach automatically", { skip: !enabled }, () => {
  const out=sql(`begin; ${fixture()} select count(*) from points p join matches m on m.id=p.match_id where p.processing_version_id is null or not exists(select 1 from match_processing_versions v where v.id=p.processing_version_id and v.match_id=p.match_id); select count(*) from match_processing_versions where match_id='${M}' and status='active'; rollback;`);
  assert.match(out,/\n0\n1$/);
});
test("candidate start is admin-only, source-derived, idempotent and uncharged without changing the active match", { skip: !enabled }, () => {
  const out=sql(`begin; ${fixture()}
    ${actor(O)} do $$ begin begin perform admin_start_match_reprocess(current_setting('task6.issue_id')::uuid,'{}',''); raise exception 'owner started' using errcode='P0002'; exception when insufficient_privilege then null; end; end $$; ${reset}
    ${candidate()} ${actor(A)} select admin_start_match_reprocess(current_setting('task6.issue_id')::uuid,'{}',''); ${reset}
    select count(*) from jobs where kind='match_reprocess' and user_id='${O}';
    select count(*) from processing_ledger where user_id='${O}';
    select status||'|'||cut_path from matches where id='${M}';
    select options->>'funding' from jobs where kind='match_reprocess' and user_id='${O}'; rollback;`);
  assert.match(out,/\n1\n1\nready\|r2:\/\/media\/old-cut.mp4\nsupport$/);
});
test("owner and coach cannot select candidate points; admin uses explicit version detail", { skip: !enabled }, () => {
  const out=sql(`begin; ${fixture()} ${candidate()}
    ${actor(O)} select string_agg(id::text,',') from points where match_id='${M}'; reset role;
    ${actor(C)} select string_agg(id::text,',') from points where match_id='${M}'; reset role;
    ${actor(A)} select jsonb_array_length(admin_match_version_detail(current_setting('task6.candidate_id')::uuid)->'points'); ${reset} rollback;`);
  assert.match(out,new RegExp(`${P}[\\s\\S]*${P}[\\s\\S]*\\n1$`));
  assert.equal(out.includes(Q),false);
});
test("publish and restore preserve point identity, dependents and old point links while match links follow active", { skip: !enabled }, () => {
  const out=sql(`begin; ${fixture()} ${candidate()} ${ready()}
    ${actor(A)} select admin_publish_match_version(current_setting('task6.issue_id')::uuid,'New cut reviewed.',''); ${reset}
    set local role anon; select id from resolve_share_points('version-match-token-123456789012'); select point_id||'|'||cut_path from resolve_share_link('version-point-token-123456789012'); reset role;
    select count(*) from points where match_id='${M}'; select count(*) from notes where match_id='${M}';
    ${actor(A)} select admin_restore_match_version('${M}',current_setting('task6.source_id')::uuid,'Restored previous cut.'); ${reset}
    select cut_path from matches where id='${M}'; rollback;`);
  assert.ok(out.includes(`${P}|r2://media/old-cut.mp4`)); assert.ok(out.includes(`\n${Q}\n`)); assert.match(out,/\n2\n1\n/); assert.match(out,/\nr2:\/\/media\/old-cut.mp4$/);
});

test("demo lifecycle preserves scored coach work through publish, restore and an exactly-once refund", { skip: !enabled }, () => {
  // Real authorization, transactions, version RPCs, RLS and ledger. Candidate
  // output/completion below is a controlled fixture, not an encoding run.
  const out = sql(`begin; ${fixture()}
    ${actor(O)} update points set confirmed_winner='user' where id='${P}';
    insert into tags(id,owner_id,label) values('90999999-9999-4999-8999-999999999909','${O}','Backhand practice');
    insert into point_tags(point_id,tag_id,created_by) values('${P}','90999999-9999-4999-8999-999999999909','${O}'); ${reset}
    ${actor(C)} insert into notes(match_id,point_id,author_id,body) values('${M}','${P}','${C}','Recover after the backhand.'); ${reset}
    ${candidate()}
    select 'during|'||(active_processing_version_id=current_setting('task6.source_id')::uuid)::text||'|'||cut_path from matches where id='${M}';
    ${ready()} ${actor(A)}
    select 'compare|'||(admin_match_version_detail(current_setting('task6.source_id')::uuid)->'version'->'effects'->>'notes')||'|'||(admin_match_version_detail(current_setting('task6.candidate_id')::uuid)->'version'->'effects'->>'notes');
    select admin_publish_match_version(current_setting('task6.issue_id')::uuid,'Reviewed demo replacement.','Fixture media only.'); ${reset}
    ${actor(O)} select 'published|'||string_agg(id::text,',') from points where match_id='${M}'; ${reset}
    select 'preserved|'||confirmed_winner||'|'||(select count(*) from notes where point_id='${P}')||'|'||(select count(*) from point_tags where point_id='${P}')||'|'||(select count(*) from share_links where point_id='${P}') from points where id='${P}';
    select 'new-clean|'||(confirmed_winner is null)::text||'|'||(select count(*) from notes where point_id='${Q}')||'|'||(select count(*) from point_tags where point_id='${Q}') from points where id='${Q}';
    set local role anon; select 'point-link|'||point_id||'|'||cut_path from resolve_share_link('version-point-token-123456789012'); reset role;
    ${actor(A)} select admin_restore_match_issue_version(current_setting('task6.issue_id')::uuid,'Restored the demo original.'); ${reset}
    ${actor(O)} select 'restored|'||string_agg(id::text,',') from points where match_id='${M}';
    -- A resolved reprocess is immutable. A distinct owner request after
    -- restoration uses the ordinary submit RPC and the original spend.
    select set_config('task9.refund_id',submit_match_issue('${M}','refund','Return the original processing minutes.','dddddddd-1234-4234-8234-dddddddddddd')->>'id',true); ${reset}
    ${actor(A)} select admin_refund_match_issue(current_setting('task9.refund_id')::uuid,'11 minutes returned.','Demo verification.');
    select admin_refund_match_issue(current_setting('task9.refund_id')::uuid,'Repeated approval.',''); ${reset}
    select 'refund|'||count(*)||'|'||sum(minutes) from processing_ledger where user_id='${O}' and kind='refund';
    select 'refund-event|'||count(*) from match_processing_feedback_events where issue_id=current_setting('task9.refund_id')::uuid and kind='refunded';
    ${actor(O)} select 'library|'||status||'|'||(active_processing_version_id=current_setting('task6.source_id')::uuid)::text from matches where id='${M}'; ${reset}
    select 'after-refund|'||confirmed_winner||'|'||(select count(*) from notes where point_id='${P}')||'|'||(select count(*) from point_tags where point_id='${P}')||'|'||(select count(*) from share_links where point_id='${P}') from points where id='${P}'; rollback;`);
  for (const expected of [
    "during|true|r2://media/old-cut.mp4", "compare|2|0", `published|${Q}`,
    "preserved|user|2|1|1", "new-clean|true|0|0", `point-link|${P}|r2://media/old-cut.mp4`,
    `restored|${P}`, "refund|1|11", "refund-event|1", "library|ready|true", "after-refund|user|2|1|1",
  ]) assert.ok(out.split("\n").includes(expected), `missing lifecycle evidence: ${expected}\n${out}`);
});
test("inactive point mutation RPCs and dependent edits refuse stale ids", { skip: !enabled }, () => {
  const operations=[`select adjust_point('${Q}',30,41)`,`select split_point('${Q}',35)`,`select unsplit_point('${Q}','${P}',40,false,false)`,`select insert_point('${Q}',null,40,45)`,`select merge_points(array['${P}'::uuid,'${Q}'::uuid])`,`select set_server_override('${Q}','user')`,`insert into notes(match_id,point_id,author_id,body) values('${M}','${Q}','${O}','stale')`,`insert into share_links(owner,match_id,point_id,kind,token) values('${O}','${M}','${Q}','point','version-stale-token-123456789012')`,`select enqueue_reel('${M}','full',true,'{"points":[{"point_id":"${Q}"}]}')`];
  for(const operation of operations) {
    assert.throws(()=>sql(`begin; ${fixture()} ${candidate()} ${actor(O)} ${operation}; rollback;`), /point belongs to an inactive version/, operation);
  }
});

test("admin upload diagnostics stay on the active version while explicit candidate inspection remains available", { skip: !enabled }, () => {
  const out=sql(`begin; ${fixture()} ${candidate()} ${actor(A)} select admin_upload_detail('${M}')->'totals'->>'points'; ${reset} rollback;`);
  assert.match(out,/\n1$/);
});
test("null or unsupported reprocessing settings are refused before job creation", { skip: !enabled }, () => {
  for(const options of [{strictness:null},{placement:null},{trim_start_s:null},{trim_start_s:-1},{trim_end_s:1},{funding:"personal"},{input_path:"r2://elsewhere/source"}]) {
    assert.throws(()=>sql(`begin; ${fixture()} ${actor(A)} select admin_start_match_reprocess(current_setting('task6.issue_id')::uuid,'${JSON.stringify(options)}',''); rollback;`),/invalid processing options|unsupported option/);
  }
});
test("publication refuses a candidate whose worker has not completed", { skip: !enabled }, () => {
  assert.throws(()=>sql(`begin; ${fixture()} ${candidate()} ${ready()} update jobs set status='processing' where id=(select replacement_job_id from match_processing_feedback where match_id='${M}'); ${actor(A)} select admin_publish_match_version(current_setting('task6.issue_id')::uuid,'Reviewed.',''); rollback;`),/candidate not ready/);
});
test("restoration refuses unfinished replacement jobs and missing completion evidence", { skip: !enabled }, () => {
  for (const change of ["update jobs set status='processing' where id=(select replacement_job_id from match_processing_feedback where match_id='"+M+"')", "update match_processing_versions set completed_at=null where id=current_setting('task6.candidate_id')::uuid"]) {
    for (const status of ["ready", "superseded"]) {
      assert.throws(()=>sql(`begin; ${fixture()} ${candidate()} ${ready()} ${change}; update match_processing_versions set status='${status}' where id=current_setting('task6.candidate_id')::uuid; ${actor(A)} select admin_restore_match_version('${M}',current_setting('task6.candidate_id')::uuid,'Restore checked result.'); rollback;`),/candidate not ready/);
    }
  }
});
test("single-point reel scope must name the active point in its single-point manifest", { skip: !enabled }, () => {
  assert.throws(()=>sql(`begin; ${fixture()} ${candidate()} ${actor(O)} select enqueue_reel('${M}','v:point:${Q}',true,'{"points":[{"point_id":"${P}"}]}'); rollback;`),/point belongs to an inactive version/);
  assert.throws(()=>sql(`begin; ${fixture()} insert into points(id,match_id,idx,t0,t1) values('${Q}','${M}',1,30,40); ${actor(O)} select enqueue_reel('${M}','v:point:${P}',true,'{"points":[{"point_id":"${Q}"}]}'); rollback;`),/scope must match its single-point manifest/);
  assert.throws(()=>sql(`begin; ${fixture()} ${actor(O)} select enqueue_reel('${M}','v:point:${P}',true,'{"points":[{"point_id":"${P}"},{"point_id":"${P}"}]}'); rollback;`),/scope must match its single-point manifest/);
  const out=sql(`begin; ${fixture()} ${actor(O)} select enqueue_reel('${M}','v:point:${P}',true,'{"points":[{"point_id":"${P}"}]}'); ${reset} select count(*) from match_reels where match_id='${M}' and scope='v:point:${P}'; rollback;`);
  assert.match(out,/\n1$/);
});
test("same-match deferred constraints and active pointer invariants reject corrupt version assignments", { skip: !enabled }, () => {
  assert.throws(()=>sql(`begin; ${fixture()} update matches set active_processing_version_id=null where id='${M}'; set constraints all immediate; rollback;`),/match must have its own active version/);
  assert.throws(()=>sql(`begin; ${fixture()} ${candidate()} update points set processing_version_id=current_setting('task6.candidate_id')::uuid where id='${P}'; rollback;`),/point version is immutable/);
});
test("migration backfill preserves existing points and media rather than manufacturing new identities", { skip: !enabled }, () => {
  const migration=readFileSync("supabase/migrations/20260907130000_match_processing_versions.sql","utf8");
  const from=migration.indexOf("insert into public.match_processing_versions(match_id,source_job_id");
  const to=migration.indexOf("alter table public.points alter column processing_version_id set not null",from);
  const out=sql(`begin; ${fixture()}
    set constraints all immediate; set constraints all deferred;
    alter table points alter column processing_version_id drop not null;
    alter table points disable trigger a_points_version_guard;
    update points set processing_version_id=null where match_id='${M}';
    update matches set active_processing_version_id=null where id='${M}';
    update match_processing_feedback set source_version_id=null where match_id='${M}';
    delete from match_processing_versions where match_id='${M}';
    ${migration.slice(from,to)}
    set constraints all immediate;
    select p.id||'|'||v.cut_path from points p join match_processing_versions v on v.id=p.processing_version_id where p.id='${P}'; rollback;`);
  assert.match(out,new RegExp(`${P}\\|r2://media/old-cut.mp4$`));
});
test("missing raw source closes eligibility and rejects candidate creation", { skip: !enabled }, () => {
  const out=sql(`begin; ${fixture()} update matches set raw_path=null where id='${M}'; update jobs set input_path=null where id='${J}'; ${actor(O)} select match_issue_state('${M}')->>'canReprocess'; reset role; rollback;`);
  assert.match(out,/\nfalse$/);
  assert.throws(()=>sql(`begin; ${fixture()} update matches set raw_path=null where id='${M}'; update jobs set input_path=null where id='${J}'; ${actor(A)} select admin_start_match_reprocess(current_setting('task6.issue_id')::uuid,'{}',''); rollback;`),/original source is not available/);
});

test("default-off rollout hides and rejects owner reprocessing while preserving admin QA", { skip: !enabled }, () => {
  const out=sql(`begin; ${fixture()}
    update app_config set value='false' where key='match_reprocessing_enabled';
    ${actor(O)}
    select match_issue_state('${M}')->>'canReprocess';
    select cancel_match_issue(current_setting('task6.issue_id')::uuid)->>'status';
    do $$ begin
      begin
        perform submit_match_issue('${M}','reprocess','Try again','bbbbbbbb-1234-4234-8234-bbbbbbbbbbbb');
        raise exception 'disabled owner request accepted' using errcode='P0002';
      exception when raise_exception then
        if sqlerrm <> 'match reprocessing is not enabled' then raise; end if;
      end;
    end $$;
    do $$ begin perform set_config('task6.qa_refund_id',submit_match_issue('${M}','refund','Return the minutes','cccccccc-1234-4234-8234-cccccccccccc')->>'id',true); end $$;
    select 'refund';
    ${reset}
    ${actor(A)}
    select admin_start_match_reprocess(current_setting('task6.qa_refund_id')::uuid,'{}','QA run')->'issue'->>'status';
    ${reset}
    rollback;`);
  const facts = out.split("\n").filter(line =>
    ["false", "cancelled", "refund", "reprocess_queued"].includes(line));
  assert.deepEqual(facts, ["false", "cancelled", "refund", "reprocess_queued"]);
});

test("keeping current is idempotent and preserves notes, tags and coach drawings", { skip: !enabled }, () => {
  const out=sql(`begin; ${fixture()} ${candidate()} ${ready()}
    insert into tags(id,owner_id,label) values('80888888-8888-4888-8888-888888888808','${O}','Practice');
    insert into point_tags(point_id,tag_id,created_by) values('${P}','80888888-8888-4888-8888-888888888808','${O}');
    insert into offerings(id,coach_id,title,price_cents,turnaround_days) values('80888888-8888-4888-8888-888888888809','${C}','Review',500,1);
    insert into review_orders(id,offering_id,coach_id,student_id,match_id,status,price_cents,fee_mode,fee_cents,coach_share_cents,turnaround_days,followup_rounds) values('80888888-8888-4888-8888-888888888810','80888888-8888-4888-8888-888888888809','${C}','${O}','${M}','in_review',500,'fixed',0,500,1,0);
    insert into review_findings(id,order_id,image_point_id,image_path) values('80888888-8888-4888-8888-888888888811','80888888-8888-4888-8888-888888888810','${P}','r2://media/drawing.png');
    insert into review_finding_points(finding_id,point_id) values('80888888-8888-4888-8888-888888888811','${P}');
    ${actor(C)} do $$ begin
      begin update review_findings set image_point_id='${Q}' where id='80888888-8888-4888-8888-888888888811'; raise exception 'stale drawing accepted'; exception when object_not_in_prerequisite_state then null; end;
      begin insert into review_finding_points(finding_id,point_id) values('80888888-8888-4888-8888-888888888811','${Q}'); raise exception 'stale finding accepted'; exception when object_not_in_prerequisite_state then null; end;
    end $$; ${reset}
    ${actor(O)} do $$ begin
      begin insert into point_tags(point_id,tag_id,created_by) values('${Q}','80888888-8888-4888-8888-888888888808','${O}'); raise exception 'stale tag accepted'; exception when object_not_in_prerequisite_state then null; end;
    end $$;
    update points set confirmed_winner='user' where id='${Q}'; ${reset}
    do $$ begin if exists(select 1 from points where id='${Q}' and confirmed_winner is not null) then raise exception 'stale score changed'; end if; end $$;
    ${actor(A)} select admin_keep_current_match_version(current_setting('task6.issue_id')::uuid,'Current cut kept.','Checked'); select admin_keep_current_match_version(current_setting('task6.issue_id')::uuid,'Ignored repeat.',''); ${reset}
    select cut_path from matches where id='${M}';
    select count(*) from match_processing_feedback_events where issue_id=current_setting('task6.issue_id')::uuid and kind='kept_current';
    select (select count(*) from notes where match_id='${M}')||(select count(*)::text from point_tags where point_id='${P}')||(select count(*)::text from review_findings where image_point_id='${P}')||(select count(*)::text from review_finding_points where point_id='${P}'); rollback;`);
  assert.match(out,/\nr2:\/\/media\/old-cut.mp4\n1\n1111$/);
});

test("clients cannot forge support jobs or read private candidate records", { skip: !enabled }, () => {
  assert.throws(()=>sql(`begin; ${fixture()} ${actor(O)} insert into jobs(user_id,kind,status,options) values('${O}','match_reprocess','queued','{}'); rollback;`),/reprocessing jobs are admin-managed/);
  assert.throws(()=>sql(`begin; ${fixture()} ${candidate()} ${actor(O)} select * from match_processing_versions; rollback;`),/permission denied for table match_processing_versions/);
});

test("active point edits still work and queue only a version-bound active reclip", { skip: !enabled }, () => {
  const out=sql(`begin; ${fixture()} ${candidate()} ${actor(O)} select adjust_point('${P}',10,21); ${reset}
    select t1 from points where id='${P}';
    select count(*) from jobs where kind='reclip' and options->>'processing_version_id'=current_setting('task6.source_id'); rollback;`);
  assert.match(out,/\n21\n1$/);
});

test("two admins publishing concurrently receive one canonical decision and one notification event", { skip: !enabled }, async () => {
  const run=promisify(execFile);
  try {
    sql(`begin; ${fixture()} ${candidate()} ${ready()} commit;`);
    const issue=sql(`select id from match_processing_feedback where match_id='${M}'`);
    const query=`begin; ${actor(A)} select admin_publish_match_version('${issue}','Reviewed replacement.','')->'issue'->>'status'; commit;`;
    const results=await Promise.all([1,2].map(()=>run("docker",["exec",container,"psql","-q","-U","postgres","-d","postgres","-At","-v","ON_ERROR_STOP=1","-c",query],{timeout:20000})));
    for(const result of results) assert.match(result.stdout,/resolved_reprocessed/);
    assert.equal(sql(`select count(*) from match_processing_feedback_events where issue_id='${issue}' and kind='published'; select count(*) from match_issue_email_deliveries where issue_id='${issue}' and template='resolution'; select count(*) from processing_ledger where user_id='${O}';`),"1\n1\n1");
  } finally {
    sql(`delete from auth.users where id in ('${O}','${C}','${A}');`);
  }
});

test("admin close requires player text, handles pending and failed requests once, and refuses running work", { skip: !enabled }, () => {
  assert.throws(()=>sql(`begin; ${fixture()} ${actor(A)} select admin_close_match_issue(current_setting('task6.issue_id')::uuid,'',''); rollback;`),/invalid decision notes/);
  assert.throws(()=>sql(`begin; ${fixture()} ${actor(O)} select admin_close_match_issue(current_setting('task6.issue_id')::uuid,'Close.',''); rollback;`),/not authorized/);
  for (const status of ["pending","execution_failed"]) {
    const out=sql(`begin; ${fixture()} update match_processing_feedback set status='${status}' where match_id='${M}'; ${actor(A)} select admin_close_match_issue(current_setting('task6.issue_id')::uuid,'Current match kept.','Checked')->'issue'->>'status'; select admin_close_match_issue(current_setting('task6.issue_id')::uuid,'Repeat.','')->'issue'->>'player_note'; ${reset} select count(*) from match_processing_feedback_events where issue_id=current_setting('task6.issue_id')::uuid and kind='declined'; rollback;`);
    assert.match(out,/declined\nCurrent match kept\.[\s\S]*\n1$/);
  }
  assert.throws(()=>sql(`begin; ${fixture()} ${candidate()} ${actor(A)} select admin_close_match_issue(current_setting('task6.issue_id')::uuid,'Close.',''); rollback;`),/already decided/);
});
test("refund is exact for reprocess candidates, preserves artifacts and refuses already reversed or running spend", { skip: !enabled }, () => {
  const out=sql(`begin; ${fixture()} ${candidate()} ${ready()} ${actor(A)} select admin_refund_match_issue(current_setting('task6.issue_id')::uuid,'Minutes returned.','')->'issue'->>'status'; ${reset} select minutes from processing_ledger where user_id='${O}' and kind='refund'; select count(*) from points where match_id='${M}'; select status from match_processing_versions where id=current_setting('task6.candidate_id')::uuid; rollback;`);
  assert.match(out,/resolved_refunded[\s\S]*\n11\n2\nsuperseded$/);
  assert.throws(()=>sql(`begin; ${fixture()} ${candidate()} ${actor(A)} select admin_refund_match_issue(current_setting('task6.issue_id')::uuid,'Return.',''); rollback;`),/already decided/);
  assert.throws(()=>sql(`begin; ${fixture()} ${actor(O,"service_role")} select refund_processing_spend('${J}'); ${reset} ${actor(A)} select admin_refund_match_issue(current_setting('task6.issue_id')::uuid,'Return.',''); rollback;`),/nothing to refund/);
});
test("admin version facts and live refundable amount describe the exact active and candidate versions", { skip: !enabled }, () => {
  const out=sql(`begin; ${fixture()} update points set cut_t0=5,confirmed_winner='user' where id='${P}'; ${candidate()} ${actor(A)} select admin_match_issue_detail(current_setting('task6.issue_id')::uuid)->'issue'->>'refundable_minutes'; select admin_match_version_detail(current_setting('task6.source_id')::uuid)->'version'->'totals'; select admin_match_version_detail(current_setting('task6.source_id')::uuid)->'version'->'effects'->>'notes'; select admin_match_version_detail(current_setting('task6.candidate_id')::uuid)->'version'->'effects'->>'notes'; ${reset} rollback;`);
  assert.match(out,/\n11\n/); assert.match(out,/"points": 1/); assert.match(out,/"retained_duration_s": 15/); assert.match(out,/\n1\n0$/);
});
test("issue-scoped restoration only restores that published replacement and records one restoration", { skip: !enabled }, () => {
  assert.throws(()=>sql(`begin; ${fixture()} ${candidate()} ${ready()} ${actor(A)} select admin_restore_match_issue_version(current_setting('task6.issue_id')::uuid,'Restore.'); rollback;`),/replacement is not published/);
  const out=sql(`begin; ${fixture()} ${candidate()} ${ready()} ${actor(A)} select admin_publish_match_version(current_setting('task6.issue_id')::uuid,'Publish.',''); select admin_restore_match_issue_version(current_setting('task6.issue_id')::uuid,'Restore.'); select admin_restore_match_issue_version(current_setting('task6.issue_id')::uuid,'Repeat.'); ${reset} select cut_path from matches where id='${M}'; select count(*) from match_processing_feedback_events where issue_id=current_setting('task6.issue_id')::uuid and kind='restored'; rollback;`);
  assert.match(out,/\nr2:\/\/media\/old-cut.mp4\n1$/);
});
test("legacy restore cannot activate an unpublished candidate",{skip:!enabled},()=>{
  assert.throws(()=>sql(`begin; ${fixture()} ${candidate()} ${ready()} ${actor(A)} select admin_restore_match_version('${M}',current_setting('task6.candidate_id')::uuid,'Restore.'); rollback;`),/candidate not ready|replacement is not published/);
});
test("failed reprocessing can retry once with the same source and no extra charge",{skip:!enabled},()=>{
  const out=sql(`begin; ${fixture()} ${candidate()} update jobs set status='failed' where id=(select replacement_job_id from match_processing_feedback where match_id='${M}'); update match_processing_versions set status='failed' where id=current_setting('task6.candidate_id')::uuid; update match_processing_feedback set status='execution_failed' where match_id='${M}'; ${actor(A)} select admin_start_match_reprocess(current_setting('task6.issue_id')::uuid,'{}','Retry.')->'issue'->>'status'; select admin_start_match_reprocess(current_setting('task6.issue_id')::uuid,'{}','Repeat.')->'issue'->>'status'; ${reset} select count(*) from jobs where kind='match_reprocess' and user_id='${O}'; select count(*) from processing_ledger where user_id='${O}'; rollback;`);
  assert.match(out,/reprocess_queued\nreprocess_queued[\s\S]*\n2\n1$/);
});
test("queue shows live refundable spend and detail keeps original job provenance after publication",{skip:!enabled},()=>{
  const out=sql(`begin; ${fixture()} ${actor(A)} select refundable_minutes from admin_match_issue_list('pending') where match_id='${M}'; ${reset} ${candidate()} ${ready()} ${actor(A)} select admin_publish_match_version(current_setting('task6.issue_id')::uuid,'Publish.','')->'sourceJob'->>'id'; select admin_match_issue_detail(current_setting('task6.issue_id')::uuid)->'sourceJob'->>'chargedMinutes'; ${reset} rollback;`);
  assert.match(out,/\n11\n/); assert.match(out,new RegExp(`\\n${J}\\n11$`));
});
test("the exact additive review migration replays from the prior action contracts",{skip:!enabled},()=>{
  const issueMigration=readFileSync("supabase/migrations/20260907120000_match_processing_feedback.sql","utf8");
  const versionMigration=readFileSync("supabase/migrations/20260907130000_match_processing_versions.sql","utf8");
  const reviewMigration=readFileSync("supabase/migrations/20260907140000_match_issue_admin_review.sql","utf8");
  const oldRefund=issueMigration.slice(issueMigration.indexOf("create or replace function public.admin_refund_match_issue("),issueMigration.indexOf("revoke all on function public.admin_refund_match_issue("));
  const oldStart=versionMigration.slice(versionMigration.indexOf("create function public.admin_start_match_reprocess("),versionMigration.indexOf("create function public.activate_match_processing_version(")).replace("create function","create or replace function");
  const out=sql(`begin; ${fixture()} drop function public.admin_match_version_facts(uuid),public.admin_close_match_issue(uuid,text,text),public.admin_restore_match_issue_version(uuid,text); ${oldRefund} ${oldStart} ${reviewMigration} ${actor(A)} select admin_close_match_issue(current_setting('task6.issue_id')::uuid,'Reviewed.','')->'issue'->>'status'; ${reset} rollback;`);
  assert.match(out,/\ndeclined$/);
});

test("admin refund returns every eligible source spend and preserves each reversal's billing facts",{skip:!enabled},()=>{
  const out=sql(`begin; ${fixture()}
    update processing_ledger set purchase_id='91999999-9999-4999-8999-999999999991' where user_id='${O}' and kind='spend';
    insert into processing_ledger(user_id,minutes,kind,funding,billing_mode,match_id,job_id,purchase_id,created_at) values('${O}',-4,'spend','personal','test','${M}','${J}','91999999-9999-4999-8999-999999999992',now()+interval '1 second');
    ${actor(A)} select admin_match_issue_detail(current_setting('task6.issue_id')::uuid)->'issue'->>'refundable_minutes'; select admin_refund_match_issue(current_setting('task6.issue_id')::uuid,'Returned all eligible minutes.','')->'issue'->>'refundable_minutes'; select admin_refund_match_issue(current_setting('task6.issue_id')::uuid,'Repeated.','')->'issue'->>'refundable_minutes'; ${reset}
    select count(*)||'|'||sum(minutes) from processing_ledger where user_id='${O}' and kind='refund';
    select count(*) from processing_ledger r join processing_ledger s on s.id=r.reverses_id where r.user_id='${O}' and r.kind='refund' and r.minutes=-s.minutes and r.funding=s.funding and r.billing_mode=s.billing_mode and r.job_id=s.job_id and r.match_id=s.match_id and r.order_id is not distinct from s.order_id and r.purchase_id is not distinct from s.purchase_id;
    select metadata->>'minutes' from match_processing_feedback_events where issue_id=current_setting('task6.issue_id')::uuid and kind='refunded'; rollback;`);
  assert.match(out,/\n15\n15\n15\n2\|15\n2\n15$/);
});
test("an already reversed latest spend does not hide an earlier eligible source spend",{skip:!enabled},()=>{
  const out=sql(`begin; ${fixture()}
    insert into processing_ledger(user_id,minutes,kind,funding,billing_mode,match_id,job_id,created_at) values('${O}',-4,'spend','personal','test','${M}','${J}',now()+interval '1 second');
    insert into processing_ledger(user_id,minutes,kind,funding,billing_mode,match_id,job_id,reverses_id) select user_id,-minutes,'refund',funding,billing_mode,match_id,job_id,id from processing_ledger where user_id='${O}' and kind='spend' and minutes=-4;
    ${actor(A)} select admin_match_issue_detail(current_setting('task6.issue_id')::uuid)->'issue'->>'refundable_minutes'; select admin_refund_match_issue(current_setting('task6.issue_id')::uuid,'Returned the remaining minutes.','')->'issue'->>'refundable_minutes'; ${reset}
    select count(*)||'|'||sum(minutes) from processing_ledger where user_id='${O}' and kind='refund';
    select count(*) from match_processing_feedback_events where issue_id=current_setting('task6.issue_id')::uuid and kind='refunded'; rollback;`);
  assert.match(out,/\n11\n11\n2\|15\n1$/);
});
test("simultaneous multi-spend refunds return one canonical total and one resolution",{skip:!enabled},async()=>{
  const run=promisify(execFile);
  try {
    sql(`begin; ${fixture()} insert into processing_ledger(user_id,minutes,kind,funding,billing_mode,match_id,job_id) values('${O}',-4,'spend','personal','test','${M}','${J}'); commit;`);
    const issue=sql(`select id from match_processing_feedback where match_id='${M}'`);
    const query=`begin; ${actor(A)} select admin_refund_match_issue('${issue}','All eligible minutes returned.','')->'issue'->>'refundable_minutes'; commit;`;
    const results=await Promise.all([1,2].map(()=>run("docker",["exec",container,"psql","-q","-U","postgres","-d","postgres","-At","-v","ON_ERROR_STOP=1","-c",query],{timeout:20000})));
    for(const result of results)assert.match(result.stdout,/\n15\n$/);
    assert.equal(sql(`select count(*)||'|'||sum(minutes) from processing_ledger where user_id='${O}' and kind='refund'; select count(*) from match_processing_feedback_events where issue_id='${issue}' and kind='refunded'; select count(*) from match_issue_email_deliveries where issue_id='${issue}' and template='resolution';`),"2|15\n1\n1");
  } finally { sql(`delete from auth.users where id in ('${O}','${C}','${A}');`); }
});
