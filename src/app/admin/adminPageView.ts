export const ADMIN_SECTION_ORDER = [
  "accessRequests",
  "inviteCodes",
  "storage",
  "platformCosts",
] as const;

export type AdminSection = (typeof ADMIN_SECTION_ORDER)[number];
