import "server-only";
import Stripe from "stripe";

import { recordUsage } from "@/lib/costs/meter";
import {
  feeCentsFromBalanceTransaction,
  stripeChargeFeeEvent,
} from "@/lib/costs/stripeFees";
import { paymentsFake } from "./gateway";
import {
  hasStripeEvent,
  markOrderPaid,
  recordStripeEvent,
  syncAccountStatus,
} from "./orderMoney";

/**
 * The Connect webhook handler, whole. It lives here rather than in the
 * route so that src/lib/payments is the only module that imports the
 * stripe package at all — the seam future payment surfaces (subscriptions,
 * processing minutes) must also pass through. The route is one line.
 *
 * Direct charges live on connected accounts, so events arrive with
 * event.account set. Signature is verified against STRIPE_WEBHOOK_SECRET,
 * then each event id passes through stripe_events exactly once.
 *
 * Handled:
 *   checkout.session.completed  -> order paid, refs recorded
 *   account.updated             -> coach capability flags mirrored
 *   charge.dispute.created      -> logged; the event row is the paper trail
 *
 * Always 200 after a verified event (Stripe retries anything else); 400
 * only for a bad signature or body. Test orders never appear here — their
 * sessions are cs_fake_ ids Stripe has never heard of, and markOrderPaid
 * is told to claim live rows only.
 */
export async function handleStripeWebhook(req: Request): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  if (paymentsFake()) {
    return json({ code: "not_here" }, 404);
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!secret || !key) {
    console.error("webhook: STRIPE env vars missing");
    return json({ code: "not_configured" }, 500);
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return json({ code: "bad_signature" }, 400);
  }

  const stripe = new Stripe(key);
  let event: Stripe.Event;
  try {
    const raw = await req.text();
    event = await stripe.webhooks.constructEventAsync(raw, signature, secret);
  } catch (e) {
    console.error("webhook signature verification failed:", e);
    return json({ code: "bad_signature" }, 400);
  }

  // Dedupe check first; the event is RECORDED only after its handler
  // succeeds, so a mid-handler failure 500s and Stripe's retry gets a
  // real second try. Handlers are status-guarded, so the rare concurrent
  // double-delivery is benign.
  if (await hasStripeEvent(event.id)) {
    return json({ received: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        // Delayed-notification methods (ACH and friends) complete the
        // session before the money is real; ignore anything not "paid".
        if (session.payment_status !== "paid") break;
        const intentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent?.id ?? null);

        // The charge id makes payout release cheap later; best-effort now.
        // The same retrieve also carries the balance transaction, which is
        // where Stripe states the exact processing fee it took — expanding
        // it here costs no extra round trip and is the only moment the
        // number is handed to us without asking.
        let chargeId: string | null = null;
        let chargeFeeCents: number | null = null;
        if (intentId && event.account) {
          try {
            const intent = await stripe.paymentIntents.retrieve(
              intentId,
              { expand: ["latest_charge.balance_transaction"] },
              { stripeAccount: event.account },
            );
            const charge = intent.latest_charge;
            if (typeof charge === "string") {
              chargeId = charge;
            } else if (charge) {
              chargeId = charge.id;
              chargeFeeCents = feeCentsFromBalanceTransaction(
                charge.balance_transaction,
              );
            }
          } catch (e) {
            console.error("webhook: charge lookup failed:", e);
          }
        }
        // Direct charges with fees.payer='application' mean this fee is
        // ours, not the coach's. Metering never blocks the webhook —
        // recordUsage swallows its own failures, and losing a fee row is
        // cheaper than making Stripe redeliver a payment.
        if (chargeId && chargeFeeCents !== null) {
          await recordUsage(
            [
              stripeChargeFeeEvent({
                chargeId,
                feeCents: chargeFeeCents,
              }),
            ].filter((e) => e !== null),
          );
        }
        await markOrderPaid({
          sessionId: session.id,
          paymentIntentId: intentId,
          chargeId,
          mode: "live",
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
    console.error(`webhook handling ${event.type}:`, e);
    // Unclaimed on purpose: a 500 asks Stripe to redeliver.
    return json({ code: "handler_failed" }, 500);
  }
  await recordStripeEvent(event.id, event.type);
  return json({ received: true });
}
