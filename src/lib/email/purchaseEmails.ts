import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { purchaseReceiptEmail } from "./catalog";
import { sendTransactionalEmail } from "./send";

/**
 * The receipt for a platform purchase (096): minute packs, storage,
 * sponsored packs. One email per purchase, sent from fulfillment —
 * best-effort, so a mail hiccup never blocks the grant or makes Stripe
 * redeliver. The Idempotency-Key keyed on the purchase id means a
 * replayed fulfillment cannot send twice.
 */
export async function sendPurchaseEmail(purchaseId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: purchase } = await admin
    .from("platform_purchases")
    .select("id, user_id, kind, title, minutes, bytes, months, credits, amount_cents, billing_mode, paid_at, created_at, stripe_payment_intent_id, apple_transaction_id")
    .eq("id", purchaseId)
    .eq("status", "paid")
    .maybeSingle();
  if (!purchase) return;

  const { data: userRes } = await admin.auth.admin.getUserById(
    purchase.user_id,
  );
  const to = userRes.user?.email;
  if (!to) return;

  const dollars = `$${(purchase.amount_cents / 100)
    .toFixed(2)
    .replace(/\.00$/, "")}`;
  const purchasedAt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "America/New_York",
  }).format(new Date(purchase.paid_at ?? purchase.created_at));
  const paymentReference =
    purchase.stripe_payment_intent_id ?? purchase.apple_transaction_id ?? undefined;
  let message;
  if (purchase.kind === "minute_pack") {
    message = purchaseReceiptEmail({
      kind: "minute_pack",
      title: purchase.title,
      amount: dollars,
      purchaseDate: purchasedAt,
      paymentReference,
      minutes: purchase.minutes ?? 0,
    });
  } else if (purchase.kind === "storage") {
    message = purchaseReceiptEmail({
      kind: "storage",
      title: purchase.title,
      amount: dollars,
      purchaseDate: purchasedAt,
      paymentReference,
      gigabytes: Math.round((purchase.bytes ?? 0) / 1073741824),
      months: purchase.months ?? 0,
    });
  } else {
    message = purchaseReceiptEmail({
      kind: "review_credits",
      title: purchase.title,
      amount: dollars,
      purchaseDate: purchasedAt,
      paymentReference,
      credits: purchase.credits ?? 0,
    });
  }

  if (purchase.billing_mode === "test") {
    message = { ...message, subject: `[Test] ${message.subject}` };
  }
  await sendTransactionalEmail({
    to,
    message,
    idempotencyKey: `purchase-${purchase.id}`,
    operation: "purchase_receipt_email",
  });
}
