import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Money-state writes for platform purchases (096). Same posture as
 * orderMoney.ts: service role only, status-guarded, and every caller —
 * the real webhook and the fake checkout route — funnels through the
 * same fulfill so there is exactly one code path that grants.
 */

/** Record the checkout session on a pending purchase. */
export async function stampPurchaseSession(
  purchaseId: string,
  sessionId: string,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("platform_purchases")
    .update({ stripe_checkout_session_id: sessionId })
    .eq("id", purchaseId)
    .eq("status", "pending");
  if (error) {
    console.error("platform purchase session stamp failed:", error);
    throw new Error("session stamp failed");
  }
}

/**
 * Flip pending -> paid and write the grant, atomically, in the database
 * (fulfill_platform_purchase). Returns false when there was nothing to do
 * — already fulfilled, or an unknown id — which is fine on redelivery.
 */
export async function fulfillPurchase(opts: {
  purchaseId: string;
  sessionId: string | null;
  paymentIntentId: string | null;
}): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc(
    "fulfill_platform_purchase",
    {
      p_purchase_id: opts.purchaseId,
      p_session_id: opts.sessionId,
      p_intent_id: opts.paymentIntentId,
    },
  );
  if (error) {
    // Throwing lets the webhook 500 so Stripe redelivers.
    console.error("platform purchase fulfillment failed:", error);
    throw new Error("fulfillment failed");
  }
  if (data === true) {
    // The receipt. Best-effort and after the grant: mail must never make
    // Stripe redeliver a payment, and the Idempotency-Key inside keyed on
    // the purchase id means a replay cannot send twice.
    try {
      const { sendPurchaseEmail } = await import("@/lib/email/purchaseEmails");
      await sendPurchaseEmail(opts.purchaseId);
    } catch (e) {
      console.error("purchase receipt email failed:", e);
    }
  }
  return data === true;
}

/**
 * Grant an Apple in-app purchase. The signature has already been checked
 * by the route; this is the write.
 *
 * Returns false when the purchase was already granted — a retried
 * request, or the app re-presenting a transaction after a crash. That is
 * a normal outcome and callers should treat it as success.
 *
 * No receipt email, on purpose. Apple mails the customer its own receipt
 * for every in-app purchase, and a second one from us for the same money
 * reads like a double charge.
 */
export async function fulfillApplePurchase(opts: {
  purchaseId: string;
  transactionId: string;
}): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc(
    "fulfill_apple_purchase",
    {
      p_purchase_id: opts.purchaseId,
      p_transaction_id: opts.transactionId,
    },
  );
  if (error) {
    // Throwing gives the phone a 500, and the phone must then NOT finish
    // the transaction: StoreKit will re-present it on the next launch and
    // we get another go at granting money that has already been taken.
    console.error("apple purchase fulfillment failed:", error);
    throw new Error("fulfillment failed");
  }
  return data === true;
}

/**
 * Reverse an Apple purchase after Apple refunds it. Idempotent on status,
 * so a redelivered notification is harmless.
 */
export async function refundApplePurchase(
  transactionId: string,
): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc(
    "refund_apple_purchase",
    { p_transaction_id: transactionId },
  );
  if (error) {
    console.error("apple refund failed:", error);
    throw new Error("refund failed");
  }
  return data === true;
}
