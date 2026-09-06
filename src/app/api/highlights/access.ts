export function automaticHighlightsEnabled(
  value: string | null | undefined,
  userId: string,
) {
  return value === "on" || value === `user:${userId}`;
}
