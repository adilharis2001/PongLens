import { NextResponse } from "next/server";

import {
  sendPendingSubmitEmails,
  sendReviewEmail,
} from "@/lib/email/reviewEmails";
import { deliveryBlocker } from "@/lib/reviews/deliveryGate";
import {
  refundOrder,
  releasePayoutForOrder,
  releasePendingPayouts,
} from "@/lib/payments/orderMoney";
import { mapRpcError } from "@/lib/reviews/rpcError";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/reviews/transition — every order transition goes through here,
 * so state change, money movement, and email live in one place. The RPC
 * commits first; money and mail are best-effort afterwards (refunds and
 * payouts are idempotent via their recorded ids and retried by the sweep).
 *
 *   { orderId, action: "submit", matchId, answers }   student
 *   { orderId, action: "accept" }                     coach
 *   { orderId, action: "decline", message? }          coach -> refund
 *   { orderId, action: "clarify", message }           coach
 *   { orderId, action: "reply", message }             student
 *   { orderId, action: "deliver" }                    coach
 *   { orderId, action: "followup", message }          either party
 *   { orderId, action: "complete" }                   student -> payout
 *   { orderId, action: "cancel", message? }           student -> refund
 *   { orderId, action: "coach_cancel", message? }     coach -> refund
 *   { action: "sweep" }                               housekeeping
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

  let body: {
    orderId?: string;
    action?: string;
    message?: string;
    matchId?: string;
    answers?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "invalid_json" }, { status: 400 });
  }
  const action = body.action ?? "";

  if (action === "sweep") {
    const { error } = await supabase.rpc("sweep_review_orders");
    if (error) {
      const { code, status } = mapRpcError(error);
      return NextResponse.json({ code }, { status });
    }
    try {
      await releasePendingPayouts(user.id);
    } catch (e) {
      // Payout release needs the service role + Stripe; on a dark deploy
      // neither exists and the sweep itself already committed.
      console.error("sweep payout release:", e);
    }
    try {
      await sendPendingSubmitEmails();
    } catch (e) {
      console.error("sweep submit emails:", e);
    }
    return NextResponse.json({ ok: true });
  }

  const orderId = body.orderId ?? "";
  if (!UUID_RE.test(orderId)) {
    return NextResponse.json({ code: "invalid_order" }, { status: 400 });
  }

  // Invite-back: one email per completed order, claimed atomically on
  // invited_back_at so a double tap can never send twice. Service role
  // (order writes are RPC-only for users); the WHERE carries the coach
  // check.
  if (body.action === "invite_back") {
    const { data: claimed, error } = await createAdminClient()
      .from("review_orders")
      .update({ invited_back_at: new Date().toISOString() })
      .eq("id", orderId)
      .eq("coach_id", user.id)
      .eq("status", "completed")
      .is("invited_back_at", null)
      .select("id");
    if (error) {
      return NextResponse.json({ code: "server_error" }, { status: 500 });
    }
    if (!claimed || claimed.length === 0) {
      return NextResponse.json({ code: "already_or_not_yours" }, { status: 409 });
    }
    try {
      await sendReviewEmail("invite_back", orderId);
    } catch (e) {
      console.error("invite_back email:", e);
    }
    return NextResponse.json({ ok: true });
  }

  // The Deliver button's quality floor, re-checked here so devtools
  // can't ship what the button won't (deliveryGate.ts has the rules).
  if (body.action === "deliver") {
    const [{ data: doc }, { data: fRows }] = await Promise.all([
      supabase
        .from("review_documents")
        .select("sections")
        .eq("order_id", orderId)
        .maybeSingle(),
      supabase
        .from("review_findings")
        .select("id, title, body, audio_path")
        .eq("order_id", orderId),
    ]);
    const ids = (fRows ?? []).map((f) => f.id);
    const { data: links } = ids.length
      ? await supabase
          .from("review_finding_points")
          .select("finding_id")
          .in("finding_id", ids)
      : { data: [] as { finding_id: string }[] };
    const counts = new Map<string, number>();
    for (const l of links ?? []) {
      counts.set(l.finding_id, (counts.get(l.finding_id) ?? 0) + 1);
    }
    const blocker = deliveryBlocker(
      (fRows ?? []).map((f) => ({
        title: f.title,
        body: f.body,
        audio_path: f.audio_path,
        pointCount: counts.get(f.id) ?? 0,
      })),
      ((doc?.sections ?? []) as { body?: string }[]).map((s) => ({
        body: s.body ?? "",
      })),
    );
    if (blocker) {
      return NextResponse.json(
        { code: "not_ready", message: blocker },
        { status: 422 },
      );
    }
  }
  const message =
    typeof body.message === "string" ? body.message.slice(0, 2000) : "";

  let rpc;
  switch (action) {
    case "submit": {
      if (!UUID_RE.test(body.matchId ?? "")) {
        return NextResponse.json({ code: "invalid_match" }, { status: 400 });
      }
      // Bound the answers before they reach jsonb: at most 12, each a
      // trimmed {id, label, answer} of sane length.
      const answers = Array.isArray(body.answers)
        ? body.answers.slice(0, 12).map((a) => {
            const row = a as Record<string, unknown>;
            return {
              id: String(row.id ?? "").slice(0, 60),
              label: String(row.label ?? "").slice(0, 300),
              answer: String(row.answer ?? "").slice(0, 2000),
            };
          })
        : [];
      rpc = supabase.rpc("submit_review_order", {
        p_order_id: orderId,
        p_match_id: body.matchId,
        p_answers: answers,
      });
      break;
    }
    case "accept":
      rpc = supabase.rpc("accept_review_order", { p_order_id: orderId });
      break;
    case "decline":
      rpc = supabase.rpc("decline_review_order", {
        p_order_id: orderId,
        p_message: message.slice(0, 500),
      });
      break;
    // One free-flowing thread (083); the old action names stay as
    // aliases for any tab that loaded before this deploy.
    case "message":
    case "clarify":
    case "reply":
      rpc = supabase.rpc("send_review_message", {
        p_order_id: orderId,
        p_body: message,
      });
      break;
    case "deliver":
      rpc = supabase.rpc("deliver_review", { p_order_id: orderId });
      break;
    case "followup":
      rpc = supabase.rpc("add_review_followup", {
        p_order_id: orderId,
        p_body: message,
      });
      break;
    case "complete":
      rpc = supabase.rpc("complete_review_order", { p_order_id: orderId });
      break;
    case "cancel":
      rpc = supabase.rpc("cancel_review_order", {
        p_order_id: orderId,
        p_reason: message.slice(0, 500),
      });
      break;
    case "coach_cancel":
      rpc = supabase.rpc("coach_cancel_review_order", {
        p_order_id: orderId,
        p_reason: message.slice(0, 500),
      });
      break;
    default:
      return NextResponse.json({ code: "invalid_action" }, { status: 400 });
  }

  const { data: rpcData, error } = await rpc;
  if (error) {
    const { code, status } = mapRpcError(error);
    return NextResponse.json({ code }, { status });
  }

  // Post-transition side effects, none of which may undo the state change.
  try {
    switch (action) {
      case "submit": {
        // Only email when the match was ready and the order really moved;
        // a still-processing match submits itself later (DB trigger), and
        // that path emails nothing — the coach still gets the bell.
        const { data: order } = await supabase
          .from("review_orders")
          .select("status")
          .eq("id", orderId)
          .maybeSingle();
        if (order?.status === "submitted") {
          await sendReviewEmail("order_submitted", orderId);
        }
        break;
      }
      case "accept":
        await sendReviewEmail("order_accepted", orderId);
        break;
      case "message":
      case "clarify":
      case "reply": {
        // Email only when the turn changed hands (the RPC says so); a
        // burst of consecutive messages is bells, not an inbox flood.
        const chat = rpcData as {
          flipped?: boolean;
          sender?: "coach" | "student";
        } | null;
        if (chat?.flipped) {
          await sendReviewEmail(
            chat.sender === "coach"
              ? "clarification_requested"
              : "clarification_answered",
            orderId,
          );
        }
        break;
      }
      case "deliver":
        await sendReviewEmail("review_delivered", orderId);
        break;
      case "followup": {
        // Only the student's question emails the coach; the coach's reply
        // stays a bell (the student already got the delivery email today).
        const { data: order } = await supabase
          .from("review_orders")
          .select("student_id")
          .eq("id", orderId)
          .maybeSingle();
        if (order?.student_id === user.id) {
          await sendReviewEmail("followup_received", orderId);
        }
        break;
      }
      case "complete":
        await releasePayoutForOrder(orderId);
        break;
      case "decline":
      case "cancel":
      case "coach_cancel": {
        await refundOrder(orderId);
        // A sponsored order refunds the coach's credit (a DB trigger),
        // and the student paid nothing — a "refund issued" email to them
        // would be nonsense.
        const { data: exited } = await supabase
          .from("review_orders")
          .select("funding")
          .eq("id", orderId)
          .maybeSingle();
        if (exited?.funding !== "sponsored") {
          await sendReviewEmail("order_refunded", orderId);
        }
        break;
      }
    }
  } catch (e) {
    console.error(`transition ${action} side effects:`, e);
  }
  return NextResponse.json({ ok: true });
}
