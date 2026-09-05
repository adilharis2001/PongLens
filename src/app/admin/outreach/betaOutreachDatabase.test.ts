import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
const local = process.env.BETA_LOCAL_DB_TEST === "1";
test(
  "the complete outreach migration replays with the normal postgres migration role",
  { skip: !local },
  () => {
    const migration = readFileSync(
      new URL(
        "../../../../supabase/migrations/20260905221000_beta_outreach.sql",
        import.meta.url,
      ),
      "utf8",
    );
    // Undo only this migration inside a rollback-only local transaction. The real
    // auth.users table and its existing postgres TRIGGER privilege remain intact.
    const out = sql(`begin;
    drop trigger preserve_beta_outreach_before_account_delete on auth.users;
    drop function _outreach_preserve_beta_history();
    drop function admin_outreach_act(text,uuid,text,text,date,text,text);
    drop function admin_beta_feedback_correct(uuid,text,text[],text,text[],text);
    drop function admin_beta_outreach_roster();
    drop function _outreach_groups(); drop function _outreach_members();
    drop table ios_beta_outreach_corrections; drop table ios_beta_outreach;
    alter table user_outreach_touches drop column beta_request_id;
    alter table user_outreach_touches add constraint user_outreach_touches_one_subject check ((user_id is null)<>(person_id is null));
    ${migration}
    select 'migration-role='||current_user;
    select 'trigger-owner='||pg_get_userbyid(relowner) from pg_class where oid='auth.users'::regclass;
    select 'trigger='||has_table_privilege(current_user,'auth.users','TRIGGER');
    rollback;`);
    assert.match(out, /migration-role=postgres/);
    assert.match(out, /trigger-owner=supabase_auth_admin/);
    assert.match(out, /trigger=true/);
  },
);
test(
  "ordinary authenticated accounts cannot mutate or enumerate outreach",
  { skip: !local },
  () => {
    for (const call of [
      "admin_outreach_act('beta','30000000-0000-0000-0000-000000000001','status','closed')",
      "admin_beta_feedback_correct('30000000-0000-0000-0000-000000000001',null,'{}','declined','{}','Forged')",
      "admin_outreach_counts()",
      "admin_outreach_touches()",
    ])
      assert.throws(
        () =>
          sql(
            `begin; set local role authenticated; select * from ${call}; rollback;`,
          ),
        /not authorized/,
      );
  },
);
function sql(input: string) {
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
    { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}
const admin = `select set_config('request.jwt.claims','{"email":"aber97@gmail.com","role":"authenticated"}',true); set local role authenticated;`;
const seed = `insert into ios_beta_requests(id,email,role,interests,feedback_choice,feedback_channels) values ('30000000-0000-0000-0000-000000000001','linked@club.org','player',array['iphone_recording'],'opted_in',array['audio_call']);`;
test(
  "beta outreach storage denies public reads and untrusted RPC execution",
  { skip: !local },
  () => {
    assert.equal(
      sql("select to_regclass('public.ios_beta_outreach') is not null"),
      "t",
    );
    assert.equal(
      sql(
        "select has_table_privilege('authenticated','ios_beta_outreach','select') or has_function_privilege('anon','admin_beta_outreach_roster()','execute') or has_function_privilege('authenticated','_outreach_groups()','execute')",
      ),
      "f",
    );
    assert.throws(
      () =>
        sql(
          "begin; set local role authenticated; select * from admin_beta_outreach_roster(); rollback;",
        ),
      /not authorized/,
    );
    assert.throws(
      () =>
        sql(
          "begin; set local role anon; select * from admin_beta_outreach_roster(); rollback;",
        ),
      /permission denied/,
    );
  },
);
test(
  "beta/account/manual deduplicate counts, retain all histories, and clear all source reminders atomically",
  { skip: !local },
  () => {
    const out = sql(`begin; ${seed}
    insert into auth.users(id,email,created_at) values ('10000000-0000-0000-0000-000000000001','LINKED@club.org',now());
    insert into user_outreach_people(id,name,email,created_by,follow_up_on) values ('20000000-0000-0000-0000-000000000001','Manual',' linked@club.org ','Admin',current_date-2);
    insert into ios_beta_outreach(request_id,status,follow_up_on) values ('30000000-0000-0000-0000-000000000001','in_touch',current_date-1);
    insert into user_outreach_touches(beta_request_id,kind,channel,body,author,at) values ('30000000-0000-0000-0000-000000000001','feedback','audio_call','Unchanged feedback','Anton','2026-09-01');
    select 'group='||count(*)||':'||min(status) from _outreach_groups() where beta_id='30000000-0000-0000-0000-000000000001';
    ${admin}
    select 'due='||follow_ups_due from admin_outreach_counts();
    select admin_outreach_act('beta','30000000-0000-0000-0000-000000000001','follow_up',null,null,null,null);
    select admin_outreach_act('beta','30000000-0000-0000-0000-000000000001','touch','note',null,null,'Account note');
    reset role;
    select 'dates='||count(*) from _outreach_groups() where beta_id='30000000-0000-0000-0000-000000000001' and follow_up_on is not null;
    select 'original='||body||':'||author||':'||at::date from user_outreach_touches where kind='feedback';
    select 'canonical='||count(*) from user_outreach_touches where user_id='10000000-0000-0000-0000-000000000001' and body='Account note';
    rollback;`);
    assert.match(out, /group=1:in_touch/);
    assert.match(out, /due=1/);
    assert.match(out, /dates=0/);
    assert.match(out, /original=Unchanged feedback:Anton:2026-09-01/);
    assert.match(out, /canonical=1/);
  },
);
test(
  "withdrawal is audited, removes linked feedback counts, and never alters delivery",
  { skip: !local },
  () => {
    const out = sql(`begin; ${seed} ${admin}
    select 'before='||to_contact from admin_outreach_counts();
    select admin_beta_feedback_correct('30000000-0000-0000-0000-000000000001','player',array['iphone_recording'],'declined','{}','Requested withdrawal by email');
    select 'after='||to_contact from admin_outreach_counts();
    reset role;
    select 'saved='||feedback_choice||':'||delivery_state from ios_beta_requests where email='linked@club.org';
    select 'audit='||count(*) from ios_beta_outreach_corrections where note='Requested withdrawal by email' and before_answers->>'feedback_choice'='opted_in'; rollback;`);
    assert.match(out, /before=1/);
    assert.match(out, /after=0/);
    assert.match(out, /saved=declined:pending/);
    assert.match(out, /audit=1/);
  },
);
test(
  "new account inherits beta state, and later removal retains its authored log with beta",
  { skip: !local },
  () => {
    const out = sql(`begin; ${seed}
    insert into ios_beta_outreach(request_id,status,follow_up_on) values ('30000000-0000-0000-0000-000000000001','contacted',current_date);
    insert into auth.users(id,email,created_at) values ('10000000-0000-0000-0000-000000000001','linked@club.org',now());
    select 'linked='||status from _outreach_groups() where beta_id='30000000-0000-0000-0000-000000000001';
    insert into user_outreach_touches(user_id,kind,body,author,at) values ('10000000-0000-0000-0000-000000000001','note','Keep me','Adil','2026-09-02');
    delete from auth.users where id='10000000-0000-0000-0000-000000000001';
    select 'retained='||body||':'||author||':'||at::date from user_outreach_touches where beta_request_id='30000000-0000-0000-0000-000000000001'; rollback;`);
    assert.match(out, /linked=contacted/);
    assert.match(out, /retained=Keep me:Adil:2026-09-02/);
  },
);
test(
  "touch subjects are exactly one and feedback correction requires verified audit and valid choices",
  { skip: !local },
  () => {
    assert.throws(
      () =>
        sql(
          `begin; ${seed} insert into user_outreach_touches(kind,body,author) values ('note','Invalid','Admin'); rollback;`,
        ),
      /one_subject/,
    );
    assert.throws(
      () =>
        sql(
          `begin; ${seed} insert into auth.users(id,email) values ('10000000-0000-0000-0000-000000000001','two@club.org'); insert into user_outreach_touches(user_id,beta_request_id,kind,body,author) values ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','note','Invalid','Admin'); rollback;`,
        ),
      /one_subject/,
    );
    assert.throws(
      () =>
        sql(
          `begin; ${seed} ${admin} select admin_beta_feedback_correct('30000000-0000-0000-0000-000000000001','player',array['coach_students'],'opted_in',array['email'],'Verified'); rollback;`,
        ),
      /invalid/,
    );
    assert.throws(
      () =>
        sql(
          `begin; ${seed} ${admin} select admin_beta_feedback_correct('30000000-0000-0000-0000-000000000001','player',array['iphone_recording'],'declined','{}',''); rollback;`,
        ),
      /audit note/,
    );
  },
);
test(
  "a note does not silently erase conflicting established source statuses",
  { skip: !local },
  () => {
    const out = sql(`begin; ${seed}
  insert into auth.users(id,email) values ('10000000-0000-0000-0000-000000000001','linked@club.org');
  insert into user_outreach_contacts(user_id,status) values ('10000000-0000-0000-0000-000000000001','closed');
  insert into ios_beta_outreach(request_id,status) values ('30000000-0000-0000-0000-000000000001','in_touch');
  ${admin} select admin_outreach_act('beta','30000000-0000-0000-0000-000000000001','touch','note',null,null,'No state change'); reset role;
  select 'beta='||status from ios_beta_outreach where request_id='30000000-0000-0000-0000-000000000001'; rollback;`);
    assert.match(out, /beta=in_touch/);
  },
);
