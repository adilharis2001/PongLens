export type MatchShareKind =
  | "point"
  | "match"
  | "starred"
  | "tag"
  | "highlights";

export function matchShareKind({
  pointId,
  tagId,
  requestedKind,
}: {
  pointId: string;
  tagId: string;
  requestedKind: string;
}): MatchShareKind | null {
  if (
    requestedKind &&
    !["point", "match", "starred", "tag", "highlights"].includes(
      requestedKind,
    )
  ) {
    return null;
  }
  if (
    ((requestedKind === "starred" || requestedKind === "highlights") &&
      Boolean(pointId)) ||
    (requestedKind === "point" && !pointId) ||
    (requestedKind === "tag") !== Boolean(tagId) ||
    (tagId && pointId)
  ) {
    return null;
  }
  if (pointId) return "point";
  if (tagId) return "tag";
  if (requestedKind === "starred") return "starred";
  if (requestedKind === "highlights") return "highlights";
  return "match";
}
