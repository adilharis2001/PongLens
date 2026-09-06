import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { paymentsFake } from "@/lib/payments/gateway";
import { callerBillingMode } from "@/lib/payments/mode";
import { fulfillPurchase } from "@/lib/payments/platformMoney";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * /api/stripe/fake/platform-checkout — STRIPE_FAKE, or a test-mode caller.
 *
 * The platform twin of /api/stripe/fake/checkout: a stand-in for Stripe
 * Checkout on PongLens's own account, so minute packs, storage and
 * sponsored packs are walkable without keys. POST runs the same
 * fulfillPurchase the real platform webhook runs.
 *
 * Production gate, all of: caller's billing mode is 'test', the caller
 * owns the purchase, the session matches, and the purchase row itself is
 * stamped 'test'. A live user gets a plain 404.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safePath(p: string | null, fallback: string): string {
  // Origin-compare instead of prefix checks: "/\\evil.com" parses to an
  // external origin under WHATWG rules and sails past startsWith("//").
  if (p) {
    try {
      const base = "http://internal.local";
      const parsed = new URL(p, base);
      if (parsed.origin === base && p.startsWith("/")) {
        return parsed.pathname + parsed.search + parsed.hash;
      }
    } catch {
      // fall through
    }
  }
  return fallback;
}

async function purchaseForTestBuyer(purchaseId: string, sessionId: string) {
  const supabase = await createClient();
  if (!paymentsFake() && (await callerBillingMode(supabase)) !== "test") {
    return null;
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: purchase } = await supabase
    .from("platform_purchases")
    .select("id, user_id, kind, status, billing_mode, stripe_checkout_session_id")
    .eq("id", purchaseId)
    .maybeSingle();
  if (!purchase || purchase.user_id !== user.id) return null;
  if (purchase.kind === "minute_pack" || purchase.kind === "storage") {
    const { data: flag } = await supabase.from("app_config").select("value")
      .eq("key", "purchases_enabled").maybeSingle();
    if (flag?.value !== "true") return null;
  }
  if (purchase.stripe_checkout_session_id !== sessionId) return null;
  if (!paymentsFake() && purchase.billing_mode !== "test") return null;
  return purchase;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const purchaseId = url.searchParams.get("purchase") ?? "";
  const sessionId = url.searchParams.get("session") ?? "";
  if (!UUID_RE.test(purchaseId) || !sessionId.startsWith("cs_fake_")) {
    return NextResponse.json({ code: "invalid_session" }, { status: 400 });
  }
  const purchase = await purchaseForTestBuyer(purchaseId, sessionId);
  if (!purchase) {
    return NextResponse.json({ code: "not_found" }, { status: 404 });
  }

  const amount = Number(url.searchParams.get("amount") ?? "0");
  const title = (url.searchParams.get("title") ?? "PongLens purchase").slice(
    0,
    80,
  );
  const dollars = Number.isFinite(amount)
    ? (amount / 100).toFixed(2).replace(/\.00$/, "")
    : "?";

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const q = url.searchParams.toString();
  const html = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test checkout</title>
<style>
  body{background:#0a0a0f;color:#e5e7eb;font:16px system-ui;display:grid;
       place-items:center;min-height:100dvh;margin:0}
  main{border:1px solid #262633;background:#14141c;border-radius:16px;
       padding:32px;max-width:360px;width:calc(100% - 48px)}
  h1{font-size:15px;color:#9ca3af;font-weight:500;margin:0 0 4px}
  p{margin:0 0 20px;font-size:20px}
  button{width:100%;padding:12px;border-radius:999px;border:0;
         background:#22d3ee;color:#0a0a0f;font-weight:600;font-size:15px}
  a{display:block;text-align:center;color:#9ca3af;margin-top:14px;
    font-size:13px}
</style></head>
<body><main>
  <h1>Test checkout · no real payment</h1>
  <p>${esc(title)} · $${esc(dollars)}</p>
  <form method="post" action="/api/stripe/fake/platform-checkout?${esc(q)}">
    <button type="submit">Pay $${esc(dollars)}</button>
  </form>
  <a href="${esc(safePath(url.searchParams.get("cancel"), "/account"))}">Cancel</a>
</main></body></html>`;
  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const purchaseId = url.searchParams.get("purchase") ?? "";
  const sessionId = url.searchParams.get("session") ?? "";
  if (!UUID_RE.test(purchaseId) || !sessionId.startsWith("cs_fake_")) {
    return NextResponse.json({ code: "invalid_session" }, { status: 400 });
  }
  const purchase = await purchaseForTestBuyer(purchaseId, sessionId);
  if (!purchase) {
    return NextResponse.json({ code: "not_found" }, { status: 404 });
  }
  if (purchase.status === "pending") {
    await fulfillPurchase({
      purchaseId,
      sessionId,
      paymentIntentId: `pi_fake_${randomUUID().slice(0, 8)}`,
    });
  }
  const success = safePath(url.searchParams.get("success"), "/account");
  return NextResponse.redirect(new URL(success, url.origin), 303);
}
