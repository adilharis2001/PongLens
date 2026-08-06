import "server-only";
import Stripe from "stripe";

import type {
  AccountStatus,
  CheckoutParams,
  CheckoutResult,
  PaymentGateway,
} from "./gateway";

/**
 * Real Stripe. Direct charges on the coach's Express account:
 *
 *  - accounts are created with the Express dashboard, fees paid by the
 *    account, losses on the application (the only configuration Stripe
 *    allows for Express), and a MANUAL payout schedule — funds wait in the
 *    coach's balance until releasePayout.
 *  - checkout sessions are created ON the connected account
 *    (stripeAccount header) with application_fee_amount, so the student
 *    visibly pays the coach and our fee peels off at charge time.
 *  - webhooks for direct charges arrive on the CONNECT endpoint with
 *    event.account set; the webhook route passes them back to orderMoney.
 */

let cached: Stripe | null = null;

function stripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing env var STRIPE_SECRET_KEY");
  cached = new Stripe(key);
  return cached;
}

export const stripeGateway: PaymentGateway = {
  async createConnectAccount(email, storefrontUrl) {
    const account = await stripe().accounts.create({
      country: "US",
      email: email ?? undefined,
      // A coach is a person, not a company. Prefilling this (plus the
      // storefront as their business site and an education MCC) makes
      // Stripe's onboarding skip "legal business name" and the rest of
      // the company questionnaire — they answer personal questions only.
      business_type: "individual",
      business_profile: {
        url: storefrontUrl,
        mcc: "8299",
        product_description: "Table tennis match review coaching",
      },
      controller: {
        stripe_dashboard: { type: "express" },
        // Stripe requires the platform to collect fees when the account
        // gets the Express dashboard: card processing comes out of OUR
        // application fee, and the coach keeps exactly price minus the
        // platform fee. (fees.payer "account" + express is rejected.)
        fees: { payer: "application" },
        losses: { payments: "application" },
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      settings: {
        payouts: { schedule: { interval: "manual" } },
      },
    });
    return account.id;
  },

  async createOnboardingLink(accountId, returnUrl, refreshUrl) {
    const link = await stripe().accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });
    return link.url;
  },

  async createDashboardLink(accountId) {
    const link = await stripe().accounts.createLoginLink(accountId);
    return link.url;
  },

  async getAccountStatus(accountId): Promise<AccountStatus> {
    const account = await stripe().accounts.retrieve(accountId);
    return {
      chargesEnabled: Boolean(account.charges_enabled),
      payoutsEnabled: Boolean(account.payouts_enabled),
    };
  },

  async createCheckout(params: CheckoutParams): Promise<CheckoutResult> {
    const session = await stripe().checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: params.orderId,
        customer_email: params.studentEmail ?? undefined,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: params.priceCents,
              product_data: { name: params.title },
            },
          },
        ],
        payment_intent_data: {
          application_fee_amount: params.feeCents,
        },
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
      },
      { stripeAccount: params.accountId },
    );
    if (!session.url) throw new Error("Stripe returned no checkout URL");
    return { url: session.url, sessionId: session.id };
  },

  async refundPayment(accountId, paymentIntentId, idempotencyKey) {
    const refund = await stripe().refunds.create(
      {
        payment_intent: paymentIntentId,
        refund_application_fee: true,
      },
      { stripeAccount: accountId, idempotencyKey },
    );
    return refund.id;
  },

  async releasePayout(accountId, chargeId, idempotencyKey) {
    const charge = await stripe().charges.retrieve(
      chargeId,
      { expand: ["balance_transaction"] },
      { stripeAccount: accountId },
    );
    const txn = charge.balance_transaction;
    const net =
      txn && typeof txn === "object" && typeof txn.net === "number"
        ? txn.net
        : 0;
    if (net <= 0) return null;
    const payout = await stripe().payouts.create(
      { amount: net, currency: "usd" },
      { stripeAccount: accountId, idempotencyKey },
    );
    return payout.id;
  },

  async chargeIdFromIntent(accountId, paymentIntentId) {
    const intent = await stripe().paymentIntents.retrieve(
      paymentIntentId,
      { expand: ["latest_charge"] },
      { stripeAccount: accountId },
    );
    return typeof intent.latest_charge === "string"
      ? intent.latest_charge
      : (intent.latest_charge?.id ?? null);
  },
};
