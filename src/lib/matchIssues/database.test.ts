import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import test from "node:test";

const runExecFile = promisify(execFile);
const local = process.env.MATCH_ISSUES_LOCAL_DB_TEST === "1";
const container =
  process.env.MATCH_ISSUES_DB_CONTAINER ??
  "supabase_db_match-processing-feedback";

const OWNER = "11111111-1111-4111-8111-111111111101";
const COACH = "22222222-2222-4222-8222-222222222202";
const OTHER = "33333333-3333-4333-8333-333333333303";
const ADMIN = "44444444-4444-4444-8444-444444444404";
const JOB = "55555555-5555-4555-8555-555555555505";
const MATCH = "66666666-6666-4666-8666-666666666606";
const POINT = "77777777-7777-4777-8777-777777777707";
const NOTE = "88888888-8888-4888-8888-888888888808";
const TAG = "99999999-9999-4999-8999-999999999909";

test("failed match state exposes exact automatic refund ledger receipts only to its owner", { skip: !local }, () => {
  const output = execFileSync("docker", ["exec", "-i", container, "psql", "-q", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"], {
    encoding: "utf8", input: `begin;
      ${readFileSync("supabase/migrations/20260907160000_match_issue_refresh_receipt.sql", "utf8")}
      ${baseFixture()}
      update matches set status='failed' where id='${MATCH}';
      ${claims(OWNER, "issue-owner@example.com")}
      set local role authenticated;
      select coalesce(match_issue_state('${MATCH}')->>'automaticRefund','no receipt');
      reset role;
      insert into processing_ledger(user_id,minutes,kind,funding,billing_mode,match_id,job_id)
        values('${OWNER}',-4,'spend','personal','live','${MATCH}','${JOB}');
      insert into processing_ledger(id,user_id,minutes,kind,funding,billing_mode,match_id,job_id,note,reverses_id,created_at)
        overriding system value
        select case minutes when -11 then 9007199254740993 else 9223372036854775807 end,
          user_id,-minutes,'refund',funding,billing_mode,match_id,job_id,'processing failed',id,'2026-09-07T12:00:00Z'
        from processing_ledger where job_id='${JOB}' and kind='spend';
      set local role authenticated;
      select match_issue_state('${MATCH}')->'automaticRefund';
      ${claims(COACH, "issue-coach@example.com")}
      select coalesce(match_issue_state('${MATCH}')->>'automaticRefund','hidden');
      reset role; rollback;`, stdio: "pipe",
  }).trim();
  const [before, receipt, coach] = output.split("\n");
  assert.equal(before, "no receipt");
  assert.equal(coach, "hidden");
  const expected = { minutes: 15, receiptIds: ["9007199254740993", "9223372036854775807"] };
  assert.deepEqual(JSON.parse(receipt), expected, "ledger bigint identities must not be rounded JSON numbers");
  assert.deepEqual(JSON.parse(readFileSync("ios/PongLens/PongLensTests/Fixtures/automatic-refund.json", "utf8")), expected,
    "the native fixture is the same receipt returned by real Postgres");
});

function claims(id: string, email: string): string {
  return `do $claims$ begin perform set_config('request.jwt.claims', '${JSON.stringify({
    sub: id,
    email,
    role: "authenticated",
  })}', false); end $claims$;`;
}

function baseFixture(funding = "personal", minutes = -11): string {
  return `
    insert into app_config(key,value) values('match_reprocessing_enabled','true')
      on conflict(key) do update set value=excluded.value;
    delete from auth.users where id in ('${OWNER}','${COACH}','${OTHER}','${ADMIN}');
    insert into auth.users (id,email) values
      ('${OWNER}','issue-owner@example.com'),
      ('${COACH}','issue-coach@example.com'),
      ('${OTHER}','issue-other@example.com'),
      ('${ADMIN}','adilharis2001@gmail.com');
    insert into public.jobs (id,user_id,status,kind,input_path,options)
    values ('${JOB}','${OWNER}','done','deadspace_cut','r2://ponglens-raw/${OWNER}/source.mp4','{}');
    insert into public.matches (
      id,user_id,job_id,status,raw_path,cut_path,match_json_path,duration_s
    ) values (
      '${MATCH}','${OWNER}','${JOB}','ready',
      'r2://ponglens-raw/${OWNER}/source.mp4',
      'r2://ponglens-media/results/${OWNER}/cut.mp4',
      'r2://ponglens-media/points/${OWNER}/${MATCH}/match.json',620
    );
    insert into public.processing_ledger (
      user_id,minutes,kind,funding,billing_mode,match_id,job_id
    ) values ('${OWNER}',${minutes},'spend','${funding}','live','${MATCH}','${JOB}');
    insert into public.points (id,match_id,idx,t0,t1)
    values ('${POINT}','${MATCH}',0,10,20);
    insert into public.notes (id,match_id,point_id,author_id,body)
    values ('${NOTE}','${MATCH}','${POINT}','${OWNER}','Keep this note');
    insert into public.tags (id,owner_id,label)
    values ('${TAG}','${OWNER}','Keep this tag');
    insert into public.point_tags (point_id,tag_id,created_by)
    values ('${POINT}','${TAG}','${OWNER}');
    insert into public.share_links (owner,match_id,point_id,kind,token)
    values ('${OWNER}','${MATCH}','${POINT}','point','12345678901234567890123456789012');
    insert into public.coach_links (player_id,coach_id,status)
    values ('${OWNER}','${COACH}','accepted');
  `;
}

