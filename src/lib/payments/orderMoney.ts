import "server-only";

import { recordUsage } from "@/lib/costs/meter";
import {
  billingMonthKey,
  stripeConnectAccountFeeEvent,
  stripePayoutFeeEvent,
} from "@/lib/costs/stripeFees";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGateway } from "./gateway";

/**
 * Order-side money bookkeeping. Everything here runs with the service role
 * because it is driven by webhooks (no user session) or must write the
 * server-only payment-ref columns. State transitions themselves stay in
 * the DEFINER RPCs; this module only marks money facts onto orders.
 *
 * Every external money call is guarded twice: an atomic database claim so
 * two racing callers can't both proceed, and a Stripe idempotency key so
 * a lost response can't double-spend on retry.
 */

/** Payment landed for a checkout session -> the order can start. */
export async function markOrderPaid(opts: {
  sessionId: string;
  paymentIntentId?: string | null;
  chargeId?: string | null;
}): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("review_orders")
    .update({
      status: "awaiting_submission",
      paid_at: new Date().toISOString(),
      stripe_payment_intent_id: opts.paymentIntentId ?? null,
      stripe_charge_id: opts.chargeId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_checkout_session_id", opts.sessionId)
    .eq("status", "awaiting_payment")
    .select("id, student_id")
    .maybeSingle();
  if (error) {
    // Transient (pooler blip, timeout): throw so the webhook 500s and
    // Stripe redelivers, instead of consuming the event on a failure.
    console.error("markOrderPaid error:", error);
    throw new Error(`markOrderPaid: ${error.message}`);
  }
  if (!data) {
    // A paid session with no awaiting_payment order is money without a
    // home (cancelled order? replayed event?). Loud, never silent.
    console.error(
      `markOrderPaid: session ${opts.sessionId} paid but no ` +
        `awaiting_payment order matched — needs a manual look`,
    );
    return null;
  }

  // Payment is the one transition with no user request to hang an email
  // on, so the coach's "new order" email sends from here.
  const { sendReviewEmail } = await import("@/lib/email/reviewEmails");
  await sendReviewEmail("order_paid", data.id).catch(() => {});
  return data.id;
}

/**
 * Refund a declined/cancelled order's payment. Reads the refs with the
 * service role, calls the gateway, records the refund id. Idempotent
 * twice over: the recorded id short-circuits repeats, and the Stripe
 * idempotency key collapses racing calls into one refund.
 */
export async function refundOrder(orderId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: order, error } = await admin
    .from("review_orders")
    .select(
      "id, coach_id, stripe_payment_intent_id, stripe_refund_id, paid_at",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error || !order) {
    console.error("refundOrder read error:", error);
    return false;
  }
  if (!order.paid_at) return true; // never charged, nothing to refund
  if (order.stripe_refund_id) return true; // already refunded
  if (!order.stripe_payment_intent_id) {
    console.error(`refundOrder: order ${orderId} paid but has no intent id`);
    return false;
  }

  const accountId = await coachAccountId(order.coach_id);
  if (!accountId) return false;

  const gateway = await getGateway();
  const refundId = await gateway.refundPayment(
    accountId,
    order.stripe_payment_intent_id,
    `refund-${orderId}`,
  );
  const { error: writeError } = await admin
    .from("review_orders")
    .update({ stripe_refund_id: refundId })
    .eq("id", orderId);
  if (writeError) console.error("refundOrder write error:", writeError);
  return true;
}

/** The claim marker while a payout call is in flight. */
const PAYOUT_PENDING = "pending";

/**
 * Release the coach's net proceeds for a completed order — exactly once.
 * The conditional update claims the order before Stripe is touched; a
 * failed call releases the claim so the next sweep retries.
 */
