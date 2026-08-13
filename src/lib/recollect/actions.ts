import type { RecollectAction } from "./types";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function parseRecollectAction(value: unknown): RecollectAction | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;

  if (
    body.action === "open" &&
    isUuid(body.topicId) &&
    isUuid(body.reviewKey)
  ) {
    return { action: "open", topicId: body.topicId, reviewKey: body.reviewKey };
  }
  if (body.action === "dismiss" && isUuid(body.pointId)) {
    return { action: "dismiss", pointId: body.pointId };
  }
  if (body.action === "add_to_working_on" && isUuid(body.pointId)) {
    return { action: "add_to_working_on", pointId: body.pointId };
  }
  if (body.action === "acknowledge_notice") {
    return { action: "acknowledge_notice" };
  }
  return null;
}
