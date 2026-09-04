import { NextResponse } from "next/server";

import { sendPendingSubmitEmails } from "@/lib/email/reviewEmails";
import { sendPendingIosBetaEmails } from "@/lib/email/iosBetaEmails";
import { releasePayoutForOrder } from "@/lib/payments/orderMoney";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/reviews-sweep — Vercel cron (see vercel.json), daily — the Hobby plan allows no more, and a 7-day window hardly needs more.
 *
 * The scheduled twin of the lazy page-load sweep: quiet delivered orders
 * auto-complete after seven days (the status update fires the normal
 * notification trigger), and any completed order still waiting on a
 * payout gets one more release attempt. Guarded by CRON_SECRET, which
 * Vercel sends as a bearer token.
 */

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ code: "not_allowed" }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const { data: swept, error } = await admin
    .from("review_orders")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("status", "delivered")
    .lt("delivered_at", cutoff)
    .select("id");
  if (error) {
    console.error("reviews-sweep:", error);
    return NextResponse.json({ code: "sweep_failed" }, { status: 500 });
  }

  const { data: unpaid } = await admin
    .from("review_orders")
    .select("id")
    .eq("status", "completed")
    .is("stripe_payout_id", null)
    .limit(50);

  for (const row of [...(swept ?? []), ...(unpaid ?? [])]) {
    await releasePayoutForOrder(row.id);
  }

  await sendPendingSubmitEmails();
  await sendPendingIosBetaEmails();

  return NextResponse.json({
    swept: swept?.length ?? 0,
    payout_attempts: unpaid?.length ?? 0,
  });
}
