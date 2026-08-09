import assert from "node:assert/strict";
import test from "node:test";

import {
  CONNECT_ACTIVE_ACCOUNT_FEE_CENTS,
  billingMonthKey,
  feeCentsFromBalanceTransaction,
  stripeChargeFeeEvent,
  stripeConnectAccountFeeEvent,
  stripePayoutFeeEvent,
} from "./stripeFees.ts";

test("a charge fee records the cents Stripe reported", () => {
  const event = stripeChargeFeeEvent({
    chargeId: "ch_123",
    feeCents: 175,
  });
  assert.ok(event);
  assert.equal(event.provider, "Stripe");
  assert.equal(event.service, "Payments");
  assert.equal(event.sku, "stripe-fee");
  assert.equal(event.unit, "usd_cent");
  assert.equal(event.quantity, 175);
  // Stripe computed this, so it is provider truth rather than our arithmetic.
  assert.equal(event.source, "provider");
  assert.equal(event.idempotencyKey, "stripe:charge:ch_123");
});

test("the same charge cannot bill twice", () => {
  const first = stripeChargeFeeEvent({ chargeId: "ch_1", feeCents: 100 });
  const second = stripeChargeFeeEvent({ chargeId: "ch_1", feeCents: 100 });
  assert.equal(first?.idempotencyKey, second?.idempotencyKey);
});

test("a missing or zero fee records nothing rather than a zero", () => {
  assert.equal(stripeChargeFeeEvent({ chargeId: "ch_1", feeCents: 0 }), null);
  assert.equal(
    stripeChargeFeeEvent({ chargeId: "ch_1", feeCents: Number.NaN }),
    null,
  );
  assert.equal(stripeChargeFeeEvent({ chargeId: "", feeCents: 50 }), null);
});

test("payout fees key on the payout", () => {
  const event = stripePayoutFeeEvent({ payoutId: "po_9", feeCents: 37 });
  assert.ok(event);
  assert.equal(event.operation, "coach_payout");
  assert.equal(event.quantity, 37);
  assert.equal(event.idempotencyKey, "stripe:payout:po_9");
});

test("the active-account fee is charged once per account per month", () => {
  const january = stripeConnectAccountFeeEvent({
    accountId: "acct_1",
    monthKey: "2026-01",
  });
  const januaryAgain = stripeConnectAccountFeeEvent({
    accountId: "acct_1",
    monthKey: "2026-01",
  });
  const february = stripeConnectAccountFeeEvent({
    accountId: "acct_1",
    monthKey: "2026-02",
  });
  const otherCoach = stripeConnectAccountFeeEvent({
    accountId: "acct_2",
    monthKey: "2026-01",
  });

  assert.ok(january);
  assert.equal(january.quantity, CONNECT_ACTIVE_ACCOUNT_FEE_CENTS);
  // Stripe's own rule: active means "received a payout this month", however
  // many payouts that took.
  assert.equal(january.idempotencyKey, januaryAgain?.idempotencyKey);
  assert.notEqual(january.idempotencyKey, february?.idempotencyKey);
  assert.notEqual(january.idempotencyKey, otherCoach?.idempotencyKey);
  // A flat published price with no transaction behind it, unlike the other two.
  assert.equal(january.source, "assumed");
});

test("a malformed month is refused rather than mis-keyed", () => {
  for (const monthKey of ["2026-1", "January", "", "2026-01-02"]) {
    assert.equal(
      stripeConnectAccountFeeEvent({ accountId: "acct_1", monthKey }),
      null,
    );
  }
});

test("billingMonthKey is UTC and zero padded", () => {
  assert.equal(billingMonthKey(new Date("2026-01-05T00:00:00Z")), "2026-01");
  assert.equal(billingMonthKey(new Date("2026-12-31T23:59:59Z")), "2026-12");
});

test("an unexpanded balance transaction reads as unknown, not free", () => {
  assert.equal(feeCentsFromBalanceTransaction("txn_123"), null);
  assert.equal(feeCentsFromBalanceTransaction(null), null);
  assert.equal(feeCentsFromBalanceTransaction(undefined), null);
  assert.equal(feeCentsFromBalanceTransaction({}), null);
  assert.equal(feeCentsFromBalanceTransaction({ fee: 175 }), 175);
  assert.equal(feeCentsFromBalanceTransaction({ fee: 0 }), 0);
});
