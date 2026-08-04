import { NextResponse } from "next/server";

import { sendReviewEmail } from "@/lib/email/reviewEmails";
import { refundOrder } from "@/lib/payments/orderMoney";
import { mapRpcError } from "@/lib/reviews/rpcError";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/admin/review-refund — { orderId }. Admin-only unwind for a
 * stuck or disputed order: admin_cancel_review_order (is_admin re-checked
 * in the function itself) then the standard idempotent refund.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ code: "not_signed_in" }, { status: 401 });
  }

  let body: { orderId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "invalid_json" }, { status: 400 });
  }
  const orderId = body.orderId ?? "";
  if (!UUID_RE.test(orderId)) {
    return NextResponse.json({ code: "invalid_order" }, { status: 400 });
  }

  const { error } = await supabase.rpc("admin_cancel_review_order", {
    p_order_id: orderId,
    p_reason: "refunded from admin",
  });
  if (error) {
    const { code, status } = mapRpcError(error);
    return NextResponse.json({ code }, { status });
  }

  try {
    await refundOrder(orderId);
    await sendReviewEmail("order_refunded", orderId);
  } catch (e) {
    console.error("admin review-refund money step:", e);
  }
  return NextResponse.json({ ok: true });
}
