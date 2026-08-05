import "server-only";
import { randomUUID } from "node:crypto";

import type {
  AccountStatus,
  CheckoutParams,
  CheckoutResult,
  PaymentGateway,
} from "./gateway";

/**
 * Keyless local mode (STRIPE_FAKE=1). Onboarding and checkout resolve to
 * internal routes under /api/stripe/fake/* that complete instantly and run
 * the exact same order-side code the real webhook runs, so the whole
 * lifecycle is walkable without a Stripe account. Ids are prefixed so a
 * fake id in a real environment is unmistakable.
 */

export const fakeGateway: PaymentGateway = {
  async createConnectAccount() {
    return `acct_fake_${randomUUID().slice(0, 8)}`;
  },

  async createOnboardingLink(accountId, returnUrl) {
    const q = new URLSearchParams({ account: accountId, return_to: returnUrl });
    return `/api/stripe/fake/onboard?${q.toString()}`;
  },

  async getAccountStatus(): Promise<AccountStatus> {
    // The fake onboard route flips the profile flags itself; anyone asking
    // afterwards hears yes.
    return { chargesEnabled: true, payoutsEnabled: true };
  },

  async createCheckout(params: CheckoutParams): Promise<CheckoutResult> {
    const sessionId = `cs_fake_${randomUUID().slice(0, 8)}`;
    const q = new URLSearchParams({
      order: params.orderId,
      session: sessionId,
      amount: String(params.priceCents),
      title: params.title,
      success: params.successUrl,
      cancel: params.cancelUrl,
    });
    return { url: `/api/stripe/fake/checkout?${q.toString()}`, sessionId };
  },

  async refundPayment() {
    return `re_fake_${randomUUID().slice(0, 8)}`;
  },

  async releasePayout() {
    return `po_fake_${randomUUID().slice(0, 8)}`;
  },

  async chargeIdFromIntent() {
    return `ch_fake_${randomUUID().slice(0, 8)}`;
  },
};
