import type { UsageEvent } from "./meter.ts";

/**
 * What Stripe costs US, and why any of it is ours to pay.
 *
 * Coach reviews are direct charges on the coach's Express account, and
 * `controller.fees.payer = 'application'` (stripeGateway.ts — Stripe
 * requires that pairing to give a connected account the Express
 * dashboard). So the platform, not the coach, absorbs:
 *
 *   charge   2.9% + 30c per successful card charge, taken out of our
 *            application fee at charge time.
 *   payout   0.25% + 25c each time the coach's balance is released.
 *   account  $2 in any month an account receives a payout ("monthly
 *            active account"). We send every payout, so we know exactly
 *            which accounts were active and when.
 *
 * EVERY number here is reported BY Stripe on a balance transaction, never
 * derived from a percentage we hold. Card rates differ by card type,
 * country and payment method; a hardcoded 2.9% would be wrong the first
 * time somebody pays with an international Amex, and wrong silently. The
 * one exception is the account fee, which is a flat published price with
 * no transaction to read it off — it carries source 'assumed' so the
 * dashboard grades it honestly.
 *
 * A refund does NOT get its own event. Stripe keeps the original
 * processing fee on a refund, so the cost is exactly the one already
 * recorded at charge time — recording it again on refund would double
 * count the same money. (What a refund really costs us is that fee with
 * no revenue behind it any more, which is a revenue question, not a
 * spend one.)
 *
 * Idempotency keys are derived from Stripe's own object ids, so a webhook
 * redelivery or a retried payout sweep cannot bill twice.
 */

/** $2.00, per Stripe Connect pricing. */
export const CONNECT_ACTIVE_ACCOUNT_FEE_CENTS = 200;

function feeEvent(args: {
  operation: string;
  feeCents: number;
  idempotencyKey: string;
  assumed?: boolean;
  occurredAt?: string;
}): UsageEvent | null {
  // Stripe reports fees as integers, but a zero or a missing value means
  // "nothing to record" rather than "free" — leave the meter alone.
  if (!Number.isFinite(args.feeCents) || args.feeCents <= 0) return null;
  return {
    occurredAt: args.occurredAt,
    provider: "Stripe",
    service: "Payments",
    operation: args.operation,
    sku: "stripe-fee",
    quantity: Math.round(args.feeCents),
    unit: "usd_cent",
    source: args.assumed ? "assumed" : "provider",
    idempotencyKey: args.idempotencyKey,
    metadata: { billing_mode: "direct_charge" },
  };
}

/**
 * Card processing on a student's payment, read from the charge's balance
 * transaction. `chargeId` keys the event, so the same charge seen twice
 * (Stripe redelivers freely) records once.
 */
export function stripeChargeFeeEvent(args: {
  chargeId: string;
  feeCents: number;
  occurredAt?: string;
}): UsageEvent | null {
  if (!args.chargeId) return null;
  return feeEvent({
    operation: "review_charge",
    feeCents: args.feeCents,
    idempotencyKey: `stripe:charge:${args.chargeId}`,
    occurredAt: args.occurredAt,
  });
}

/** The fee on releasing a coach's balance, off the payout's own txn. */
export function stripePayoutFeeEvent(args: {
  payoutId: string;
  feeCents: number;
  occurredAt?: string;
}): UsageEvent | null {
  if (!args.payoutId) return null;
  return feeEvent({
    operation: "coach_payout",
    feeCents: args.feeCents,
    idempotencyKey: `stripe:payout:${args.payoutId}`,
    occurredAt: args.occurredAt,
  });
}

/**
 * The monthly active-account fee, charged once per connected account in
 * any month it receives a payout. Keyed on account + month, so the tenth
 * payout of a month adds nothing — which is precisely Stripe's own rule.
 *
 * `monthKey` is the calendar month of the payout in UTC. Stripe bills on
 * its own account-timezone calendar, so a payout in the last hours of a
 * month could in principle land on the other side of Stripe's boundary;
 * at one $2 line item the precision is not worth a timezone lookup, and
 * the event is marked assumed to say so.
 */
export function stripeConnectAccountFeeEvent(args: {
  accountId: string;
  monthKey: string;
  occurredAt?: string;
}): UsageEvent | null {
  if (!args.accountId || !/^\d{4}-\d{2}$/.test(args.monthKey)) return null;
  return feeEvent({
    operation: "connect_active_account",
    feeCents: CONNECT_ACTIVE_ACCOUNT_FEE_CENTS,
    idempotencyKey: `stripe:connect-active:${args.accountId}:${args.monthKey}`,
    assumed: true,
    occurredAt: args.occurredAt,
  });
}

/** UTC year-month of a date, the key shape the account fee expects. */
export function billingMonthKey(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(
    date.getUTCMonth() + 1,
  ).padStart(2, "0")}`;
}

/**
 * Pull the fee off whatever Stripe handed back. `balance_transaction` is
 * an id string when unexpanded and an object when expanded, and we only
 * ever want the expanded case — returns null rather than guessing.
 */
export function feeCentsFromBalanceTransaction(
  balanceTransaction: unknown,
): number | null {
  if (
    balanceTransaction == null ||
    typeof balanceTransaction !== "object"
  ) {
    return null;
  }
  const fee = (balanceTransaction as { fee?: unknown }).fee;
  return typeof fee === "number" && Number.isFinite(fee) ? fee : null;
}
