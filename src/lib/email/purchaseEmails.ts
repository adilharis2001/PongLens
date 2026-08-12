import "server-only";

import { recordUsage, resendEmailEvent } from "@/lib/costs/meter";
import { createAdminClient } from "@/lib/supabase/admin";
import { EMAIL_FROM, EMAIL_REPLY_TO, emailShell } from "./reviewEmails";

const APP_URL = "https://www.ponglens.com";

/**
 * The receipt for a platform purchase (096): minute packs, storage,
 * sponsored packs. One email per purchase, sent from fulfillment —
 * best-effort, so a mail hiccup never blocks the grant or makes Stripe
 * redeliver. The Idempotency-Key keyed on the purchase id means a
 * replayed fulfillment cannot send twice.
 */
export async function sendPurchaseEmail(purchaseId: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const admin = createAdminClient();
  const { data: purchase } = await admin
    .from("platform_purchases")
    .select("id, user_id, kind, title, minutes, bytes, months, credits, amount_cents, billing_mode")
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
  let body: string;
  let cta: string;
  let ctaUrl: string;
  if (purchase.kind === "minute_pack") {
    body = `${purchase.minutes} processing minutes are on your account, ready whenever your next match is. They never expire.`;
    cta = "See your balance";
    ctaUrl = `${APP_URL}/account`;
  } else if (purchase.kind === "storage") {
    const gb = Math.round((purchase.bytes ?? 0) / 1073741824);
    const term =
      purchase.months === 12 ? "the next year" : `${purchase.months} months`;
    body = `${gb} GB of space is on your account for ${term}. Nothing you upload is ever deleted when space runs low — uploads just pause until there is room.`;
    cta = "See your storage";
    ctaUrl = `${APP_URL}/account`;
  } else {
    body = `${purchase.credits} sponsored reviews are ready to use. Pick an offering, create a link, and send it to a student — they pay nothing.`;
    cta = "Cover a review";
    ctaUrl = `${APP_URL}/coaching/sponsored`;
  }

  let subject = `Your PongLens purchase: ${purchase.title}`;
  if (purchase.billing_mode === "test") subject = `[Test] ${subject}`;
  const html = emailShell({
    preheader: `${purchase.title} · ${dollars}`,
    heading: "That's yours now",
    body: `${purchase.title} for ${dollars}. ${body}`,
    cta,
    ctaUrl,
  });

  if (!key) {
    console.log(`purchaseEmails: no RESEND_API_KEY, skipped receipt to ${to}`);
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `purchase-${purchase.id}`,
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        reply_to: EMAIL_REPLY_TO,
        subject,
        html,
      }),
    });
    if (!res.ok) {
      console.error(`purchaseEmails: Resend ${res.status}`);
      return;
    }
    const resBody = (await res.json().catch(() => null)) as {
      id?: string;
    } | null;
    if (resBody?.id) {
      await recordUsage(
        [
          resendEmailEvent({
            messageId: resBody.id,
            operation: "purchase_receipt_email",
          }),
        ].filter((event) => event !== null),
      );
    }
  } catch (e) {
    console.error("purchaseEmails: receipt failed:", e);
  }
}
