const DEFAULT_DESTINATION = "/dashboard";

const PROTECTED_APP_PREFIXES = [
  "/dashboard",
  "/match",
  "/upload",
  "/account",
  "/admin",
  "/feedback",
  "/learn",
  "/marketing",
  "/onboarding",
  "/research",
  "/testing",
  "/journal",
  "/improve",
  "/stats",
  "/starred",
  // Paid reviews. NOTE: "/coach/<handle>" (the public storefront) and
  // "/coach-invite" must stay reachable logged-out, so the coach-side app
  // lives under "/coaching" and only that prefix is protected.
  "/coaching",
  "/orders",
] as const;

export function isProtectedAppPath(path: string): boolean {
  return PROTECTED_APP_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function safeNextPath(value: string | null | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//")
    ? value
    : DEFAULT_DESTINATION;
}

/**
 * The origin auth links may point at. Login pages run on preview deploys
 * and the apex domain too, and a sign-up email must never carry those
 * hosts (a *.vercel.app confirm link is how a real user ends up "in" the
 * preview build). Localhost stays itself so dev sign-in keeps working;
 * everything else pins to the canonical production origin.
 */
export function canonicalOrigin(origin: string): string {
  try {
    const host = new URL(origin).hostname;
    if (host === "localhost" || host === "127.0.0.1") return origin;
  } catch {
    // fall through to canonical
  }
  return "https://www.ponglens.com";
}

export function buildEmailConfirmRedirect(
  origin: string,
  next: string,
): string {
  return `${canonicalOrigin(origin)}/auth/confirm?next=${encodeURIComponent(safeNextPath(next))}`;
}

/**
 * Repair the malformed confirm link the iOS app's sign-in emails carried.
 *
 * The auth email templates build their link as
 * `{{ .RedirectTo }}&token_hash=...`, which assumes RedirectTo already
 * carries a query string. The web always sends `/auth/confirm?next=...`,
 * so appending `&` is right there — but the app sent a bare
 * `/auth/confirm`, and every email it requested came out as
 * `/auth/confirm&token_hash=...`: one path segment, no query at all. The
 * email's button 404'd and the app's paste fallback refused it, which a
 * tester reported as "paste never works".
 *
 * The app now sends a proper query, but emails already delivered and
 * builds already installed keep minting the malformed shape, so the site
 * meets them halfway: turn the first `&` back into the `?` it was meant
 * to be. Anything after it is passed through untouched for
 * /auth/confirm's own validation to judge.
 */
export function repairAuthConfirmPath(
  pathname: string,
): { pathname: string; search: string } | null {
  const marker = "/auth/confirm&";
  if (!pathname.startsWith(marker)) return null;
  return {
    pathname: "/auth/confirm",
    search: `?${pathname.slice(marker.length)}`,
  };
}

export function loginPathForDestination(destination: string): string {
  return `/login?next=${encodeURIComponent(safeNextPath(destination))}`;
}

export function loginErrorMessage(
  code: string | null | undefined,
): string | null {
  if (code === "email-link") {
    return "That sign-in link is invalid or has expired. Request a new one below.";
  }
  if (code === "auth") {
    return "We couldn't sign you in. Please try again.";
  }
  return null;
}
