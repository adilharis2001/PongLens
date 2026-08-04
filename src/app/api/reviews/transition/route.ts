import { NextResponse } from "next/server";

import {
  refundOrder,
  releasePayoutForOrder,
  releasePendingPayouts,
} from "@/lib/payments/orderMoney";
import { mapRpcError } from "@/lib/reviews/rpcError";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/reviews/transition — order transitions with money attached.
 *
 * Pure state changes (accept, clarify, deliver, follow-ups, drafts) go
 * straight to their RPCs from the client. The transitions here also move
 * money, so the RPC and the gateway call belong in one place:
 *
 *   { orderId, action: "decline", message? }   coach declines -> refund
 *   { orderId, action: "cancel", message? }    student cancels -> refund
 *   { orderId, action: "coach_cancel", message? }             -> refund
 *   { orderId, action: "complete" }            student accepts -> payout
 *   { action: "sweep" }                        lazy sweep: quiet delivered
 *                                              orders auto-complete, then
 *                                              this coach's unpaid
 *                                              completions release
 *
 * The state change commits first; if the gateway call then fails, the
 * money step is retried on the next sweep (refunds/payouts are idempotent
 * via the recorded ids), and the order is never left in a lying state.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTIONS = new Set([
  "decline",
  "cancel",
  "coach_cancel",
  "complete",
  "sweep",
]);

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ code: "not_signed_in" }, { status: 401 });
  }

  let body: { orderId?: string; action?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "invalid_json" }, { status: 400 });
  }
  const action = body.action ?? "";
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ code: "invalid_action" }, { status: 400 });
  }

  if (action === "sweep") {
    const { error } = await supabase.rpc("sweep_review_orders");
    if (error) {
      const { code, status } = mapRpcError(error);
      return NextResponse.json({ code }, { status });
    }
    await releasePendingPayouts(user.id);
    return NextResponse.json({ ok: true });
  }

  const orderId = body.orderId ?? "";
  if (!UUID_RE.test(orderId)) {
    return NextResponse.json({ code: "invalid_order" }, { status: 400 });
  }
  const message =
    typeof body.message === "string" ? body.message.slice(0, 500) : "";

  const rpc =
    action === "decline"
      ? supabase.rpc("decline_review_order", {
          p_order_id: orderId,
          p_message: message,
        })
      : action === "cancel"
        ? supabase.rpc("cancel_review_order", {
            p_order_id: orderId,
            p_reason: message,
          })
        : action === "coach_cancel"
          ? supabase.rpc("coach_cancel_review_order", {
              p_order_id: orderId,
              p_reason: message,
            })
          : supabase.rpc("complete_review_order", { p_order_id: orderId });

  const { error } = await rpc;
  if (error) {
    const { code, status } = mapRpcError(error);
    return NextResponse.json({ code }, { status });
  }

  try {
    if (action === "complete") {
      await releasePayoutForOrder(orderId);
    } else {
      await refundOrder(orderId);
    }
  } catch (e) {
    // State is committed; money retries on the next sweep.
    console.error(`transition ${action} money step:`, e);
  }
  return NextResponse.json({ ok: true });
}
