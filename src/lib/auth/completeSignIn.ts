import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "./paths";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function completeSignIn(
  request: Request,
  next: string,
  supabase: SupabaseServerClient,
) {
  const cookieStore = await cookies();
  const pendingInvite = cookieStore.get("pending_coach_invite")?.value;
  let destination = safeNextPath(next);

  if (pendingInvite && UUID_RE.test(pendingInvite)) {
    // Idempotent: a second accept (already bound) errors harmlessly; read the
    // row afterward to find the match that should open after sign-in.
    await supabase.rpc("accept_coach_invite", { token: pendingInvite });
    const { data: link } = await supabase
      .from("coach_links")
      .select("scope_match_id, coach_id")
      .eq("invite_token", pendingInvite)
      .maybeSingle();
    if (link?.coach_id) {
      destination = link.scope_match_id
        ? `/match/${link.scope_match_id}`
        : "/dashboard";
    }
  }

  const { origin } = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const base =
    process.env.NODE_ENV !== "development" && forwardedHost
      ? `https://${forwardedHost}`
      : origin;
  const response = NextResponse.redirect(`${base}${destination}`);
  response.cookies.delete("pending_coach_invite");
  return response;
}
