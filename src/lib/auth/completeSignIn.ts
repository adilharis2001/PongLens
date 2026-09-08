import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "./paths";
import { WORKSPACE_COOKIE, signInDestination } from "@/lib/workspaceModel";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function completeSignIn(
  request: Request,
  next: string,
  supabase: SupabaseServerClient,
) {
  const cookieStore = await cookies();
  const pendingInvite = cookieStore.get("pending_coach_invite")?.value;
  const pendingJoin = cookieStore.get("pending_student_invite")?.value;
  const fallbackDestination = safeNextPath(next);
  let destination = fallbackDestination;

  // A stashed invite routes the fresh session back to its page. Neither
  // kind is accepted here any more. Joining a coach never was: it hands
  // the coach access to this player's matches and the page asks first.
  // Accepting a coach invite used to happen right here, on the way
  // through sign-in, which meant it could land in whichever account the
  // browser signed into without anyone seeing whose (2026-09-07); the
  // page now names the account and waits for the tap. The coach-invite
  // path wins when both are somehow present.
  if (pendingInvite && UUID_RE.test(pendingInvite)) {
    destination = `/coach-invite/${pendingInvite}`;
  } else if (pendingJoin && UUID_RE.test(pendingJoin)) {
    destination = `/join/${pendingJoin}`;
  }

  // A plain sign-in lands on the side this account works from (158):
  // the remembered cookie, else the coach flag, else the player home.
  // An explicit ?next= is always honoured as-is.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (destination === fallbackDestination) {
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
