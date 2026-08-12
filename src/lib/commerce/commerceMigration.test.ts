/**
 * Migration contract test for 096 (the usage-based commercial model), in
 * the style of reviewsMigration.test.ts: assert the SQL carries the DDL
 * the app depends on, so a hand-edit that drops a piece fails fast here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/096_commerce.sql"),
  "utf8",
);

test("all five commerce tables exist", () => {
  for (const t of [
    "processing_ledger",
    "storage_entitlements",
    "platform_purchases",
    "sponsored_credit_ledger",
    "sponsored_invites",
  ]) {
    assert.ok(sql.includes(`create table public.${t}`), t);
  }
});

test("matches learns the uploaded state and its raw source", () => {
  assert.ok(sql.includes("add column raw_path"));
  assert.ok(sql.includes("add column duration_s"));
  assert.ok(
    sql.includes("check (status in ('uploaded', 'processing', 'ready', 'failed'))"),
  );
});

test("clients never write money tables directly", () => {
  for (const t of [
    "processing_ledger",
    "storage_entitlements",
    "platform_purchases",
    "sponsored_credit_ledger",
  ]) {
    assert.ok(
      sql.includes(`revoke insert, update, delete on public.${t} from authenticated`),
      t,
    );
  }
});

test("lifecycle RPCs exist", () => {
  for (const fn of [
    "register_upload",
    "set_match_duration",
    "my_processing_state",
    "claim_processing",
    "refund_processing_spend",
    "create_platform_purchase",
    "fulfill_platform_purchase",
    "mint_sponsored_invite",
    "sponsored_invite_info",
    "claim_sponsored_invite",
    "admin_grant_minutes",
    "admin_grant_storage",
    "admin_grant_sponsored",
  ]) {
    assert.ok(
      sql.includes(`create or replace function public.${fn}(`) ||
        sql.includes(`create function public.${fn}(`),
      fn,
    );
  }
});

test("worker and webhook RPCs demand the service role", () => {
  // The 086 lesson: a guard that cannot fire is not a guard. Both
  // money-writing entry points check auth.role() explicitly.
  const refund = sql.slice(sql.indexOf("refund_processing_spend"));
  assert.ok(refund.includes("service_role"));
  const fulfill = sql.slice(sql.indexOf("fulfill_platform_purchase"));
  assert.ok(fulfill.includes("service_role"));
});

test("the charge is whole minutes, rounded up, minimum one", () => {
  assert.ok(sql.includes("greatest(1, ceil((v_end - v_start) / 60.0))"));
});

test("storage counts raw and cut only, minus active-order holds", () => {
  assert.ok(sql.includes("l.r2_key like 'r2://ponglens-raw/%' or l.kind = 'cut'"));
  assert.ok(sql.includes("join public.review_orders o on o.id = l.order_id"));
});

test("orders carry their funding; sponsored exits refund the credit", () => {
  assert.ok(sql.includes("check (funding in ('player_paid', 'sponsored'))"));
  assert.ok(sql.includes("create trigger review_orders_sponsored_refund"));
});

test("every money row is stamped with its billing mode", () => {
  const stamps = sql.match(/billing_mode\s+text not null default 'live'/g);
  assert.ok((stamps?.length ?? 0) >= 4, "billing_mode columns present");
});

test("kill switch and launch values are seeded", () => {
  assert.ok(sql.includes("('commerce_enabled', 'false')"));
  assert.ok(sql.includes("('free_processing_minutes', '250')"));
  assert.ok(sql.includes("('review_included_minutes', '45')"));
  assert.ok(sql.includes("('sponsored_free_credits', '3')"));
  for (const key of ["minute_packs", "storage_packs", "sponsored_packs"]) {
    assert.ok(sql.includes(`('${key}',`), key);
  }
});

test("the QA wall guards the sponsored claim", () => {
  assert.ok(sql.includes("(v_mode = 'test') <> public.is_qa(v_inv.coach_id)"));
});

// 097: the content gate moves to upload time.
const sql097 = readFileSync(
  join(process.cwd(), "supabase/migrations/097_content_check.sql"),
  "utf8",
);

test("uploads enqueue a content check and remember a pass", () => {
  assert.ok(sql097.includes("add column content_checked_at"));
  assert.ok(sql097.includes("'content_check', 'queued'"));
});

test("check jobs never block the queue", () => {
  const exclusions = sql097.match(
    /kind not in \('reclip', 'content_check'\)/g,
  );
  assert.ok((exclusions?.length ?? 0) >= 2, "both queue counts exclude them");
});
