import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { paymentsFake } from "@/lib/payments/gateway";
import { markOrderPaid } from "@/lib/payments/orderMoney";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * /api/stripe/fake/checkout — STRIPE_FAKE only.
 *
 * A stand-in for Stripe Checkout so the whole purchase flow is walkable
 * without keys. GET renders a bare test page; POST "pays": it runs the
 * same markOrderPaid the real webhook runs (with a fake charge id) and
 * redirects to the success URL. Order ownership is checked both times.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safePath(p: string | null, fallback: string): string {
  if (p && p.startsWith("/") && !p.startsWith("//")) return p;
  return fallback;
}

async function orderForStudent(orderId: string, sessionId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: order } = await supabase
    .from("review_orders")
    .select("id, student_id, status, stripe_checkout_session_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.student_id !== user.id) return null;
  if (order.stripe_checkout_session_id !== sessionId) return null;
  return order;
}

export async function GET(req: Request) {
  if (!paymentsFake()) {
    return NextResponse.json({ code: "not_here" }, { status: 404 });
  }
  const url = new URL(req.url);
  const orderId = url.searchParams.get("order") ?? "";
  const sessionId = url.searchParams.get("session") ?? "";
  if (!UUID_RE.test(orderId) || !sessionId.startsWith("cs_fake_")) {
    return NextResponse.json({ code: "invalid_session" }, { status: 400 });
  }
  const order = await orderForStudent(orderId, sessionId);
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
  if (!paymentsFake()) {
    return NextResponse.json({ code: "not_here" }, { status: 404 });
  }
  const url = new URL(req.url);
  const orderId = url.searchParams.get("order") ?? "";
  const sessionId = url.searchParams.get("session") ?? "";
  if (!UUID_RE.test(orderId) || !sessionId.startsWith("cs_fake_")) {
    return NextResponse.json({ code: "invalid_session" }, { status: 400 });
  }
  const order = await orderForStudent(orderId, sessionId);
  if (!order) {
    return NextResponse.json({ code: "not_found" }, { status: 404 });
  }
  if (order.status === "awaiting_payment") {
    await markOrderPaid({
      sessionId,
      paymentIntentId: `pi_fake_${randomUUID().slice(0, 8)}`,
      chargeId: `ch_fake_${randomUUID().slice(0, 8)}`,
    });
  }
  const success = safePath(
    url.searchParams.get("success"),
    `/orders/${orderId}`,
  );
  return NextResponse.redirect(new URL(success, url.origin), 303);
}
