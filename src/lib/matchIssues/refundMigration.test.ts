import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const enabled = process.env.MATCH_ISSUES_LOCAL_DB_TEST === "1";
const container = process.env.MATCH_ISSUES_DB_CONTAINER ?? "supabase_db_match-processing-feedback";
const migration = readFileSync("supabase/migrations/20260907210000_match_processing_feedback.sql", "utf8");
// Execute the shipped migration statements against a transaction-local copy of
// the real ledger schema. Only its namespace changes; no live ledger is reset.
const backfill = migration.slice(0, migration.indexOf("create table public.match_processing_feedback ("))
  .replaceAll("public.processing_ledger", "pg_temp.processing_ledger");
const workerRefund = migration.slice(migration.indexOf("create or replace function public.refund_processing_spend("),
  migration.indexOf("revoke all on function public.refund_processing_spend("))
  .replaceAll("public.refund_processing_spend", "pg_temp.refund_processing_spend")
  .replaceAll("public.processing_ledger", "pg_temp.processing_ledger");
const queuedCancel = migration.slice(migration.indexOf("create or replace function public.cancel_queued_processing("),
  migration.indexOf("revoke all on function public.cancel_queued_processing("))
  .replaceAll("public.cancel_queued_processing", "pg_temp.cancel_queued_processing")
  .replaceAll("public.processing_ledger", "pg_temp.processing_ledger")
  .replaceAll("public.jobs", "pg_temp.jobs");
const owner = "11111111-1111-4111-8111-111111111101";
const job = "55555555-5555-4555-8555-555555555505";
const match = "66666666-6666-4666-8666-666666666606";

type Row = {
  id: number; minutes: number; kind: "spend" | "refund";
  mode?: "live" | "test"; funding?: "personal" | "order";
  userId?: string; matchId?: string | null; jobId?: string | null;
  orderId?: string | null; purchaseId?: string | null;
};
function literal(value: string | null) { return value === null ? "null" : `'${value}'`; }
function fixture(rows: Row[]) {
  return `create temp table processing_ledger (like public.processing_ledger including defaults including constraints);
    alter table pg_temp.processing_ledger drop column reverses_id;
    alter table pg_temp.processing_ledger add primary key (id);
    alter table pg_temp.processing_ledger alter column id add generated always as identity (start with 1000000);
    insert into pg_temp.processing_ledger(id,user_id,minutes,kind,funding,billing_mode,match_id,job_id,order_id,purchase_id,created_at)
    overriding system value values ${rows.map(row => `(${row.id},'${row.userId ?? owner}',${row.minutes},'${row.kind}',
      '${row.funding ?? "personal"}','${row.mode ?? "live"}',${literal(row.matchId === undefined ? match : row.matchId)},
      ${literal(row.jobId === undefined ? job : row.jobId)},${literal(row.orderId ?? null)},${literal(row.purchaseId ?? null)},'2026-09-07T12:00:00Z')`).join(",")};`;
}
function sql(body: string) {
  return execFileSync("docker", ["exec", "-i", container, "psql", "-q", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"], {
    input: `begin; ${body} rollback;`, encoding: "utf8", stdio: "pipe",
  }).trim();
}
const pairs = "select string_agg(id||':'||reverses_id,',' order by id) from pg_temp.processing_ledger where kind='refund';";
const refundTwice = `${workerRefund}
  do $$ begin perform set_config('request.jwt.claims','{"role":"service_role"}',true); end $$;
  select pg_temp.refund_processing_spend('${job}'); select pg_temp.refund_processing_spend('${job}');`;

test("historical multi-spend refunds pair exactly once by financial identity, including equal charges", { skip: !enabled }, () => {
  const result = sql(`${fixture([
    { id: 101, minutes: -7, kind: "spend" },
    { id: 102, minutes: -4, kind: "spend" },
    { id: 103, minutes: -4, kind: "spend" },
    { id: 104, minutes: -7, kind: "spend", mode: "test" },
    { id: 105, minutes: -7, kind: "spend", funding: "order" },
    { id: 201, minutes: 4, kind: "refund" },
    { id: 202, minutes: 7, kind: "refund", mode: "test" },
    { id: 203, minutes: 7, kind: "refund" },
    { id: 204, minutes: 4, kind: "refund" },
  ])} ${backfill} ${pairs}`);
  assert.equal(result, "201:102,202:104,203:101,204:103");
});

test("a partly refunded historical job returns only its remaining exact spends after migration", { skip: !enabled }, () => {
  const result = sql(`${fixture([
    { id: 101, minutes: -7, kind: "spend" },
    { id: 102, minutes: -4, kind: "spend" },
    { id: 103, minutes: -4, kind: "spend" },
    { id: 201, minutes: 4, kind: "refund" },
  ])} ${backfill} ${pairs} ${refundTwice}
    select count(*)||'|'||sum(minutes)||'|'||count(distinct reverses_id)
      from pg_temp.processing_ledger where kind='refund';
    select sum(minutes) from pg_temp.processing_ledger;`);
  assert.deepEqual(result.split("\n").filter(Boolean), ["201:102", "3|15|3", "0"]);
});

