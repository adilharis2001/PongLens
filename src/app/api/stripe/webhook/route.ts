import { NextResponse } from "next/server";
import Stripe from "stripe";

import { paymentsFake } from "@/lib/payments/gateway";
import {
  claimStripeEvent,
  markOrderPaid,
  syncAccountStatus,
} from "@/lib/payments/orderMoney";

export const runtime = "nodejs";

/**
 * POST /api/stripe/webhook — the Connect event endpoint.
 *
 * Direct charges live on connected accounts, so events arrive here with
 * event.account set. Signature is verified against STRIPE_WEBHOOK_SECRET,
 * then each event id passes through stripe_events exactly once.
 *
 * Handled:
 *   checkout.session.completed  -> order paid, refs recorded
 *   account.updated             -> coach capability flags mirrored
 *   charge.dispute.created      -> logged; the event row is the paper trail
 *
 * Always 200 after a verified event (Stripe retries anything else); 400
 * only for a bad signature or body.
 */

export async function POST(req: Request) {
  if (paymentsFake()) {
    return NextResponse.json({ code: "not_here" }, { status: 404 });
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!secret || !key) {
    console.error("webhook: STRIPE env vars missing");
    return NextResponse.json({ code: "not_configured" }, { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ code: "bad_signature" }, { status: 400 });
  }

  const stripe = new Stripe(key);
  let event: Stripe.Event;
  try {
    const raw = await req.text();
    event = await stripe.webhooks.constructEventAsync(raw, signature, secret);
  } catch (e) {
    console.error("webhook signature verification failed:", e);
    return NextResponse.json({ code: "bad_signature" }, { status: 400 });
  }

  const fresh = await claimStripeEvent(event.id, event.type);
  if (!fresh) return NextResponse.json({ received: true });

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const intentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent?.id ?? null);

        // The charge id makes payout release cheap later; best-effort now.
        let chargeId: string | null = null;
        if (intentId && event.account) {
          try {
            const intent = await stripe.paymentIntents.retrieve(
              intentId,
              { expand: ["latest_charge"] },
              { stripeAccount: event.account },
            );
            chargeId =
              typeof intent.latest_charge === "string"
                ? intent.latest_charge
                : (intent.latest_charge?.id ?? null);
          } catch (e) {
            console.error("webhook: charge lookup failed:", e);
          }
        }
        await markOrderPaid({
          sessionId: session.id,
          paymentIntentId: intentId,
          chargeId,
        });
        break;
      }
      case "account.updated": {
        const account = event.data.object;
        await syncAccountStatus(account.id, {
          chargesEnabled: Boolean(account.charges_enabled),
          payoutsEnabled: Boolean(account.payouts_enabled),
        });
        break;
      }
      case "charge.dispute.created": {
        // Rare by design (students buy from their own coach). Flag the
        // order for /admin/reviews; handling is manual for now.
        const dispute = event.data.object;
        const chargeId =
          typeof dispute.charge === "string"
            ? dispute.charge
            : dispute.charge.id;
        const { createAdminClient } = await import("@/lib/supabase/admin");
        await createAdminClient()
          .from("review_orders")
          .update({ disputed_at: new Date().toISOString() })
          .eq("stripe_charge_id", chargeId);
        console.error(
          `stripe dispute on account ${event.account}: ${dispute.id}`,
        );
        break;
      }
      default:
        break;
    }
  } catch (e) {
    // The event is claimed; failing here would make Stripe retry into the
    // idempotency wall. Log loudly instead.
    console.error(`webhook handling ${event.type}:`, e);
  }
  return NextResponse.json({ received: true });
}