function sql(query: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-q",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: query, encoding: "utf8" },
  ).trim();
}

test("player history exposes only their request events and safe fields", { skip: !local }, () => {
  const result = sql(`begin; ${baseFixture()}
    ${claims(OWNER, "issue-owner@example.com")}
    select submit_match_issue('${MATCH}','refund','Missing rally','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab');
    update public.match_processing_feedback_events set player_note='Received',
      internal_note='PRIVATE INTERNAL NOTE', metadata='{"secret":"PRIVATE METADATA"}';
    select coalesce((match_issue_state('${MATCH}')->'events')::text, 'missing');
    ${claims(COACH, "issue-coach@example.com")}
    select coalesce((match_issue_state('${MATCH}')->'events')::text, 'missing');
    rollback;`);
  const lines = result.split("\n");
  assert.notEqual(lines[lines.length - 2], "missing", "owner state must include event history");
  const ownerEvents = JSON.parse(lines[lines.length - 2]);
  assert.equal(ownerEvents.length, 1);
  assert.deepEqual(Object.keys(ownerEvents[0]).sort(), ["createdAt", "id", "issueId", "kind", "playerNote"]);
  assert.equal(ownerEvents[0].playerNote, "Received");
  assert.equal(ownerEvents[0].kind, "submitted");
  assert.equal(lines.at(-1), "[]");
});

async function sqlAsync(query: string): Promise<string> {
  const result = await runExecFile(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-q",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      query,
    ],
    { encoding: "utf8" },
  );
  return result.stdout.trim();
}

test(
  "owner eligibility and amounts come from the charged spend",
  { skip: !local },
  () => {
    const result = sql(`begin; ${baseFixture()}
      ${claims(OWNER, "issue-owner@example.com")}
      select match_issue_state('${MATCH}') ->> 'role';
      select match_issue_state('${MATCH}') ->> 'refundableMinutes';
      select match_issue_state('${MATCH}') ->> 'canRefund';
      select submit_match_issue('${MATCH}','positive','','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')->>'status';
      select submit_match_issue('${MATCH}','reprocess','Try again','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')->>'kind';
      rollback;`);
    assert.match(result, /owner\n11\ntrue\nrecorded\nreprocess/);
  },
);

test(
  "a coach may report a problem but cannot request an owner remedy",
  { skip: !local },
  () => {
    const result = sql(`begin; ${baseFixture()}
      ${claims(COACH, "issue-coach@example.com")}
      select submit_match_issue('${MATCH}','problem','The cut misses a rally','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')->>'kind';
      do $$ begin
        begin
          perform submit_match_issue('${MATCH}','refund','', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');
          raise exception 'coach remedy accepted' using errcode='P0002';
        exception when insufficient_privilege then null;
        end;
      end $$;
      ${claims(OTHER, "issue-other@example.com")}
      do $$ begin
        begin
          perform submit_match_issue('${MATCH}','problem','No access', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3');
          raise exception 'unrelated report accepted' using errcode='P0002';
        exception when insufficient_privilege then null;
        end;
      end $$;
      select count(*) from public.match_processing_feedback;
      rollback;`);
    assert.match(result, /problem\n1$/);
  },
);

