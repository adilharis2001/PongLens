import { NextResponse } from "next/server";

import { getGateway } from "@/lib/payments/gateway";
import { callerBillingMode } from "@/lib/payments/mode";
import { stampPurchaseSession } from "@/lib/payments/platformMoney";
import { mapRpcError } from "@/lib/reviews/rpcError";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/billing/checkout — buy a pack from PongLens (096).
 *
 * Body: { kind: "minute_pack" | "storage" | "sponsored_pack",
 *         packKey: string, next?: string }
 *
 * create_platform_purchase validates the pack against config and
 * snapshots it (price included) onto a pending row stamped with the
 * caller's billing mode; the gateway for that mode produces the checkout.
 * Fulfillment arrives via the platform webhook (or the fake route).
 */

function safeNext(p: unknown): string {
  if (typeof p === "string" && p.startsWith("/")) {
    try {
      const base = "http://internal.local";
      const parsed = new URL(p, base);
      if (parsed.origin === base) {
        return parsed.pathname + parsed.search;
      }
    } catch {
      // fall through
    }
  }
  return "/account";
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ code: "not_signed_in" }, { status: 401 });
  }

  let body: { kind?: unknown; packKey?: unknown; next?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "invalid_input" }, { status: 400 });
  }
  const kind = typeof body.kind === "string" ? body.kind : "";
  const packKey = typeof body.packKey === "string" ? body.packKey : "";
  if (!kind || !packKey) {
    return NextResponse.json({ code: "invalid_input" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("create_platform_purchase", {
    p_kind: kind,
    p_pack_key: packKey,
  });
  if (error) {
    const { code, status } = mapRpcError(error);
    return NextResponse.json({ code }, { status });
  }
  const purchase = data as {
    purchase_id: string;
    amount_cents: number;
    title: string;
  };

  const next = safeNext(body.next);
  const origin = new URL(req.url).origin;
  try {
    const gateway = await getGateway(await callerBillingMode(supabase));
    const checkout = await gateway.createPlatformCheckout({
      purchaseId: purchase.purchase_id,
      amountCents: purchase.amount_cents,
      title: purchase.title,
      userEmail: user.email ?? null,
      successUrl: `${origin}${next}${next.includes("?") ? "&" : "?"}purchased=1`,
      cancelUrl: `${origin}${next}`,
    });
    await stampPurchaseSession(purchase.purchase_id, checkout.sessionId);
    // Cover a switch change while the gateway was opening the checkout.
    if (kind === "minute_pack" || kind === "storage") {
      const { data: flag } = await supabase.from("app_config").select("value")
        .eq("key", "purchases_enabled").maybeSingle();
      if (flag?.value !== "true") {
        await gateway.expirePlatformCheckout(checkout.sessionId);
        return NextResponse.json({ code: "purchases_disabled" }, { status: 409 });
      }
    }
    return NextResponse.json({ url: checkout.url });
  } catch (e) {
    console.error("platform checkout failed:", e);
    return NextResponse.json({ code: "server_error" }, { status: 500 });
  }
}
