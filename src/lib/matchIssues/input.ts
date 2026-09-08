import type { MatchIssueKind, MatchIssueSubmission } from "./types.ts";

const KINDS = new Set<MatchIssueKind>([
  "positive",
  "problem",
  "reprocess",
  "refund",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function matchIssueInput(value: unknown): MatchIssueSubmission | null {
  const body = record(value);
  if (!body || typeof body.kind !== "string" || !KINDS.has(body.kind as MatchIssueKind)) {
    return null;
  }
  if (typeof body.idempotencyKey !== "string" || !UUID.test(body.idempotencyKey)) {
    return null;
  }
  if (body.message !== undefined && typeof body.message !== "string") {
    return null;
  }
  const message = (body.message ?? "").trim();
  if (message.length > 1000 || (body.kind === "problem" && message.length === 0)) {
    return null;
  }
  return {
    kind: body.kind as MatchIssueKind,
    message,
    idempotencyKey: body.idempotencyKey,
  };
}

export function matchIssueCancelInput(value: unknown): { issueId: string } | null {
  const body = record(value);
  if (!body || typeof body.issueId !== "string" || !UUID.test(body.issueId)) {
    return null;
  }
  return { issueId: body.issueId };
}
