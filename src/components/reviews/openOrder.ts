/**
 * Which review orders stay reachable while coach_reviews_enabled is off.
 * A closed order (073's terminal statuses) is hidden with the rest of the
 * ordering experience; an open one still needs its buyer and its coach
 * to reach it, so the two detail pages keep it. Kept as a plain module
 * so server pages and the hub can share it.
 */
const CLOSED_ORDER_STATUSES = new Set([
  "completed",
  "cancelled",
  "declined",
  "refunded",
]);

export function isOpenOrder(status: string): boolean {
  return !CLOSED_ORDER_STATUSES.has(status);
}
