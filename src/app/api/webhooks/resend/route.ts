import { handleResendWebhook } from "@/lib/email/resendWebhook";

export const runtime = "nodejs";

/**
 * POST /api/webhooks/resend — delivery receipts, bounces and complaints. The whole
 * handler lives in lib/email/resendWebhook.ts; this file only binds it to
 * the URL Resend was given.
 */
export async function POST(req: Request) {
  return handleResendWebhook(req);
}
