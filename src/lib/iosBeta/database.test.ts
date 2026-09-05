import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

// Explicit opt-in; never uses a project URL or any production credential.
const local = process.env.BETA_LOCAL_DB_TEST === "1";

test(
  "late scheduling observations cannot erase confirmed provider failure",
  { skip: !local },
  () => {
    assert.equal(
      sql("select beta_delivery_merge('failed','scheduled')"),
      "failed",
    );
    assert.equal(
      sql("select beta_delivery_merge('delivered','bounced')"),
      "bounced",
    );
  },
);
function sql(query: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "ponglens-beta-intake-test-db",
      "psql",
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
test("delivery storage is installed and service-only", { skip: !local }, () => {
  assert.equal(
    sql("select to_regclass('public.ios_beta_deliveries') is not null"),
    "t",
  );
  assert.equal(
    sql(
      "select has_table_privilege('anon','public.ios_beta_deliveries','select') or has_table_privilege('authenticated','public.ios_beta_requests','select')",
    ),
    "f",
  );
  assert.equal(
    sql(
      "select has_function_privilege('authenticated','public.lease_ios_beta_delivery(uuid,uuid)','execute') or has_function_privilege('anon','public.claim_ios_beta_request_v2(text,text,jsonb)','execute')",
    ),
    "f",
  );
});

test(
  "fixed first deadline, first answers, separate jobs, and token guarded leases execute in Postgres",
  { skip: !local },
  () => {
    const result = sql(`begin;
    select * from claim_ios_beta_request_v2('beta-db-test@example.com', repeat('b',64), '{"formVersion":2,"role":"player","interests":["iphone_recording"],"feedback":["email"]}');
    update ios_beta_requests set created_at='2026-09-05T12:00:00Z', scheduled_at='2026-09-06T11:00:00Z' where email='beta-db-test@example.com';
    select * from claim_ios_beta_request_v2('beta-db-test@example.com', repeat('b',64), '{"formVersion":2,"role":"coach","interests":["coach_students"],"feedback":["not_now"]}');
    select 'answer='||role||':'||feedback_choice||':'||to_char(scheduled_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') from ios_beta_requests where email='beta-db-test@example.com';
    select 'jobs='||count(*) from ios_beta_deliveries where request_id=(select id from ios_beta_requests where email='beta-db-test@example.com');
    select lease_ios_beta_delivery(id, '11111111-1111-4111-8111-111111111111') is not null from ios_beta_deliveries where kind='invite' and request_id=(select id from ios_beta_requests where email='beta-db-test@example.com');
    select 'second='||(lease_ios_beta_delivery(id, '22222222-2222-4222-8222-222222222222') is null) from ios_beta_deliveries where kind='invite' and request_id=(select id from ios_beta_requests where email='beta-db-test@example.com');
    select 'stale='||finish_ios_beta_delivery(id, '22222222-2222-4222-8222-222222222222', 'sent', null, null) from ios_beta_deliveries where kind='invite' and request_id=(select id from ios_beta_requests where email='beta-db-test@example.com');
    rollback;`);
    assert.match(result, /answer=player:opted_in:2026-09-06T11:00:00Z/);
    assert.match(result, /jobs=3/);
    assert.match(result, /second=true/);
    assert.match(result, /stale=false/);
  },
);

test(
  "SQL assigns the literal original deadline, rejects invalid choices, and preserves limiter",
  { skip: !local },
  () => {
    const result = sql(`begin;
    insert into ios_beta_requests(email,created_at) values ('fixed-deadline@example.com','2026-09-05T12:00:00Z');
    select 'deadline='||to_char(scheduled_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') from ios_beta_requests where email='fixed-deadline@example.com';
    do $$ begin
      begin perform claim_ios_beta_request_v2('invalid@example.com',repeat('c',64),'{"formVersion":2,"role":"player","interests":["coach_students"],"feedback":[]}'); raise exception 'validation missed' using errcode='P0002'; exception when sqlstate 'P0001' then null; end;
      for i in 1..10 loop perform claim_ios_beta_request('limit@example.com',repeat('d',64)); end loop;
    end $$;
    select 'limited='||rate_limited from claim_ios_beta_request('limit@example.com',repeat('d',64));
    rollback;`);
    assert.match(result, /deadline=2026-09-06T11:00:00Z/);
    assert.match(result, /limited=true/);
  },
);

test(
  "signed provider evidence can arrive before POST persistence and never regresses on replay",
  { skip: !local },
  () => {
    const result = sql(`begin;
    insert into ios_beta_requests(email) values ('event-before-stamp@example.com');
    update ios_beta_deliveries set first_attempt_at=now(),create_payload='{}',state='unknown',lease_token='11111111-1111-4111-8111-111111111111',lease_until=now()+interval '1 minute' where kind='invite' and recipient='event-before-stamp@example.com';
    select apply_resend_beta_event('early-event-test',jsonb_build_object('type','email.delivered','created_at','2026-09-05T13:00:00Z','data',jsonb_build_object('email_id','provider-early','tags',jsonb_build_object('beta_delivery_id',id)))) from ios_beta_deliveries where recipient='event-before-stamp@example.com';
    select finish_ios_beta_delivery(id,'11111111-1111-4111-8111-111111111111','scheduled','provider-early',null) from ios_beta_deliveries where recipient='event-before-stamp@example.com';
    select apply_resend_beta_event('late-scheduled-test','{"type":"email.scheduled","created_at":"2026-09-05T12:00:00Z","data":{"email_id":"provider-early"}}');
    select 'state='||delivery_state||':'||provider_email_id from ios_beta_requests where email='event-before-stamp@example.com';
    select apply_resend_beta_event('early-event-test','{"type":"email.failed","data":{"email_id":"provider-early"}}');
    select 'replayed='||delivery_state from ios_beta_requests where email='event-before-stamp@example.com';
    rollback;`);
    assert.match(result, /state=delivered:provider-early/);
    assert.match(result, /replayed=delivered/);
  },
);

test(
  "non-beta bounce rules and transaction rollback preserve suppression without poisoning event dedupe",
  { skip: !local },
  () => {
    const result = sql(`begin;
    select apply_resend_beta_event('soft-local','{"type":"email.bounced","data":{"to":["soft-local@example.com"],"bounce":{"type":"Transient"}}}');
    select 'soft='||count(*) from email_suppressions where address='soft-local@example.com';
    select apply_resend_beta_event('complaint-local','{"type":"email.complained","data":{"to":["hard-local@example.com"]}}');
    select apply_resend_beta_event('hard-local','{"type":"email.bounced","data":{"to":["hard-local@example.com"],"bounce":{"type":"Permanent"}}}');
    select 'reason='||reason from email_suppressions where address='hard-local@example.com';
    do $$ begin begin perform apply_resend_beta_event('failed-tx-local','{"type":"email.complained","data":{"to":123}}'); exception when others then null; end; end $$;
    select 'poisoned='||count(*) from resend_events where event_id='failed-tx-local';
    rollback;`);
    assert.match(result, /soft=0/);
    assert.match(result, /reason=complained/);
    assert.match(result, /poisoned=0/);
  },
);

test(
  "duplicate suppression events still return outstanding cancellation work",
  { skip: !local },
  () => {
    const result = sql(`begin;
    insert into ios_beta_requests(email) values ('cancel-local@example.com');
    update ios_beta_deliveries set state='scheduled',provider_email_id='provider-cancel-local' where recipient='cancel-local@example.com';
    select 'first='||cardinality(apply_resend_beta_event('cancel-local-event','{"type":"email.complained","data":{"email_id":"unrelated-email-id","to":["cancel-local@example.com"]}}'));
    select 'retry='||cardinality(apply_resend_beta_event('cancel-local-event','{"type":"email.complained","data":{"email_id":"unrelated-email-id","to":["cancel-local@example.com"]}}'));
    select 'unchanged='||delivery_state from ios_beta_requests where email='cancel-local@example.com';
    rollback;`);
    assert.match(result, /first=1/);
    assert.match(result, /retry=1/);
    assert.match(result, /unchanged=scheduled/);
  },
);
