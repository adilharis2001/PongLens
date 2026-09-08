import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const local = process.env.MATCH_ISSUES_LOCAL_DB_TEST === "1";
const container = process.env.MATCH_ISSUES_DB_CONTAINER ?? "supabase_db_match-processing-feedback";
const O = "e1000000-0000-4000-8000-000000000001";
const A = "e1000000-0000-4000-8000-000000000002";
const M = "e1000000-0000-4000-8000-000000000003";
const I = "e1000000-0000-4000-8000-000000000004";
const D = "e1000000-0000-4000-8000-000000000005";
const service = `select set_config('request.jwt.claims','{"role":"service_role"}',true); set local role service_role;`;
function sql(input: string) {
  return execFileSync("docker", ["exec", "-i", container, "psql", "-q", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"], { input, encoding: "utf8", stdio: "pipe" }).trim().split("\n");
}
function fixture() {
  return `insert into auth.users(id,email) values ('${O}','match-email-owner@example.com'),('${A}','adilharis2001@gmail.com');
    insert into matches(id,user_id,status) values ('${M}','${O}','uploaded');
    insert into match_processing_feedback(id,match_id,reporter_id,owner_id,reporter_role,kind,status,idempotency_key)
      values ('${I}','${M}','${O}','${O}','owner','problem','pending',gen_random_uuid());`;
}
function delivery() {
  return `with e as (insert into match_processing_feedback_events(issue_id,kind) values ('${I}','submitted') returning id)
    insert into match_issue_email_deliveries(id,issue_id,event_id,template,recipient_email)
      select '${D}','${I}',id,'submission','support@ponglens.com' from e;`;
}
test("candidate completion alerts the administrator without queuing an intermediate owner email", { skip: !local }, () => {
  const out = sql(`begin; ${fixture()}
    select record_match_version_event('${I}','candidate_ready','Ready for review.','private details','{}');
    select 'admin='||count(*) from notifications where user_id='${A}' and kind='match_reprocess_ready' and href='/admin/issues/${I}';
    select 'owner-email='||count(*) from match_issue_email_deliveries where issue_id='${I}';
    select record_match_version_event('${I}','execution_failed','We could not finish.','private details','{}');
    select 'admin-failure='||count(*) from notifications where user_id='${A}' and kind='match_reprocess_failed' and href='/admin/issues/${I}';
    select 'owner-failure='||count(*) from match_issue_email_deliveries d join match_processing_feedback_events e on e.id=d.event_id
      where d.issue_id='${I}' and e.kind='execution_failed' and recipient_email='match-email-owner@example.com';
    rollback;`);
  assert.ok(out.includes("admin=1"));
  assert.ok(out.includes("owner-email=0"));
  assert.ok(out.includes("admin-failure=1"));
  assert.ok(out.includes("owner-failure=1"));
});
test("provider webhook recovers acceptance before sender bookkeeping and later writes cannot downgrade delivery", { skip: !local }, () => {
  const out = sql(`begin; ${fixture()} ${delivery()} ${service}
    select 'claim='||(claim_match_issue_email_delivery('${D}','{"subject":"saved"}') is not null);
    select 'overlap='||(claim_match_issue_email_delivery('${D}','{"subject":"changed"}') is null);
    select apply_resend_event('match-delivery-early','{"type":"email.delivered","created_at":"2026-09-07T12:00:00Z","data":{"email_id":"match-provider-early","tags":{"match_issue_delivery_id":"${D}"}}}');
    select finish_match_issue_email_attempt('${D}','failed','late connection error',null);
    select finish_match_issue_email_attempt('${D}','accepted','', 'match-provider-early');
    select apply_resend_event('match-delivery-old-sent','{"type":"email.sent","data":{"email_id":"match-provider-early"}}');
    select 'receipt='||state||':'||provider_email_id||':'||(delivered_at is not null) from match_issue_email_deliveries where id='${D}';
    select 'retry='||(claim_match_issue_email_delivery('${D}','{"subject":"changed"}') is null);
    rollback;`);
  for (const expected of ["claim=true", "overlap=true", "receipt=delivered:match-provider-early:true", "retry=true"]) assert.ok(out.includes(expected), out.join("\n"));
});
test("uncertain send retries retain the exact payload but stop before the provider idempotency window expires", { skip: !local }, () => {
  const out = sql(`begin; ${fixture()} ${delivery()} ${service}
    select claim_match_issue_email_delivery('${D}','{"subject":"first"}');
    reset role; update match_issue_email_deliveries set lease_until=now()-interval '1 minute' where id='${D}'; set local role service_role;
    select 'payload='||claim_match_issue_email_delivery('${D}','{"subject":"changed"}');
    reset role; update match_issue_email_deliveries set lease_until=now()-interval '1 minute',first_attempt_at=now()-interval '24 hours' where id='${D}'; set local role service_role;
    select 'expired='||(claim_match_issue_email_delivery('${D}','{"subject":"changed"}') is null);
    select 'state='||state from match_issue_email_deliveries where id='${D}'; rollback;`);
  assert.ok(out.includes('payload={"subject":"first"}'));
  assert.ok(out.includes("expired=true"));
  assert.ok(out.includes("state=needs_attention"));
});
test("the combined webhook keeps permanent-bounce suppression and never resends a provider-confirmed failure", { skip: !local }, () => {
  const out = sql(`begin; ${fixture()} ${delivery()} ${service}
    select claim_match_issue_email_delivery('${D}','{}');
    select apply_resend_event('match-permanent-bounce','{"type":"email.bounced","data":{"email_id":"match-provider-bounce","to":["support@ponglens.com"],"bounce":{"type":"Permanent"},"tags":[{"name":"match_issue_delivery_id","value":"${D}"}]}}');
    select 'suppressed='||count(*) from email_suppressions where address='support@ponglens.com';
    select 'receipt='||state||':'||provider_email_id from match_issue_email_deliveries where id='${D}';
    select 'retry='||(claim_match_issue_email_delivery('${D}','{}') is null); rollback;`);
  assert.ok(out.includes("suppressed=1"));
  assert.ok(out.includes("receipt=failed:match-provider-bounce"));
  assert.ok(out.includes("retry=true"));
});

test("missing-context failures exhaust their retry budget instead of permanently occupying the queue", { skip: !local }, () => {
  const out = sql(`begin; ${fixture()} ${delivery()} ${service}
    select finish_match_issue_email_attempt('${D}','failed','Missing email context',null) from generate_series(1,10);
    select 'state='||state||':'||attempt_count from match_issue_email_deliveries where id='${D}'; rollback;`);
  assert.ok(out.includes("state=needs_attention:10"));
});

test("only service role can claim sends or apply provider receipts", { skip: !local }, () => {
  for (const role of ["anon", "authenticated"]) {
    const out = sql(`begin; select has_function_privilege('${role}','public.claim_match_issue_email_delivery(uuid,text)','execute');
      select has_function_privilege('${role}','public.finish_match_issue_email_attempt(uuid,text,text,text)','execute');
      select has_function_privilege('${role}','public.apply_resend_event(text,jsonb)','execute'); rollback;`);
    assert.deepEqual(out, ["f", "f", "f"]);
  }
});

test("the complete additive migration preserves accepted mail and quarantines legacy ambiguous attempts", { skip: !local }, () => {
  const migration = readFileSync(new URL("../../../supabase/migrations/20260907222000_match_issue_email_delivery.sql", import.meta.url), "utf8");
  const out = sql(`begin; ${fixture()} ${delivery()}
    drop function claim_match_issue_email_delivery(uuid,text),finish_match_issue_email_attempt(uuid,text,text,text),apply_resend_event(text,jsonb);
    drop index match_issue_email_provider_id_idx;
    alter table match_issue_email_deliveries drop column send_payload,drop column first_attempt_at,drop column lease_until,drop column idempotency_key;
    update match_issue_email_deliveries set state='failed',attempt_count=1 where id='${D}';
    with e as (insert into match_processing_feedback_events(issue_id,kind) values ('${I}','candidate_ready') returning id)
      insert into match_issue_email_deliveries(issue_id,event_id,template,recipient_email)
        select '${I}',id,'resolution','match-email-owner@example.com' from e;
    with e as (insert into match_processing_feedback_events(issue_id,kind) values ('${I}','published') returning id)
      insert into match_issue_email_deliveries(issue_id,event_id,template,recipient_email,state,attempt_count)
        select '${I}',id,'resolution','match-email-owner@example.com','accepted',1 from e;
    ${migration}
    select 'ambiguous='||state||':'||idempotency_key from match_issue_email_deliveries where id='${D}';
    select e.kind||'='||d.state from match_issue_email_deliveries d join match_processing_feedback_events e on e.id=d.event_id where d.issue_id='${I}';
    rollback;`);
  assert.ok(out.includes(`ambiguous=needs_attention:match-issue-${D}`));
  assert.ok(out.includes("candidate_ready=suppressed"));
  assert.ok(out.includes("published=accepted"));
});
