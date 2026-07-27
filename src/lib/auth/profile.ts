const DEFAULT_DESTINATION = "/dashboard";
const MAX_DISPLAY_NAME_LENGTH = 80;

export function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

export function displayNameFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  for (const key of ["full_name", "name"] as const) {
    const value = metadata?.[key];
    if (typeof value === "string") {
      const normalized = normalizeDisplayName(value);
      if (normalized) {
        return normalized;
      }
    }
  }
  return null;
}

export function displayNameError(value: string): string | null {
  const normalized = normalizeDisplayName(value);
  if (!normalized) {
    return "Enter your name to continue.";
  }
  if (Array.from(normalized).length > MAX_DISPLAY_NAME_LENGTH) {
    return "Keep your name to 80 characters or fewer.";
  }
  return null;
}

export function needsNameOnboarding(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  return displayNameFromMetadata(metadata) === null;
}

function isBlockedDestination(pathname: string): boolean {
  return ["/login", "/auth", "/onboarding"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function safePostOnboardingPath(
  value: string | null | undefined,
): string {
  if (
    !value?.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return DEFAULT_DESTINATION;
  }

  const parsed = new URL(value, "https://ponglens.invalid");
  if (
    parsed.origin !== "https://ponglens.invalid" ||
    isBlockedDestination(parsed.pathname)
  ) {
    return DEFAULT_DESTINATION;
  }

  return `${parsed.pathname}${parsed.search}`;
}

export function buildOnboardingPath(next: string): string {
  return `/onboarding?next=${encodeURIComponent(
    safePostOnboardingPath(next),
  )}`;
}

export function onboardingPathForProtectedRequest(
  metadata: Record<string, unknown> | null | undefined,
  next: string,
): string | null {
  return needsNameOnboarding(metadata) ? buildOnboardingPath(next) : null;
}
