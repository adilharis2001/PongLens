import "server-only";
import Stripe from "stripe";

import { recordUsage } from "@/lib/costs/meter";
import {
  feeCentsFromBalanceTransaction,
  stripeChargeFeeEvent,
} from "@/lib/costs/stripeFees";
import { paymentsFake } from "./gateway";
import { hasStripeEvent, recordStripeEvent } from "./orderMoney";
import { fulfillPurchase } from "./platformMoney";

/**
 * The PLATFORM webhook — the account's own events, not Connect ones. A
 * separate endpoint with its own secret (STRIPE_PLATFORM_WEBHOOK_SECRET)
 * because Stripe delivers platform and connected-account events through
 * different endpoint subscriptions. Shares the stripe_events table with
 * the Connect handler: event ids are globally unique, and one paper
 * trail is easier to read than two.
 *
 * Handled: checkout.session.completed -> fulfill the purchase named in
 * the session metadata. Everything else is recorded and ignored.
 */
export async function handlePlatformWebhook(req: Request): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  if (paymentsFake()) {
    return json({ code: "not_here" }, 404);
  }
  const secret = process.env.STRIPE_PLATFORM_WEBHOOK_SECRET;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!secret || !key) {
    console.error("platform webhook: STRIPE env vars missing");
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
    console.error("platform webhook signature verification failed:", e);
    return json({ code: "bad_signature" }, 400);
  }

  if (await hasStripeEvent(event.id)) {
    return json({ received: true });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.payment_status === "paid") {
        const purchaseId =
          session.metadata?.purchase_id ?? session.client_reference_id;
        const intentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent?.id ?? null);

        // The processing fee on platform charges is ours directly; meter
        // it from the balance transaction, best-effort, exactly like the
        // Connect path.
        if (intentId) {
          try {
            const intent = await stripe.paymentIntents.retrieve(intentId, {
              expand: ["latest_charge.balance_transaction"],
            });
            const charge = intent.latest_charge;
            if (charge && typeof charge !== "string") {
              const feeCents = feeCentsFromBalanceTransaction(
                charge.balance_transaction,
              );
              if (feeCents !== null) {
                await recordUsage(
                  [
                    stripeChargeFeeEvent({ chargeId: charge.id, feeCents }),
                  ].filter((e) => e !== null),
                );
              }
            }
          } catch (e) {
            console.error("platform webhook: charge lookup failed:", e);
          }
        }

        if (purchaseId) {
          await fulfillPurchase({
            purchaseId,
            sessionId: session.id,
            paymentIntentId: intentId,
          });
        } else {
          console.error(
            `platform webhook: paid session ${session.id} names no purchase`,
          );
        }
      }
    }
  } catch (e) {
    console.error(`platform webhook handling ${event.type}:`, e);
    // Unclaimed on purpose: a 500 asks Stripe to redeliver.
    return json({ code: "handler_failed" }, 500);
  }
  await recordStripeEvent(event.id, event.type);
  return json({ received: true });
}
