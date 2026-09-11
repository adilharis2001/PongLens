export function highlightsEnabled(
  value: string | null | undefined,
  userId: string,
) {
  if (value === "on" || value === `user:${userId}`) return true;
  if (!value?.startsWith("users:")) return false;
  return value
    .slice("users:".length)
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .includes(userId);
}
