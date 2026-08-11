import { NextResponse } from "next/server";

import { getGateway, paymentsFake } from "@/lib/payments/gateway";
import { callerBillingMode } from "@/lib/payments/mode";
import { syncAccountStatus } from "@/lib/payments/orderMoney";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/reviews/connect — the coach's payment account.
 *
 * Three actions:
 *   { action: "link" }      create the connected account if missing and
 *                           return { url } for Stripe-hosted onboarding.
 *   { action: "sync" }      re-read capability flags from the gateway and
 *                           mirror them onto the profile (called when the
 *                           coach returns from onboarding); returns
 *                           { charges_enabled, payouts_enabled }.
 *   { action: "dashboard" } one-time login link into the coach's Express
 *                           dashboard; { url: null } in fake mode.
 *
 * Requires an existing coach profile; the account id is written with the
 * service role because that column is server-only.
 */

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ code: "not_signed_in" }, { status: 401 });
  }

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "invalid_json" }, { status: 400 });
  }
  const action =
    body.action === "sync" || body.action === "dashboard"
      ? body.action
      : "link";

  const { data: profile } = await supabase
    .from("coach_profiles")
    .select("user_id, stripe_account_id, handle")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) {
    return NextResponse.json({ code: "profile_required" }, { status: 409 });
  }

  try {
    // The coach's own mode decides which world their money account lives
    // in: QA coaches onboard through the fake flow, everyone else through
    // Stripe. An account id from the other world is refused outright —
    // otherwise a fake "sync" could flip capability flags on a real
    // Stripe account that never finished onboarding.
    const mode = await callerBillingMode(supabase);
    const gateway = await getGateway(mode);
    let accountId = profile.stripe_account_id;
    if (
      !paymentsFake() && // keyless local dev is fake for everyone
      accountId &&
      (mode === "test") !== accountId.startsWith("acct_fake_")
    ) {
      return NextResponse.json(
        { code: "account_mode_mismatch" },
        { status: 409 },
      );
    }
    if (!accountId) {
      if (action === "sync" || action === "dashboard") {
        return NextResponse.json({ code: "not_connected" }, { status: 409 });
      }
      accountId = await gateway.createConnectAccount(
        user.email ?? null,
        `https://www.ponglens.com/coach/${profile.handle}`,
      );
      const admin = createAdminClient();
      const { error } = await admin
        .from("coach_profiles")
        .update({ stripe_account_id: accountId })
        .eq("user_id", user.id);
      if (error) {
        console.error("connect: account write failed:", error);
        return NextResponse.json({ code: "server_error" }, { status: 500 });
      }
    }

    if (action === "sync") {
      const status = await gateway.getAccountStatus(accountId);
      await syncAccountStatus(accountId, status);
      return NextResponse.json({
        charges_enabled: status.chargesEnabled,
        payouts_enabled: status.payoutsEnabled,
      });
    }

    if (action === "dashboard") {
      const url = await gateway.createDashboardLink(accountId);
      return NextResponse.json({ url });
    }

    const origin = new URL(req.url).origin;
    const url = await gateway.createOnboardingLink(
      accountId,
      `${origin}/coaching?connected=1`,
      `${origin}/coaching?connect_refresh=1`,
    );
    return NextResponse.json({ url });
  } catch (e) {
    console.error("connect error:", e);
    return NextResponse.json({ code: "server_error" }, { status: 500 });
  }
}
