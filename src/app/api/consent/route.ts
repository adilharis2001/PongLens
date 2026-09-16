import { NextResponse } from "next/server";
import { getAiConsentVersion } from "@/lib/config";
import { readConsent } from "@/lib/consent";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/consent — the signed-in account's AI features state and the
 * version stamp the sheet writes with an Allow. The write itself happens
 * client-side on the caller's own player_profiles row (the same path the
 * onboarding upsert uses), so this only ever reads.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const [aiConsentVersion, state] = await Promise.all([
    getAiConsentVersion(),
    readConsent(supabase, user.id),
  ]);
  return NextResponse.json(
    { aiConsentVersion, aiFeaturesEnabled: state.aiFeaturesEnabled },
    { headers: { "Cache-Control": "no-store" } },
  );
}
