import { NextResponse } from "next/server";

import { getGateway, type BillingMode } from "@/lib/payments/gateway";
import { mapRpcError } from "@/lib/reviews/rpcError";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/reviews/checkout — start buying an offering.
 *
 * Body: { offeringId }. Creates the order via create_review_order (which
 * validates the storefront is open, snapshots price and fee, and grants
 * app access), then a checkout session on the coach's connected account,
 * and returns { url } for the redirect. The session id lands on the order
 * with the service role — payment-ref columns are server-only.
 *
 * Errors use the stable-code dialect: { code } with 4xx, never internals.
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

  let body: { offeringId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "invalid_json" }, { status: 400 });
  }
  const offeringId = body.offeringId ?? "";
  if (!UUID_RE.test(offeringId)) {
    return NextResponse.json({ code: "invalid_offering" }, { status: 400 });
  }

  const { data: orderId, error } = await supabase.rpc("create_review_order", {
    p_offering_id: offeringId,
  });
  if (error) {
    const { code, status } = mapRpcError(error);
    return NextResponse.json({ code }, { status });
  }

  const admin = createAdminClient();
  const { data: order, error: readError } = await admin
    .from("review_orders")
    .select(
      "id, price_cents, fee_cents, coach_id, billing_mode, offerings ( title )",
    )
    .eq("id", orderId)
    .single();
  if (readError || !order) {
    console.error("checkout: order read failed:", readError);
    return NextResponse.json({ code: "server_error" }, { status: 500 });
  }

  const { data: profile } = await admin
    .from("coach_profiles")
    .select("stripe_account_id, handle")
    .eq("user_id", order.coach_id)
    .maybeSingle();
  const offering = Array.isArray(order.offerings)
    ? order.offerings[0]
    : order.offerings;
  if (!profile?.stripe_account_id) {
    return NextResponse.json({ code: "coach_not_ready" }, { status: 409 });
  }

  const origin = new URL(req.url).origin;
  try {
    // The RPC stamped the order's mode at creation; the gateway follows
    // the stamp, so a test order gets the fake checkout no matter what.
    const gateway = await getGateway(order.billing_mode as BillingMode);
    const { url, sessionId } = await gateway.createCheckout({
      orderId: order.id,
      accountId: profile.stripe_account_id,
      priceCents: order.price_cents,
      feeCents: order.fee_cents,
      title: offering?.title ?? "Match review",
      studentEmail: user.email ?? null,
      successUrl: `${origin}/orders/${order.id}?paid=1`,
      cancelUrl: `${origin}/coach/${profile.handle}`,
    });

    const { error: writeError } = await admin
      .from("review_orders")
      .update({ stripe_checkout_session_id: sessionId })
      .eq("id", order.id);
    if (writeError) {
      console.error("checkout: session write failed:", writeError);
      return NextResponse.json({ code: "server_error" }, { status: 500 });
    }
    return NextResponse.json({ url });
  } catch (e) {
    console.error("checkout error:", e);
    return NextResponse.json({ code: "server_error" }, { status: 500 });
  }
}
