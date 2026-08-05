import { NextResponse } from "next/server";

import { paymentsFake } from "@/lib/payments/gateway";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/stripe/fake/onboard — STRIPE_FAKE only.
 *
 * Stands in for Stripe-hosted onboarding: verifies the signed-in coach
 * owns the fake account id, flips their capability flags on, and sends
 * them back where they came from. 404 outside fake mode.
 */

export async function GET(req: Request) {
  if (!paymentsFake()) {
    return NextResponse.json({ code: "not_here" }, { status: 404 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ code: "not_signed_in" }, { status: 401 });
  }

  const url = new URL(req.url);
  const account = url.searchParams.get("account") ?? "";
  const returnTo = url.searchParams.get("return_to") ?? "/coaching";
  // Origin-compare: backslash paths parse to external origins.
  let safeReturn = "/coaching";
  try {
    const base = "http://internal.local";
    const parsed = new URL(returnTo, base);
    if (parsed.origin === base && returnTo.startsWith("/")) {
      safeReturn = parsed.pathname + parsed.search + parsed.hash;
    }
  } catch {
    // keep the fallback
  }

  const { data: profile } = await supabase
    .from("coach_profiles")
    .select("stripe_account_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile || profile.stripe_account_id !== account) {
    return NextResponse.json({ code: "not_allowed" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("coach_profiles")
    .update({ charges_enabled: true, payouts_enabled: true })
    .eq("user_id", user.id);
  if (error) {
    console.error("fake onboard:", error);
    return NextResponse.json({ code: "server_error" }, { status: 500 });
  }
  return NextResponse.redirect(new URL(safeReturn, url.origin), 303);
}