test(
  "ready-only remedies, idempotency, active uniqueness, and cancellation are enforced",
  { skip: !local },
  () => {
    const result = sql(`begin; ${baseFixture()}
      ${claims(OWNER, "issue-owner@example.com")}
      update public.matches set status='uploaded' where id='${MATCH}';
      do $$ begin
        begin
          perform submit_match_issue('${MATCH}','reprocess','Again','cccccccc-cccc-4ccc-8ccc-ccccccccccc1');
          raise exception 'raw remedy accepted' using errcode='P0002';
        exception when raise_exception then null;
        end;
      end $$;
      update public.matches set status='ready' where id='${MATCH}';
      select submit_match_issue('${MATCH}','refund','Bad cut','cccccccc-cccc-4ccc-8ccc-ccccccccccc2')->>'id';
      select submit_match_issue('${MATCH}','refund','Bad cut','cccccccc-cccc-4ccc-8ccc-ccccccccccc2')->>'id';
      select count(*) from public.match_processing_feedback where kind='refund';
      select cancel_match_issue(id)->>'status' from public.match_processing_feedback where kind='refund';
      select count(*) from public.match_processing_feedback where status='cancelled';
      rollback;`);
    const lines = result.split("\n");
    assert.equal(lines[0], lines[1]);
    assert.deepEqual(lines.slice(2), ["1", "cancelled", "1"]);
  },
);

test(
  "order-funded processing offers no personal minute refund",
  { skip: !local },
  () => {
    const result = sql(`begin; ${baseFixture("order", -11)}
      ${claims(OWNER, "issue-owner@example.com")}
      select match_issue_state('${MATCH}')->>'refundableMinutes';
      select match_issue_state('${MATCH}')->>'canRefund';
      do $$ begin
        begin
          perform submit_match_issue('${MATCH}','refund','Bad cut','dddddddd-dddd-4ddd-8ddd-ddddddddddd1');
          raise exception 'uncharged refund accepted' using errcode='P0002';
        exception when raise_exception then null;
        end;
      end $$;
      rollback;`);
    assert.match(result, /0\nfalse/);
  },
);

test(
  "refund returns the exact spend once and preserves match work",
  { skip: !local },
  () => {
    const result = sql(`begin; ${baseFixture()}
      ${claims(OWNER, "issue-owner@example.com")}
      select submit_match_issue('${MATCH}','refund','Bad cut','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1')->>'id';
      ${claims(ADMIN, "adilharis2001@gmail.com")}
      select admin_refund_match_issue(id,'We returned your processing minutes.','Confirmed bad cut')->'issue'->>'status'
      from public.match_processing_feedback where match_id='${MATCH}';
      select admin_refund_match_issue(id,'We returned your processing minutes.','Confirmed bad cut')->'issue'->>'status'
      from public.match_processing_feedback where match_id='${MATCH}';
      select sum(minutes) from public.processing_ledger where match_id='${MATCH}' and kind='refund';
      select (select count(*) from public.matches where id='${MATCH}') || ':' ||
             (select count(*) from public.points where id='${POINT}') || ':' ||
             (select count(*) from public.notes where id='${NOTE}') || ':' ||
             (select count(*) from public.point_tags where point_id='${POINT}') || ':' ||
             (select count(*) from public.share_links where point_id='${POINT}');
      rollback;`);
    assert.match(result, /resolved_refunded\nresolved_refunded\n11\n1:1:1:1:1$/);
  },
);

test(
  "submission queues one support email and notifies the admin transactionally",
  { skip: !local },
  () => {
    const result = sql(`begin; ${baseFixture()}
      ${claims(OWNER, "issue-owner@example.com")}
      select submit_match_issue('${MATCH}','problem','The final point is missing','ffffffff-ffff-4fff-8fff-fffffffffff1')->>'status';
      select count(*) from public.notifications where kind='match_issue_reported' and match_id='${MATCH}';
      select count(*)||':'||min(recipient_email) from public.match_issue_email_deliveries;
      rollback;`);
    assert.match(result, /pending\n1\n1:support@ponglens\.com$/);
  },
);

test(
  "simultaneous refund approvals create one reversal",
  { skip: !local },
  async () => {
    sql(`${baseFixture()}
      ${claims(OWNER, "issue-owner@example.com")}
      select submit_match_issue('${MATCH}','refund','Bad cut','12121212-1212-4212-8212-121212121212');`);
    const issueId = sql(
      `select id from public.match_processing_feedback where match_id='${MATCH}'`,
    );
    const approve = `${claims(ADMIN, "adilharis2001@gmail.com")}
      select admin_refund_match_issue('${issueId}','We returned your processing minutes.','Confirmed bad cut')->'issue'->>'status';`;
    const [left, right] = await Promise.all([sqlAsync(approve), sqlAsync(approve)]);
    assert.equal(left, "resolved_refunded");
    assert.equal(right, "resolved_refunded");
    assert.equal(
      sql(
        `select count(*) from public.processing_ledger where reverses_id is not null and match_id='${MATCH}'`,
      ),
      "1",
    );
    sql(`delete from auth.users where id in ('${OWNER}','${COACH}','${OTHER}','${ADMIN}')`);
  },
);
