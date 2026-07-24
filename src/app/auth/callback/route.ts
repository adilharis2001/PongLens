import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  let next = searchParams.get("next") ?? "/dashboard";
  if (!next.startsWith("/") || next.startsWith("//")) {
    next = "/dashboard";
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // If the coach arrived via an invite link, the token was stashed in a
      // cookie by the middleware (the ?next= param is unreliable across the
      // OAuth round trip). Accept it server-side now that the session exists,
      // then land them ON the shared match — no second visit, no manual
      // "Accept" click. An all-matches invite has no target match, so it
      // falls through to the dashboard.
      const cookieStore = await cookies();
      const pendingInvite = cookieStore.get("pending_coach_invite")?.value;
      let dest = next;
      if (pendingInvite && UUID_RE.test(pendingInvite)) {
        // Idempotent: a second accept (already bound) errors harmlessly; we
        // still read the row below to find the match to land on.
        await supabase.rpc("accept_coach_invite", { token: pendingInvite });
        const { data: link } = await supabase
          .from("coach_links")
          .select("scope_match_id, coach_id")
          .eq("invite_token", pendingInvite)
          .maybeSingle();
        if (link?.coach_id) {
          dest = link.scope_match_id
            ? `/match/${link.scope_match_id}`
            : "/dashboard";
        }
      }

      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocal = process.env.NODE_ENV === "development";
      const base =
        !isLocal && forwardedHost ? `https://${forwardedHost}` : origin;
      const res = NextResponse.redirect(`${base}${dest}`);
      // One-shot cookie — clear it so a later sign-in never re-triggers.
      res.cookies.delete("pending_coach_invite");
      return res;
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
