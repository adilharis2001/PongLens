const DEFAULT_DESTINATION = "/dashboard";

export function safeNextPath(value: string | null | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//")
    ? value
    : DEFAULT_DESTINATION;
}

export function buildEmailConfirmRedirect(
  origin: string,
  next: string,
): string {
  return `${origin}/auth/confirm?next=${encodeURIComponent(safeNextPath(next))}`;
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
