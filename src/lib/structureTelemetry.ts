import { track } from "@vercel/analytics";

export type StructureEvent =
  | "first_server_applied"
  | "first_server_corrected"
  | "fallback_question_shown"
  | "boundary_agreed"
  | "boundary_applied"
  | "boundary_undone"
  | "boundary_edited";

type AllowedStructureProperties = {
  confidence?: string;
  arrival?: string;
  evidenceStatus?: string;
  coverageBucket?: string;
};

const ALLOWED = [
  "confidence",
  "arrival",
  "evidenceStatus",
  "coverageBucket",
] as const;

/** Privacy boundary for structure analytics: identifiers and raw scores are
 * discarded even if a caller accidentally supplies them. */
export function structureEventPayload(
  event: StructureEvent,
  input: Record<string, unknown>
): { event: StructureEvent } & AllowedStructureProperties {
  const payload: Record<string, string> = { event };
  for (const key of ALLOWED) {
    const value = input[key];
    if (typeof value === "string") payload[key] = value;
  }
  return payload as { event: StructureEvent } & AllowedStructureProperties;
}

export function trackStructureEvent(
  event: StructureEvent,
  input: Record<string, unknown> = {}
) {
  const { event: name, ...properties } = structureEventPayload(event, input);
  track(name, properties);
}
