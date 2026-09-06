import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("new requests get one private receipt without backfilling old applicants or moving the invite", { skip: process.env.BETA_LOCAL_DB_TEST !== "1" }, () => {
  const file = new URL("../../../supabase/migrations/20260906020000_beta_request_receipt.sql", import.meta.url);
  const migration = existsSync(file) ? readFileSync(file, "utf8") : "";
  const sql = `begin;
    insert into ios_beta_requests(email) values ('receipt-old@example.com');
    ${migration}
    select 'old='||count(*) from ios_beta_deliveries where recipient='receipt-old@example.com' and kind='receipt';
    select * from claim_ios_beta_request_v2('receipt-new@example.com',repeat('r',64),'{"formVersion":2,"role":"player","interests":["iphone_recording"],"feedback":[]}');
    select * from claim_ios_beta_request_v2('receipt-new@example.com',repeat('r',64),'{"formVersion":2,"role":"player","interests":["iphone_recording"],"feedback":[]}');
    select 'receipt='||count(*) from ios_beta_deliveries where recipient='receipt-new@example.com' and kind='receipt';
    select 'jobs='||count(*) from ios_beta_deliveries where request_id=(select id from ios_beta_requests where email='receipt-new@example.com');
    select 'hours='||extract(epoch from(scheduled_at-created_at))/3600 from ios_beta_requests where email='receipt-new@example.com';
    update ios_beta_deliveries set state='delivered',provider_email_id='receipt-migration-provider' where recipient='receipt-new@example.com' and kind='receipt';
    select 'invite='||delivery_state||':unstamped='||(invite_sent_at is null) from ios_beta_requests where email='receipt-new@example.com';
    select 'private='||not(has_table_privilege('anon','ios_beta_deliveries','select') or has_table_privilege('authenticated','ios_beta_deliveries','select'));
    rollback;`;
  const result=execFileSync('docker',['exec','-i','ponglens-beta-intake-test-db','psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
  assert.match(result,/old=0/);
  assert.match(result,/receipt=1/);
  assert.match(result,/jobs=4/);
  assert.match(result,/hours=23\.0/);
  assert.match(result,/invite=pending:unstamped=true/);
  assert.match(result,/private=true/);
});
