import { NextResponse } from "next/server";

import { verifyAppleNotification } from "@/lib/payments/applePurchases";
import { refundApplePurchase } from "@/lib/payments/platformMoney";

export const runtime = "nodejs";

/**
 * POST /api/webhooks/apple — App Store Server Notifications V2.
 *
 * Apple refunds a customer on its own authority and tells us afterwards.
 * Nothing in our app or on our servers is consulted first, so without
 * this endpoint a refunded person keeps their minutes and we would never
 * know. That is the whole reason it exists.
 *
 * There is no shared secret here and none is needed: the entire body is
 * a JWS signed by Apple, so verifying the signature IS the
 * authentication. An unsigned or wrongly-signed post is refused before
 * anything is read out of it.
 *
 * Configure the URL in App Store Connect under the app's General ->
 * App Information -> App Store Server Notifications, for BOTH the
 * production and sandbox URLs.
 */

export async function POST(req: Request) {
  let body: { signedPayload?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "invalid_input" }, { status: 400 });
  }
  const signedPayload =
    typeof body.signedPayload === "string" ? body.signedPayload : "";
  if (!signedPayload) {
    return NextResponse.json({ code: "invalid_input" }, { status: 400 });
  }

  const notification = await verifyAppleNotification(signedPayload);
  if (!notification) {
    // Not signed by Apple, or not for this app. 400 rather than 200 so a
    // misconfiguration is visible in Apple's delivery history instead of
    // being silently swallowed.
    return NextResponse.json({ code: "not_verified" }, { status: 400 });
  }

  const { notificationType, transactionId } = notification;

  // REFUND is the one that moves money back. The others (subscription
  // lifecycle, price consent, and so on) do not apply to consumables, so
  // they are acknowledged and ignored rather than treated as errors —
  // Apple retries anything it does not get a 200 for.
  if (notificationType === "REFUND" && transactionId) {
    try {
      const reversed = await refundApplePurchase(transactionId);
      if (!reversed) {
        // Already refunded, or a transaction we never granted. Normal on
        // redelivery; logged because the second case would be odd.
        console.log(`apple refund: nothing to reverse for ${transactionId}`);
      }
    } catch (e) {
      // 500 so Apple redelivers. The reversal is idempotent, so a retry
      // after a partial failure is safe.
      console.error("apple refund handling failed:", e);
      return NextResponse.json({ code: "refund_failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
