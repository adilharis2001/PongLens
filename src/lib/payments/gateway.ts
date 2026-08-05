import "server-only";

/**
 * The one place that knows how money moves.
 *
 * Charge pattern (see the design doc): DIRECT charges on the coach's
 * Express-dashboard connected account with an application fee, and manual
 * payouts so the coach's funds sit in their held balance until the order
 * completes. The coach is the settlement merchant; refunds and disputes
 * debit the coach's balance, and pre-completion refunds are always covered
 * because nothing has paid out yet.
 *
 * Everything outside this module talks to the PaymentGateway interface, so
 * switching charge patterns later is contained here.
 *
 * Two implementations:
 *   stripeGateway  — real. Needs STRIPE_SECRET_KEY (+ STRIPE_WEBHOOK_SECRET
 *                    for the webhook route).
 *   fakeGateway    — STRIPE_FAKE=1. Keyless local mode: onboarding
 *                    "succeeds" instantly and checkout is a plain page whose
 *                    Pay button runs the same paid-handling code the real
 *                    webhook runs. Never enable in production.
 */

export interface AccountStatus {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}

export interface CheckoutParams {
  orderId: string;
  /** The coach's connected account. */
  accountId: string;
  priceCents: number;
  feeCents: number;
  title: string;
  studentEmail: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  url: string;
  sessionId: string;
}

export interface PaymentGateway {
  /** Create the coach's connected account; returns the account id. */
  createConnectAccount(email: string | null): Promise<string>;
  /** Stripe-hosted onboarding (or the fake equivalent). */
  createOnboardingLink(
    accountId: string,
    returnUrl: string,
    refreshUrl: string,
  ): Promise<string>;
  getAccountStatus(accountId: string): Promise<AccountStatus>;
  /**
   * A one-time login link into the coach's Express dashboard (payouts,
   * bank details). Null when the mode has no dashboard (fake).
   */
  createDashboardLink(accountId: string): Promise<string | null>;
  createCheckout(params: CheckoutParams): Promise<CheckoutResult>;
  /**
   * Full refund of the order's payment, application fee included, so the
   * coach's held balance always covers it. The idempotency key collapses
   * racing or retried calls into one refund.
   */
  refundPayment(
    accountId: string,
    paymentIntentId: string,
    idempotencyKey: string,
  ): Promise<string>;
  /**
   * Release the order's net proceeds from the coach's held balance.
   * Returns the payout id, or null when there is nothing to pay out.
   */
  releasePayout(
    accountId: string,
    chargeId: string,
    idempotencyKey: string,
  ): Promise<string | null>;
  /** The settled charge behind a payment intent, for backfills. */
  chargeIdFromIntent(
    accountId: string,
    paymentIntentId: string,
  ): Promise<string | null>;
}

export function paymentsFake(): boolean {
  return process.env.STRIPE_FAKE === "1";
}

export async function getGateway(): Promise<PaymentGateway> {
  if (paymentsFake()) {
    const { fakeGateway } = await import("./fakeGateway");
    return fakeGateway;
  }
  const { stripeGateway } = await import("./stripeGateway");
  return stripeGateway;
}
