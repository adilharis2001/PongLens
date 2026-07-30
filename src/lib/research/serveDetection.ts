export const SERVE_EVENT_TYPES = [
  "serve_contact",
  "serve_first_bounce",
  "serve_second_bounce",
  "return_contact",
  "return_bounce",
  "later_contact",
  "later_bounce",
  "net_contact",
  "non_relevant",
  "unsure",
] as const;

export type ServeEventType = (typeof SERVE_EVENT_TYPES)[number];

export const NO_OBSERVABLE_SERVE_REASONS = [
  "not_visible",
  "no_serve_in_clip",
  "walking_retrieval",
  "handoff_toss",
  "bad_cut",
] as const;

export type NoObservableServeReason =
  (typeof NO_OBSERVABLE_SERVE_REASONS)[number];

export const HARD_NEGATIVE_REASONS = [
  "walking_retrieval",
  "handoff_toss",
  "bad_cut",
] as const;

export type HardNegativeReason = (typeof HARD_NEGATIVE_REASONS)[number];
export type ServeEventOrigin = "proposal" | "manual";

export interface ServeResearchEvent {
  id: string;
  time_s: number;
  event_type: ServeEventType;
  origin: ServeEventOrigin;
  hard_negative_reason: HardNegativeReason | null;
}

export interface ServeDetectionHumanLabel {
  schema_version: 1;
  actual_serve_contact_s: number | null;
  no_observable_serve: NoObservableServeReason | null;
  events: ServeResearchEvent[];
  notes: string;
}

function roundedTime(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Serve event time must be a non-negative number.");
  }
  return Number(value.toFixed(4));
}

function isServeEventType(value: unknown): value is ServeEventType {
  return SERVE_EVENT_TYPES.includes(value as ServeEventType);
}

function isNoObservableReason(
  value: unknown,
): value is NoObservableServeReason {
  return NO_OBSERVABLE_SERVE_REASONS.includes(
    value as NoObservableServeReason,
  );
}

function isHardNegativeReason(
  value: unknown,
): value is HardNegativeReason {
  return HARD_NEGATIVE_REASONS.includes(value as HardNegativeReason);
}

export function createServeDetectionLabel(): ServeDetectionHumanLabel {
  return {
    schema_version: 1,
    actual_serve_contact_s: null,
    no_observable_serve: null,
    events: [],
    notes: "",
  };
}

export function hydrateServeDetectionLabel(
  stored: unknown,
): ServeDetectionHumanLabel {
  if (!stored || typeof stored !== "object") {
    return createServeDetectionLabel();
  }
  const input = stored as Partial<ServeDetectionHumanLabel>;
  const contact =
    input.actual_serve_contact_s === null ||
    input.actual_serve_contact_s === undefined
      ? null
      : roundedTime(Number(input.actual_serve_contact_s));
  const noObservable =
    input.no_observable_serve === null ||
    input.no_observable_serve === undefined
      ? null
      : input.no_observable_serve;
  if (noObservable !== null && !isNoObservableReason(noObservable)) {
    throw new Error("Unsupported no-observable-serve reason.");
  }
  const events = (input.events ?? []).map((event) => {
    if (!isServeEventType(event.event_type)) {
      throw new Error(`Unsupported serve event type: ${event.event_type}`);
    }
    if (!["proposal", "manual"].includes(event.origin)) {
      throw new Error(`Unsupported serve event origin: ${event.origin}`);
    }
    if (
      event.hard_negative_reason !== null &&
      !isHardNegativeReason(event.hard_negative_reason)
    ) {
      throw new Error("Unsupported hard-negative reason.");
    }
    return {
      id: String(event.id),
      time_s: roundedTime(Number(event.time_s)),
      event_type: event.event_type,
      origin: event.origin,
      hard_negative_reason: event.hard_negative_reason,
    };
  });
  return {
    schema_version: 1,
    actual_serve_contact_s: contact,
    no_observable_serve: noObservable,
    events,
    notes: String(input.notes ?? ""),
  };
}

export function setActualServeContact(
  label: ServeDetectionHumanLabel,
  timeS: number,
): ServeDetectionHumanLabel {
  return {
    ...label,
    actual_serve_contact_s: roundedTime(timeS),
    no_observable_serve: null,
  };
}

export function setNoObservableServe(
  label: ServeDetectionHumanLabel,
  reason: NoObservableServeReason,
): ServeDetectionHumanLabel {
  if (!isNoObservableReason(reason)) {
    throw new Error("Unsupported no-observable-serve reason.");
  }
  return {
    ...label,
    actual_serve_contact_s: null,
    no_observable_serve: reason,
  };
}

export function upsertServeEvent(
  label: ServeDetectionHumanLabel,
  event: ServeResearchEvent,
): ServeDetectionHumanLabel {
  if (!isServeEventType(event.event_type)) {
    throw new Error(`Unsupported serve event type: ${event.event_type}`);
  }
  const normalized = {
    ...event,
    id: String(event.id),
    time_s: roundedTime(event.time_s),
  };
  const found = label.events.some((item) => item.id === normalized.id);
  return {
    ...label,
    events: found
      ? label.events.map((item) =>
          item.id === normalized.id ? normalized : item,
        )
      : [...label.events, normalized],
  };
}

export function removeServeEvent(
  label: ServeDetectionHumanLabel,
  eventId: string,
): ServeDetectionHumanLabel {
  return {
    ...label,
    events: label.events.filter((event) => event.id !== eventId),
  };
}

export function validateServeDetectionLabel(
  label: ServeDetectionHumanLabel,
): string[] {
  if (
    label.actual_serve_contact_s === null &&
    label.no_observable_serve === null
  ) {
    return ["actual_serve"];
  }
  return [];
}

export function frameStepTime(
  currentTime: number,
  frameDelta: number,
  fps: number,
  durationS: number,
): number {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error("Video FPS must be positive.");
  }
  const next = Math.min(
    Math.max(0, currentTime + frameDelta / fps),
    Math.max(0, durationS),
  );
  return roundedTime(next);
}