test("an already refunded historical job receives no second refund after migration", { skip: !enabled }, () => {
  const result = sql(`${fixture([
    { id: 101, minutes: -7, kind: "spend" },
    { id: 102, minutes: -4, kind: "spend" },
    { id: 201, minutes: 4, kind: "refund" },
    { id: 202, minutes: 7, kind: "refund" },
  ])} ${backfill} ${refundTwice} ${pairs}
    select count(*)||'|'||sum(minutes) from pg_temp.processing_ledger where kind='refund';`);
  assert.deepEqual(result.split("\n").filter(Boolean), ["201:102,202:101", "2|11"]);
});

test("historical refunds with a retained job can match a deleted match and exact optional funding facts", { skip: !enabled }, () => {
  const result = sql(`${fixture([
    { id: 101, minutes: -7, kind: "spend", matchId: null },
    { id: 102, minutes: -4, kind: "spend", orderId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", purchaseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    { id: 201, minutes: 7, kind: "refund", matchId: null },
    { id: 202, minutes: 4, kind: "refund", orderId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", purchaseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
  ])} ${backfill} ${pairs}`);
  assert.equal(result, "201:101,202:102");
});

test("Apple purchase refunds are not mistaken for processing reversals", { skip: !enabled }, () => {
  const purchase = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const result = sql(`${fixture([
    { id: 101, minutes: -11, kind: "spend" },
    { id: 201, minutes: -20, kind: "refund", jobId: null, matchId: null, purchaseId: purchase },
  ])} ${backfill}
    select id||':'||coalesce(reverses_id::text,'purchase')
      from pg_temp.processing_ledger where kind='refund' order by id;`);
  assert.equal(result, "201:purchase");
});

test("queued cancellation and worker failure cannot refund one spend twice", { skip: !enabled }, () => {
  const result = sql(`${fixture([{ id: 101, minutes: -11, kind: "spend" }])} ${backfill}
    create temp table jobs (like public.jobs including defaults including constraints);
    insert into pg_temp.jobs(id,user_id,status,kind,options)
      values('${job}','${owner}','queued','deadspace_cut','{}');
    ${queuedCancel}
    do $$ begin perform set_config('request.jwt.claims','${JSON.stringify({ sub: owner, role: "authenticated" })}',true); end $$;
    select pg_temp.cancel_queued_processing('${job}')->>'refunded_minutes';
    ${workerRefund}
    do $$ begin perform set_config('request.jwt.claims','{"role":"service_role"}',true); end $$;
    select pg_temp.refund_processing_spend('${job}');
    select count(*)||'|'||sum(minutes)||'|'||count(distinct reverses_id)
      from pg_temp.processing_ledger where kind='refund';`);
  assert.deepEqual(result.split("\n").filter(Boolean), ["11", "1|11|1"]);
});

const ambiguous: { name: string; rows: Row[] }[] = [
  { name: "partial amount", rows: [{ id: 101, minutes: -11, kind: "spend" }, { id: 201, minutes: 5, kind: "refund" }] },
  { name: "extra reversal", rows: [{ id: 101, minutes: -11, kind: "spend" }, { id: 201, minutes: 11, kind: "refund" }, { id: 202, minutes: 11, kind: "refund" }] },
  { name: "different billing mode", rows: [{ id: 101, minutes: -11, kind: "spend" }, { id: 201, minutes: 11, kind: "refund", mode: "test" }] },
  { name: "different funding", rows: [{ id: 101, minutes: -11, kind: "spend", funding: "order" }, { id: 201, minutes: 11, kind: "refund" }] },
  { name: "different owner", rows: [{ id: 101, minutes: -11, kind: "spend" }, { id: 201, minutes: 11, kind: "refund", userId: "22222222-2222-4222-8222-222222222202" }] },
  { name: "different match", rows: [{ id: 101, minutes: -11, kind: "spend" }, { id: 201, minutes: 11, kind: "refund", matchId: null }] },
  { name: "different order", rows: [{ id: 101, minutes: -11, kind: "spend", orderId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, { id: 201, minutes: 11, kind: "refund" }] },
  { name: "different purchase", rows: [{ id: 101, minutes: -11, kind: "spend", purchaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, { id: 201, minutes: 11, kind: "refund" }] },
  { name: "missing source job", rows: [{ id: 101, minutes: -11, kind: "spend", jobId: null }, { id: 201, minutes: 11, kind: "refund", jobId: null }] },
  { name: "refund preceding spend", rows: [{ id: 201, minutes: -11, kind: "spend" }, { id: 101, minutes: 11, kind: "refund" }] },
];
for (const { name, rows } of ambiguous) {
  test(`migration stops explicitly on an ambiguous historical refund: ${name}`, { skip: !enabled }, () => {
    assert.throws(() => sql(`${fixture(rows)} ${backfill}`), error => {
      assert.match(String((error as { stderr: string }).stderr), /cannot backfill processing refund .*no exact unreversed spend/i);
      return true;
    });
  });
}
