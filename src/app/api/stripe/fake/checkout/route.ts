import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { paymentsFake } from "@/lib/payments/gateway";
import { callerBillingMode } from "@/lib/payments/mode";
import { markOrderPaid } from "@/lib/payments/orderMoney";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * /api/stripe/fake/checkout — STRIPE_FAKE, or a test-mode caller (092).
 *
 * A stand-in for Stripe Checkout so the whole purchase flow is walkable
 * without keys. GET renders a bare test page; POST "pays": it runs the
 * same markOrderPaid the real webhook runs (with a fake charge id) and
 * redirects to the success URL.
 *
 * This route marks orders paid without money, so in production it opens
 * only when every one of these holds: the caller's billing mode is
 * 'test' (QA role, or the admin's toggle), the caller owns the order,
 * and the order itself is stamped 'test' (markOrderPaid claims test rows
 * only). A live user gets the same 404 as before 092.
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

/**
 * The whole gate in one place: fake mode or a test-mode session, then the
 * signed-in student who owns this exact order + session. Returns null for
 * any miss — callers answer 404 without saying which check failed.
 */
async function orderForTestStudent(orderId: string, sessionId: string) {
  const supabase = await createClient();
  if (!paymentsFake() && (await callerBillingMode(supabase)) !== "test") {
    return null;
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: order } = await supabase
    .from("review_orders")
    .select("id, student_id, status, billing_mode, stripe_checkout_session_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.student_id !== user.id) return null;
  if (order.stripe_checkout_session_id !== sessionId) return null;
  if (!paymentsFake() && order.billing_mode !== "test") return null;
  return order;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const orderId = url.searchParams.get("order") ?? "";
  const sessionId = url.searchParams.get("session") ?? "";
  if (!UUID_RE.test(orderId) || !sessionId.startsWith("cs_fake_")) {
    return NextResponse.json({ code: "invalid_session" }, { status: 400 });
  }
  const order = await orderForTestStudent(orderId, sessionId);
  if (!order) {
    return NextResponse.json({ code: "not_found" }, { status: 404 });
  }

  const amount = Number(url.searchParams.get("amount") ?? "0");
  const title = (url.searchParams.get("title") ?? "Match review").slice(0, 80);
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
  <form method="post" action="/api/stripe/fake/checkout?${esc(q)}">
    <button type="submit">Pay $${esc(dollars)}</button>
  </form>
  <a href="${esc(safePath(url.searchParams.get("cancel"), "/dashboard"))}">Cancel</a>
</main></body></html>`;
  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const orderId = url.searchParams.get("order") ?? "";
  const sessionId = url.searchParams.get("session") ?? "";
  if (!UUID_RE.test(orderId) || !sessionId.startsWith("cs_fake_")) {
    return NextResponse.json({ code: "invalid_session" }, { status: 400 });
  }
  const order = await orderForTestStudent(orderId, sessionId);
  if (!order) {
    return NextResponse.json({ code: "not_found" }, { status: 404 });
  }
  if (order.status === "awaiting_payment") {
    await markOrderPaid({
      sessionId,
      paymentIntentId: `pi_fake_${randomUUID().slice(0, 8)}`,
      chargeId: `ch_fake_${randomUUID().slice(0, 8)}`,
      mode: order.billing_mode === "live" ? "live" : "test",
    });
  }
  const success = safePath(
    url.searchParams.get("success"),
    `/orders/${orderId}`,
  );
  return NextResponse.redirect(new URL(success, url.origin), 303);
}
