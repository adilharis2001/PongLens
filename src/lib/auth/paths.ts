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
