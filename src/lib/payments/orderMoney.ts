import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getGateway } from "./gateway";

/**
 * Order-side money bookkeeping. Everything here runs with the service role
 * because it is driven by webhooks (no user session) or must write the
 * server-only payment-ref columns. State transitions themselves stay in
 * the DEFINER RPCs; this module only marks money facts onto orders.
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
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("markOrderPaid error:", error);
    return null;
  }
  if (data?.id) {
    // Payment is the one transition with no user request to hang an email
    // on, so the coach's "new order" email sends from here.
    const { sendReviewEmail } = await import("@/lib/email/reviewEmails");
    await sendReviewEmail("order_paid", data.id).catch(() => {});
  }
  return data?.id ?? null;
}

/**
 * Refund a declined/cancelled order's payment. Reads the refs with the
 * service role, calls the gateway, records the refund id. Idempotent: a
 * second call sees the recorded refund and does nothing.
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
  );
  const { error: writeError } = await admin
    .from("review_orders")
    .update({ stripe_refund_id: refundId })
    .eq("id", orderId);
  if (writeError) console.error("refundOrder write error:", writeError);
  return true;
}

/**
 * Release the coach's net proceeds for a completed order. Idempotent via
 * the recorded payout id. Quietly does nothing until the charge exists.
 */
export async function releasePayoutForOrder(orderId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: order, error } = await admin
    .from("review_orders")
    .select("id, coach_id, status, stripe_charge_id, stripe_payout_id")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !order) return;
  if (order.status !== "completed") return;
  if (order.stripe_payout_id || !order.stripe_charge_id) return;

  const accountId = await coachAccountId(order.coach_id);
  if (!accountId) return;

  const gateway = await getGateway();
  try {
    const payoutId = await gateway.releasePayout(
      accountId,
      order.stripe_charge_id,
    );
    if (payoutId) {
      await admin
        .from("review_orders")
        .update({ stripe_payout_id: payoutId })
        .eq("id", orderId);
    }
  } catch (e) {
    // A payout can fail transiently (e.g. bank not verified yet). The next
    // release pass retries; nothing is lost while funds sit in the balance.
    console.error(`releasePayoutForOrder ${orderId}:`, e);
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
    .not("stripe_charge_id", "is", null)
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

/**
 * Webhook events, exactly once. Returns false when the event was already
 * processed (the caller just 200s).
 */
export async function claimStripeEvent(
  eventId: string,
  type: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("stripe_events")
    .insert({ event_id: eventId, type });
  if (error) {
    // 23505 unique violation = already seen; anything else is real.
    if (error.code !== "23505") console.error("claimStripeEvent:", error);
    return false;
  }
  return true;
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
