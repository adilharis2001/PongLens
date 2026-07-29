import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  onboardingPathForProtectedRequest,
  safePostOnboardingPath,
} from "@/lib/auth/profile";
import { loginPathForDestination } from "@/lib/auth/paths";

/**
 * Refreshes the Supabase auth session on every matched request and
 * redirects unauthenticated visitors away from protected routes.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not run code between createServerClient and getUser() —
  // it can cause hard-to-debug session issues.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  const protectedPrefixes = [
    "/dashboard",
    "/match",
    "/upload",
    "/account",
    "/admin",
    "/early-access",
    "/feedback",
    "/learn",
    "/onboarding",
    "/research",
  ];
  const protectedRoute = protectedPrefixes.some((p) => path.startsWith(p));

  if (!user && protectedRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = new URL(
      loginPathForDestination(`${path}${request.nextUrl.search}`),
      request.url,
    ).search;
    return NextResponse.redirect(url);
  }

  // Early access: the app is invite-only. Signing in is open, but past this
  // point you need an app_access row (founder / invite code / coach invite —
  // migration 043). The gate page itself is the only protected page a
  // gated user can reach; /coach-invite is unprotected on purpose, since
  // accepting one IS what grants access.
  if (user && protectedRoute) {
    const { data: access } = await supabase
      .from("app_access")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!access && path !== "/early-access") {
      return NextResponse.redirect(new URL("/early-access", request.url));
    }
    if (access && path === "/early-access") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  // Onboarding gates on TWO things: a display name (as ever) and a
  // player_profiles row (046) — the row's presence, even all-null after a
  // skip, means the profile steps were offered once. Google sign-ins have
  // a name from day one, so without the row check they would never see
  // the profile steps at all.
  let onboardingPath: string | null = null;
  if (
    user &&
    protectedRoute &&
    path !== "/onboarding" &&
    path !== "/early-access"
  ) {
    onboardingPath = onboardingPathForProtectedRequest(
      user.user_metadata,
      `${path}${request.nextUrl.search}`,
    );
    if (!onboardingPath) {
      const { data: profile } = await supabase
        .from("player_profiles")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!profile) {
        onboardingPath = `/onboarding?next=${encodeURIComponent(
          `${path}${request.nextUrl.search}`,
        )}`;
      }
    }
  }

  if (onboardingPath) {
    return NextResponse.redirect(new URL(onboardingPath, request.url));
  }

  if (user && path === "/login") {
    // Honor ?next= (e.g. a coach invite) for already-signed-in visitors.
    const next = request.nextUrl.searchParams.get("next");
    const safeNext = safePostOnboardingPath(next);
    const destination =
      onboardingPathForProtectedRequest(user.user_metadata, safeNext) ??
      safeNext;
    return NextResponse.redirect(new URL(destination, request.url));
  }

  // A logged-out coach opening an invite is about to leave for authentication.
  // The ?next= param that should bring them back can be dropped whenever
  // Supabase falls back to the Site URL (origin not allow-listed). Stash the
  // token in a cookie — a reliable carrier across either Google or email
  // sign-in — so the completion route can accept the invite server-side.
  const inviteMatch = path.match(/^\/coach-invite\/([0-9a-f-]{36})\/?$/i);
  if (!user && inviteMatch) {
    supabaseResponse.cookies.set("pending_coach_invite", inviteMatch[1], {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60, // 1 hour — plenty for a sign-in round trip
    });
  }

  return supabaseResponse;
}
