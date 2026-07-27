import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolvePendingCoachInviteDestination } from "./coachInvite";
import { safeNextPath } from "./paths";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export async function completeSignIn(
  request: Request,
  next: string,
  supabase: SupabaseServerClient,
) {
  const cookieStore = await cookies();
  const pendingInvite = cookieStore.get("pending_coach_invite")?.value;
  const fallbackDestination = safeNextPath(next);
  const destination = await resolvePendingCoachInviteDestination(
    pendingInvite,
    fallbackDestination,
    {
      acceptInvite: async (token) => {
        const { data, error } = await supabase.rpc("accept_coach_invite", {
          token,
        });
        return !error && typeof data === "string" ? data : null;
      },
      findAcceptedLink: async (linkId) => {
        const { data, error } = await supabase
          .from("coach_links")
          .select("scope_match_id")
          .eq("id", linkId)
          .maybeSingle();
        return error ? null : data;
      },
    },
  );

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
