import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGateway } from "@/lib/payments/gateway";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "not_signed_in" }, { status: 401 });
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) return NextResponse.json({ code: "not_allowed" }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ code: "invalid_input" }, { status: 400 });
  const { error } = await supabase.rpc("set_purchases_enabled", { p_enabled: body.enabled });
  if (error) return NextResponse.json({ code: "save_failed" }, { status: 500 });
  let cleanupFailed = false;
  if (!body.enabled) {
    try {
    const { data, error } = await createAdminClient().from("platform_purchases")
      .select("stripe_checkout_session_id, billing_mode")
      .in("kind", ["minute_pack", "storage"]).eq("status", "pending")
      .not("stripe_checkout_session_id", "is", null);
    cleanupFailed = Boolean(error);
    for (const row of data ?? []) {
      try {
        const gateway = await getGateway(row.billing_mode === "test" ? "test" : "live");
        await gateway.expirePlatformCheckout(row.stripe_checkout_session_id);
      } catch { cleanupFailed = true; }
    }
    } catch { cleanupFailed = true; }
  }
  return NextResponse.json({ enabled: body.enabled, cleanupFailed });
}