export async function releasePayoutForOrder(orderId: string): Promise<void> {
  const admin = createAdminClient();

  // Atomic claim: only one caller flips NULL -> pending.
  const { data: claimed, error: claimError } = await admin
    .from("review_orders")
    .update({ stripe_payout_id: PAYOUT_PENDING })
    .eq("id", orderId)
    .eq("status", "completed")
    .is("stripe_payout_id", null)
    .select("id, coach_id, stripe_charge_id, stripe_payment_intent_id")
    .maybeSingle();
  if (claimError || !claimed) return; // someone else has it, or not ready

  const releaseClaim = async () => {
    await admin
      .from("review_orders")
      .update({ stripe_payout_id: null })
      .eq("id", orderId)
      .eq("stripe_payout_id", PAYOUT_PENDING);
  };

  const accountId = await coachAccountId(claimed.coach_id);
  if (!accountId) {
    await releaseClaim();
    return;
  }

  try {
    const gateway = await getGateway();

    // The webhook's charge lookup is best-effort; backfill here so a
    // hiccup there can't strand the coach's money forever.
    let chargeId = claimed.stripe_charge_id;
    if (!chargeId && claimed.stripe_payment_intent_id) {
      chargeId = await gateway.chargeIdFromIntent(
        accountId,
        claimed.stripe_payment_intent_id,
      );
      if (chargeId) {
        await admin
          .from("review_orders")
          .update({ stripe_charge_id: chargeId })
          .eq("id", orderId);
      }
    }
    if (!chargeId) {
      await releaseClaim();
      return;
    }

    const payout = await gateway.releasePayout(
      accountId,
      chargeId,
      `payout-${orderId}`,
    );
    if (payout) {
      await admin
        .from("review_orders")
        .update({ stripe_payout_id: payout.payoutId })
        .eq("id", orderId)
        .eq("stripe_payout_id", PAYOUT_PENDING);

      // Both Stripe costs that only a payout can tell us about. Stripe
      // defines a connected account as "active" in any month it receives
      // a payout, and we send every payout, so sending one is the exact
      // moment the $2 becomes owed — keyed on account + month, so the
      // second payout of a month adds nothing.
      //
      // Deliberately after the payout is recorded and outside the claim:
      // the coach's money is the thing that must not go wrong here, and
      // bookkeeping never gets to fail it. recordUsage swallows its own
      // errors on top of that.
      const now = new Date();
      await recordUsage(
        [
          payout.feeCents === null
            ? null
            : stripePayoutFeeEvent({
                payoutId: payout.payoutId,
                feeCents: payout.feeCents,
                occurredAt: now.toISOString(),
              }),
          stripeConnectAccountFeeEvent({
            accountId,
            monthKey: billingMonthKey(now),
            occurredAt: now.toISOString(),
          }),
        ].filter((event) => event !== null),
      );
    } else {
      await releaseClaim();
    }
  } catch (e) {
    // Transient failures (bank not verified yet, network) retry on the
    // next sweep; the idempotency key makes retrying safe even if the
    // payout actually went through.
    console.error(`releasePayoutForOrder ${orderId}:`, e);
    await releaseClaim();
  }
}

/** Completed orders of this coach still waiting on a payout. */
export async function releasePendingPayouts(coachId: string): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("review_orders")
    .select("id")
    .eq("coach_id", coachId)
    .eq("status", "completed")
    .is("stripe_payout_id", null)
    .limit(20);
  if (error || !data) return;
  for (const row of data) {
    await releasePayoutForOrder(row.id);
  }
}

async function coachAccountId(coachId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("coach_profiles")
    .select("stripe_account_id")
    .eq("user_id", coachId)
    .maybeSingle();
  if (error || !data?.stripe_account_id) {
    console.error(`coachAccountId: no account for ${coachId}`, error);
    return null;
  }
  return data.stripe_account_id;
}

/** Has this webhook event already been fully processed? */
export async function hasStripeEvent(eventId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("stripe_events")
    .select("event_id")
    .eq("event_id", eventId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Record an event AFTER its handler succeeded, so a mid-handler failure
 * leaves the event unclaimed and Stripe's retry gets a real second try.
 * Handlers are idempotent (status-guarded updates), so the rare
 * concurrent double-delivery is benign.
 */
export async function recordStripeEvent(
  eventId: string,
  type: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("stripe_events")
    .insert({ event_id: eventId, type });
  if (error && error.code !== "23505") {
    console.error("recordStripeEvent:", error);
  }
}

/** account.updated -> mirror capability flags onto the profile. */
export async function syncAccountStatus(
  accountId: string,
  status: { chargesEnabled: boolean; payoutsEnabled: boolean },
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("coach_profiles")
    .update({
      charges_enabled: status.chargesEnabled,
      payouts_enabled: status.payoutsEnabled,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_account_id", accountId);
  if (error) console.error("syncAccountStatus:", error);
}
