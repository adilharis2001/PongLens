import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const enabled = process.env.PROCESSING_AVAILABILITY_LOCAL_DB_TEST === "1";
const container =
  process.env.MATCH_ISSUES_DB_CONTAINER ??
  "supabase_db_match-processing-feedback";
const database = `processing_availability_${process.pid}`;
const migrationPath =
  "supabase/migrations/20260913060000_processing_availability.sql";

const OWNER = "11111111-1111-4111-8111-111111111101";
const OTHER = "22222222-2222-4222-8222-222222222202";
const MATCH = "33333333-3333-4333-8333-333333333303";
const OTHER_MATCH = "44444444-4444-4444-8444-444444444404";
const JOB = "55555555-5555-4555-8555-555555555505";
const OTHER_JOB = "66666666-6666-4666-8666-666666666606";
const HAND_MATCH = "77777777-7777-4777-8777-777777777707";
const HAND_JOB = "88888888-8888-4888-8888-888888888808";

function args(db: string) {
  return [
    "exec",
    "-i",
    container,
    "psql",
    "-q",
    "-U",
    "postgres",
    "-d",
    db,
    "-At",
    "-v",
    "ON_ERROR_STOP=1",
  ];
}

function sql(query: string, db = database): string {
  try {
    return execFileSync("docker", args(db), {
      input: query,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    throw new Error(failure.stderr || failure.message);
  }
}

function actor(id: string, role = "authenticated") {
  return `select set_config('request.jwt.claims','${JSON.stringify({
    sub: id,
    role,
  })}',false); set role ${role};`;
}

const resetActor =
  "reset role; select set_config('request.jwt.claims','{}',false);";

function resetFixture() {
  sql(`truncate table public.match_video_checks, public.match_processing_events,
    public.worker_pulse, public.matches, public.jobs, public.app_config cascade;
    insert into public.app_config(key,value) values('reclip_lane','main');`);
}

function status(setup = "") {
  const output = sql(`begin; ${setup}
    select public.processing_service_status(); rollback;`);
  return JSON.parse(output.split("\n").at(-1)!);
}

test(
  "processing availability RPCs enforce lane health, routing, privacy and match feedback",
  { skip: !enabled },
  async (t) => {
    sql(`create database ${database}`, "postgres");
    try {
      sql(`create schema auth;
        create function auth.jwt() returns jsonb language sql stable as $$
          select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
        $$;
        create function auth.uid() returns uuid language sql stable as $$
          select nullif(auth.jwt()->>'sub','')::uuid
        $$;
        create table public.app_config(key text primary key,value text not null);
        create table public.jobs(
          id uuid primary key,user_id uuid not null,status text not null,
          kind text not null,input_path text,result_path text,error text,
          progress integer not null default 0,created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),options jsonb not null default '{}'
        );
        create table public.matches(
          id uuid primary key,user_id uuid not null,job_id uuid,status text,
          created_at timestamptz not null default now()
        );
        create table public.worker_pulse(
          worker_id text primary key,lane text not null,host text not null,
          beat_at timestamptz not null default now(),job_id uuid,stage text
        );
        grant usage on schema public,auth to anon,authenticated,service_role;`);

      sql(
        readFileSync(
          "supabase/migrations/20260912220000_upload_processing_feedback.sql",
          "utf8",
        ),
      );
      if (existsSync(migrationPath)) {
        sql(readFileSync(migrationPath, "utf8"));
      }

      await t.test("never-reported lanes stay unknown and queued work is not proof of life", () => {
        resetFixture();
        const result = status(`insert into jobs(id,user_id,status,kind,progress,updated_at,options)
          values
            ('${JOB}','${OWNER}','queued','deadspace_cut',50,now(),'{"edited":true}'),
            ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','${OWNER}','processing','deadspace_cut',20,now(),'{}');`);
        assert.deepEqual(
          { main: result.main, fast: result.fast, hand: result.hand },
          { main: "unknown", fast: "unknown", hand: "unknown" },
        );
        assert.equal(result.clip_lane, "main");
      });

      await t.test("fresh heartbeats are available independently through the 90-second edge", () => {
        resetFixture();
        const result = status(`insert into worker_pulse(worker_id,lane,host,beat_at,job_id)
          values
            ('mac:main','main','mac',now()-interval '90 seconds','${JOB}'),
            ('mac:fast','fast','mac',now()-interval '89 seconds',null),
            ('mac:hand','hand','mac',now(),null);`);
        assert.deepEqual(
          { main: result.main, fast: result.fast, hand: result.hand },
          { main: "available", fast: "available", hand: "available" },
        );
        assert.equal(
          sql(`begin; select (processing_service_status()->>'observed_at')::timestamptz=now(); rollback;`),
          "t",
          "observed_at must come from the database clock",
        );
      });

      await t.test("stale heartbeats make every previously reported lane unavailable", () => {
        resetFixture();
        const result = status(`insert into worker_pulse(worker_id,lane,host,beat_at)
          values
            ('mac:main','main','mac',now()-interval '90.001 seconds'),
            ('mac:fast','fast','mac',now()-interval '91 seconds'),
            ('mac:hand','hand','mac',now()-interval '1 day');`);
        assert.deepEqual(
          { main: result.main, fast: result.fast, hand: result.hand },
          { main: "unavailable", fast: "unavailable", hand: "unavailable" },
        );
      });

      await t.test("a recent queued-row edit is not worker progress", () => {
        resetFixture();
        const result = status(`insert into worker_pulse(worker_id,lane,host,beat_at)
          values('mac:main','main','mac',now()-interval '1 hour');
          insert into jobs(id,user_id,status,kind,progress,updated_at,options)
          values('${JOB}','${OWNER}','queued','deadspace_cut',50,now(),'{"edited":true}');`);
        assert.equal(result.main, "unavailable");
      });

      await t.test("only a fresh drain is maintenance and release refusal is unavailable", () => {
        resetFixture();
        const result = status(`insert into worker_pulse(worker_id,lane,host,beat_at,stage)
          values
            ('mac:main','main','mac',now(),'drained'),
            ('mac:fast','fast','mac',now(),'release_invalid'),
            ('mac:hand','hand','mac',now()-interval '91 seconds','drained');`);
        assert.deepEqual(
          { main: result.main, fast: result.fast, hand: result.hand },
          { main: "maintenance", fast: "unavailable", hand: "unavailable" },
        );
      });

      await t.test("recent genuine progress rescues only the lane that routes that job", () => {
        resetFixture();
        const result = status(`update app_config set value='fast' where key='reclip_lane';
          insert into worker_pulse(worker_id,lane,host,beat_at)
          values
            ('mac:main','main','mac',now()-interval '1 hour'),
            ('mac:fast','fast','mac',now()-interval '1 hour'),
            ('mac:hand','hand','mac',now()-interval '1 hour');
          insert into jobs(id,user_id,status,kind,progress,updated_at,options)
          values
            ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','${OWNER}','processing','deadspace_cut',20,now()-interval '180 seconds','{}'),
            ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','${OWNER}','processing','reclip',5,now(),'{}'),
            ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','${OWNER}','done','hand_cut',100,now(),'{}');`);
        assert.deepEqual(
          { main: result.main, fast: result.fast, hand: result.hand },
          { main: "available", fast: "available", hand: "available" },
        );

        resetFixture();
        const beyondEdge = status(`insert into worker_pulse(worker_id,lane,host,beat_at)
          values('mac:main','main','mac',now()-interval '1 hour');
          insert into jobs(id,user_id,status,kind,progress,updated_at)
          values('${JOB}','${OWNER}','processing','deadspace_cut',20,now()-interval '180.001 seconds');`);
        assert.equal(beyondEdge.main, "unavailable");
      });

      await t.test("lesson and unknown jobs cannot mask a stale main worker", () => {
        for (const [index, kind] of ["lesson_video", "future_job"].entries()) {
          resetFixture();
          const result = status(`insert into worker_pulse(worker_id,lane,host,beat_at)
            values('mac:main','main','mac',now()-interval '1 hour');
            insert into jobs(id,user_id,status,kind,progress,updated_at)
            values('cccccccc-cccc-4ccc-8ccc-${String(index + 1).padStart(12, "0")}',
              '${OWNER}','processing','${kind}',20,now());`);
          assert.equal(result.main, "unavailable", `${kind} is not handled by the main match worker`);
        }
      });

      await t.test("default, fast-switch, vertical-reel and hand routes match enqueue_job", () => {
        const cases = [
          { kind: "match_reprocess", options: {}, switch: "main", lane: "main" },
          { kind: "placement_generate", options: {}, switch: "main", lane: "main" },
          { kind: "placement_retry", options: {}, switch: "main", lane: "main" },
          { kind: "content_check", options: {}, switch: "main", lane: "main" },
          { kind: "youtube_import", options: {}, switch: "main", lane: "main" },
          { kind: "deadspace_cut", options: {}, switch: "main", lane: "main" },
          { kind: "reclip", options: {}, switch: "main", lane: "main" },
          { kind: "reclip", options: {}, switch: "fast", lane: "fast" },
          { kind: "reel", options: { scope: "v:match" }, switch: "fast", lane: "fast" },
          { kind: "reel", options: { scope: "highlights" }, switch: "fast", lane: "main" },
          { kind: "hand_cut", options: {}, switch: "fast", lane: "hand" },
        ];
        for (const [index, c] of cases.entries()) {
          resetFixture();
          const result = status(`update app_config set value='${c.switch}' where key='reclip_lane';
            insert into worker_pulse(worker_id,lane,host,beat_at)
            values('mac:${c.lane}','${c.lane}','mac',now()-interval '1 hour');
            insert into jobs(id,user_id,status,kind,progress,updated_at,options)
            values('bbbbbbbb-bbbb-4bbb-8bbb-${String(index + 1).padStart(12, "0")}','${OWNER}',
              'processing','${c.kind}',20,now(),'${JSON.stringify(c.options)}');`);
          assert.equal(result[c.lane], "available", `${c.kind} must route to ${c.lane}`);
          assert.equal(result.clip_lane, c.switch);
          for (const lane of ["main", "fast", "hand"].filter((x) => x !== c.lane)) {
            assert.equal(result[lane], "unknown", `${c.kind} must not prove ${lane}`);
          }
        }
      });

      await t.test("disabled cloud is never counted as a Mac fallback", () => {
        resetFixture();
        const result = status(`insert into worker_pulse(worker_id,lane,host,beat_at)
          values('modal:main','main','modal',now());`);
        assert.equal(result.main, "unknown");
      });

      await t.test("match feedback preserves its ten fields and adds owner-scoped lane state", () => {
        resetFixture();
        const output = sql(`begin;
          insert into jobs(id,user_id,status,kind,progress,options)
          values
            ('${JOB}','${OWNER}','processing','deadspace_cut',20,jsonb_build_object('match_id','${MATCH}')),
            ('${OTHER_JOB}','${OTHER}','processing','deadspace_cut',20,jsonb_build_object('match_id','${OTHER_MATCH}'));
          insert into matches(id,user_id,job_id,status)
          values
            ('${MATCH}','${OWNER}','${JOB}','processing'),
            ('${OTHER_MATCH}','${OTHER}','${OTHER_JOB}','processing');
          insert into worker_pulse(worker_id,lane,host,beat_at,job_id,stage)
          values('mac:main','main','mac',now(),'${JOB}','ball');
          insert into match_video_checks(job_id,match_id,checked_at,window_start_s,window_end_s,result)
          values('${JOB}','${MATCH}',now(),1,9,'{"schema":1,"status":"stable","changes":[]}');
          ${actor(OWNER)}
          select my_match_processing_feedback(array['${MATCH}','${OTHER_MATCH}']::uuid[]);
          ${resetActor} rollback;`);
        const feedback = JSON.parse(output.split("\n").find((line) => line.startsWith("["))!);
        assert.equal(feedback.length, 1);
        assert.deepEqual(Object.keys(feedback[0]).sort(), [
          "camera_check",
          "checked_at",
          "job_id",
          "job_kind",
          "job_status",
          "lane",
          "match_id",
          "service_state",
          "stage",
          "window_end_s",
          "window_start_s",
          "worker_state",
        ]);
        assert.equal(feedback[0].match_id, MATCH);
        assert.equal(feedback[0].lane, "main");
        assert.equal(feedback[0].service_state, "available");
        assert.equal(feedback[0].stage, "ball");
        assert.deepEqual(feedback[0].camera_check, {
          schema: 1,
          status: "stable",
          changes: [],
        });
      });

      await t.test("match feedback retains the 100-ID request limit", () => {
        resetFixture();
        const output = sql(`begin;
          insert into matches(id,user_id,status)
          select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
            '${OWNER}','uploaded' from generate_series(1,101) n;
          ${actor(OWNER)}
          select jsonb_array_length(my_match_processing_feedback(array(
            select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
            from generate_series(1,101) n order by n)));
          ${resetActor} rollback;`);
        assert.equal(output.split("\n").find((line) => line === "100"), "100");
      });

      await t.test("match feedback maps hand cuts to the independent hand lane", () => {
        resetFixture();
        const output = sql(`begin;
          insert into jobs(id,user_id,status,kind,progress,options)
          values('${HAND_JOB}','${OWNER}','processing','hand_cut',5,
            jsonb_build_object('match_id','${HAND_MATCH}'));
          insert into matches(id,user_id,job_id,status)
          values('${HAND_MATCH}','${OWNER}','${HAND_JOB}','processing');
          insert into worker_pulse(worker_id,lane,host,beat_at,job_id,stage)
          values('mac:hand','hand','mac',now(),'${HAND_JOB}','marks');
          ${actor(OWNER)}
          select my_match_processing_feedback(array['${HAND_MATCH}']::uuid[]);
          ${resetActor} rollback;`);
        const feedback = JSON.parse(output.split("\n").find((line) => line.startsWith("["))!);
        assert.equal(feedback[0].lane, "hand");
        assert.equal(feedback[0].service_state, "available");
        assert.equal(feedback[0].stage, "marks");
      });

      await t.test("only authenticated callers can read sanitized status and feedback", () => {
        assert.equal(
          sql(`select has_function_privilege('authenticated','public.processing_service_status()','execute')||'|'||
            has_function_privilege('authenticated','public.processing_lane_status(text)','execute')||'|'||
            has_function_privilege('anon','public.processing_service_status()','execute')||'|'||
            has_function_privilege('service_role','public.processing_service_status()','execute')||'|'||
            has_function_privilege('service_role','public.my_match_processing_feedback(uuid[])','execute');`),
          "true|false|false|false|false",
        );
        const authenticatedStatus = JSON.parse(
          sql("set role authenticated; select processing_service_status();"),
        );
        assert.deepEqual(Object.keys(authenticatedStatus).sort(), [
          "clip_lane",
          "fast",
          "hand",
          "main",
          "observed_at",
        ]);
        assert.throws(
          () => sql("set role anon; select processing_service_status();"),
          /permission denied for function processing_service_status/,
        );
        assert.throws(
          () => sql("set role anon; select my_match_processing_feedback('{}'::uuid[]);"),
          /permission denied for function my_match_processing_feedback/,
        );
        assert.throws(
          () => sql("set role service_role; select processing_service_status();"),
          /permission denied for function processing_service_status/,
        );
        assert.throws(
          () => sql("set role authenticated; select processing_lane_status('main');"),
          /permission denied for function processing_lane_status/,
        );
      });

      await t.test("the recurring recent-work lookup can use its partial updated-at index", () => {
        const plan = sql(`set enable_seqscan=off;
          explain (format json,costs off)
          select 1 from public.jobs j
          where j.status in ('processing','done','failed')
            and j.progress>0
            and j.updated_at>=now()-interval '180 seconds'
            and j.kind in ('match_reprocess','placement_generate','placement_retry',
              'hand_cut','reclip','reel','content_check','deadspace_cut','youtube_import')
          limit 1;`);
        assert.match(plan, /jobs_processing_availability_recent_idx/);
      });
    } finally {
      sql(`drop database if exists ${database} with (force)`, "postgres");
    }
  },
);
