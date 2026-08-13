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

/**
 * A purchase from PongLens itself (minute packs, storage, sponsored
 * packs) — the platform's own Stripe account, never a connected one.
 */
export interface PlatformCheckoutParams {
  purchaseId: string;
  amountCents: number;
  title: string;
  userEmail: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface PayoutResult {
  payoutId: string;
  /**
   * The fee Stripe took to send the payout, in cents — ours to pay under
   * fees.payer='application'. Null when the balance transaction wasn't
   * available, which means "not known", never "free": the caller meters
   * nothing rather than recording a zero.
   */
  feeCents: number | null;
}

export interface PaymentGateway {
  /**
   * Create the coach's connected account; returns the account id.
   *
   * storefrontUrl prefills Stripe's business questions so a coach only
   * answers personal ones (name, address, bank) during onboarding.
   *
   * country is required and permanent: Stripe fixes it at creation and
   * offers no way to change it afterwards, so the caller must have asked
   * the coach rather than assuming. It used to be hardcoded to "US", which
   * is why only American coaches could ever be onboarded.
   */
  createConnectAccount(
    email: string | null,
    country: string,
    storefrontUrl?: string,
  ): Promise<string>;
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
   * Checkout on the platform's own account (096 commerce purchases).
   * Fulfillment rides the platform webhook, keyed by the purchase id in
   * the session metadata.
   */
  createPlatformCheckout(
    params: PlatformCheckoutParams,
  ): Promise<CheckoutResult>;
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
   * Returns the payout, or null when there is nothing to pay out.
   */
  releasePayout(
    accountId: string,
    chargeId: string,
    idempotencyKey: string,
  ): Promise<PayoutResult | null>;
  /** The settled charge behind a payment intent, for backfills. */
  chargeIdFromIntent(
    accountId: string,
    paymentIntentId: string,
  ): Promise<string | null>;
}

/**
 * Which economy an operation belongs to (092). Stamped on money-bearing
 * rows at creation and never derived later; a row's counterparties always
 * share its mode. 'test' routes through fakeGateway, so a QA account can
 * walk every purchase, refund and payout in production without a cent of
 * real money moving.
 */
export type BillingMode = "live" | "test";

export function paymentsFake(): boolean {
  return process.env.STRIPE_FAKE === "1";
}

/**
 * The only door to a payment gateway, and it demands to know which
 * economy you're in. Callers acting on an order pass the order's stamped
 * billing_mode; callers acting for a user (onboarding) pass the caller's
 * current_billing_mode(). STRIPE_FAKE=1 (keyless local dev) forces fake
 * regardless.
 */
export async function getGateway(mode: BillingMode): Promise<PaymentGateway> {
  if (paymentsFake() || mode === "test") {
    const { fakeGateway } = await import("./fakeGateway");
    return fakeGateway;
  }
  const { stripeGateway } = await import("./stripeGateway");
  return stripeGateway;
}
