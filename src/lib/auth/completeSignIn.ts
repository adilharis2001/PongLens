import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolvePendingCoachInviteDestination } from "./coachInvite";
import { safeNextPath } from "./paths";
import { WORKSPACE_COOKIE, signInDestination } from "@/lib/workspaceModel";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export async function completeSignIn(
  request: Request,
  next: string,
  supabase: SupabaseServerClient,
) {
  const cookieStore = await cookies();
  const pendingInvite = cookieStore.get("pending_coach_invite")?.value;
  const pendingJoin = cookieStore.get("pending_student_invite")?.value;
  const fallbackDestination = safeNextPath(next);
  let destination = await resolvePendingCoachInviteDestination(
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

  // A stashed join link routes the fresh session back to the join page —
  // never auto-accepted here, because joining grants the coach access to
  // this player's matches and the page asks first. The coach-invite path
  // above wins when both are somehow present.
  if (
    destination === fallbackDestination &&
    pendingJoin &&
    /^[0-9a-f-]{36}$/i.test(pendingJoin)
  ) {
    destination = `/join/${pendingJoin}`;
  }

  // A plain sign-in lands on the side this account works from (158):
  // the remembered cookie, else the coach flag, else the player home.
  // An explicit ?next= is always honoured as-is.
  if (destination === fallbackDestination) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    destination = signInDestination({
      requested: destination,
      cookie: cookieStore.get(WORKSPACE_COOKIE)?.value,
      userId: user?.id ?? null,
      isCoach: user?.user_metadata?.is_coach === true,
    });
  }

  const { origin } = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const base =
    process.env.NODE_ENV !== "development" && forwardedHost
      ? `https://${forwardedHost}`
      : origin;
  const response = NextResponse.redirect(`${base}${destination}`);
  response.cookies.delete("pending_coach_invite");
  response.cookies.delete("pending_student_invite");
  return response;
}
