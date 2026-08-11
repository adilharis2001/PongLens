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
  return data === true;
}
