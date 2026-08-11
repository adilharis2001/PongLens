import { handleStripeWebhook } from "@/lib/payments/stripeWebhook";

export const runtime = "nodejs";

/**
 * POST /api/stripe/webhook — the Connect event endpoint. The whole
 * handler lives in lib/payments/stripeWebhook.ts so payment code (and the
 * stripe import) stays behind that one seam; this file only binds it to
 * the URL Stripe was given.
 */
export async function POST(req: Request) {
  return handleStripeWebhook(req);
}
