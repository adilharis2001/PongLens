/**
 * Migration contract test for 073 (paid coach reviews), in the style of
 * placementRetryMigration.test.ts: assert the SQL file carries the DDL the
 * app depends on, so a hand-edit that drops a piece fails fast here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/073_coach_reviews.sql"),
  "utf8",
);

test("all nine tables exist", () => {
  for (const t of [
    "coach_profiles",
    "offerings",
    "review_orders",
    "review_documents",
    "review_findings",
    "review_finding_points",
    "review_attachments",
    "review_messages",
    "stripe_events",
  ]) {
    assert.ok(sql.includes(`create table public.${t}`), t);
  }
});

test("order status vocabulary matches the app", () => {
  for (const s of [
    "'awaiting_payment'",
    "'awaiting_submission'",
    "'submitted'",
    "'in_review'",
    "'clarification'",
    "'delivered'",
    "'completed'",
    "'declined'",
    "'cancelled'",
  ]) {
    assert.ok(
      sql.includes(s),
      `status ${s} missing from review_orders_status_check`,
    );
  }
});

test("clients never write orders or money columns directly", () => {
  assert.ok(
    sql.includes(
      "revoke insert, update, delete on public.review_orders" +
        " from authenticated",
    ),
  );
  assert.ok(sql.includes("revoke all on public.stripe_events"));
  // Stripe columns are excluded from the coach_profiles update grant.
  const grant = sql.match(
    /grant update \(([^)]+)\)\s+on public\.coach_profiles/,
  );
  assert.ok(grant, "coach_profiles column grant present");
  assert.ok(!grant![1].includes("stripe_account_id"));
  assert.ok(!grant![1].includes("charges_enabled"));
  assert.ok(!grant![1].includes("payouts_enabled"));
});

test("lifecycle RPCs exist", () => {
  for (const fn of [
    "create_review_order",
    "submit_review_order",
    "accept_review_order",
    "decline_review_order",
    "request_review_clarification",
    "reply_review_clarification",
    "save_review_document",
    "deliver_review",
    "complete_review_order",
    "sweep_review_orders",
    "cancel_review_order",
    "coach_cancel_review_order",
    "add_review_followup",
    "coach_page",
    "coach_queue",
    "student_review_orders",
    "review_order_detail",
    "review_fee_for",
  ]) {
    assert.ok(
      sql.includes(`create or replace function public.${fn}(`) ||
        sql.includes(`create or replace function public.${fn}\n`),
      fn,
    );
  }
});

test("match access gains the order arm and completed-review clips", () => {
  assert.ok(sql.includes("create or replace function public.has_match_access"));
  assert.ok(sql.includes("point_in_completed_review"));
  assert.ok(
    sql.includes(`o.status in ('submitted', 'in_review',
                             'clarification', 'delivered')`) ||
      sql.includes("'submitted', 'in_review'"),
  );
});

test("kill switch and fee config are seeded off/default", () => {
  assert.ok(sql.includes("('coach_reviews_enabled', 'false')"));
  assert.ok(sql.includes("('review_fee_mode', 'percent')"));
  assert.ok(sql.includes("('review_fee_percent', '15')"));
  assert.ok(sql.includes("('review_fee_fixed_cents', '500')"));
});

test("app_access learns the order source", () => {
  assert.ok(sql.includes("'founder', 'invite', 'coach', 'admin', 'order'"));
});

test("bell kinds cover the whole lifecycle", () => {
  for (const k of [
    "'order_paid'",
    "'order_submitted'",
    "'order_accepted'",
    "'order_declined'",
    "'clarification_requested'",
    "'review_delivered'",
    "'followup_received'",
    "'order_completed'",
    "'order_refunded'",
  ]) {
    assert.ok(sql.includes(k), k);
  }
});
