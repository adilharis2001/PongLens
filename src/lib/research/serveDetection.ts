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

export type ServeFollowupAnchorKey =
  | "first_bounce"
  | "second_bounce"
  | "receiver_contact";

export type ServeFollowupAnchorStatus =
  | "unmarked"
  | "exact"
  | "not_visible"
  | "does_not_occur";

export interface ServeFollowupAnchor {
  status: ServeFollowupAnchorStatus;
  time_s: number | null;
}

export interface ServeFollowupLabel {
  first_bounce: ServeFollowupAnchor;
  second_bounce: ServeFollowupAnchor;
  receiver_contact: ServeFollowupAnchor;
  contact_window: {
    start_s: number | null;
    end_s: number | null;
  };
  net_contacts_s: number[];
  submitted_at: string | null;
}

export interface ServeOnsetLabel {
  status: "unmarked" | "exact" | "not_visible";
  time_s: number | null;
  submitted_at: string | null;
}

export interface ServeDetectionHumanLabel {
  schema_version: 2;
  actual_serve_contact_s: number | null;
  no_observable_serve: NoObservableServeReason | null;
  events: ServeResearchEvent[];
  notes: string;
  followup: ServeFollowupLabel;
  onset: ServeOnsetLabel;
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

function createFollowupAnchor(): ServeFollowupAnchor {
  return { status: "unmarked", time_s: null };
}

function createServeFollowupLabel(): ServeFollowupLabel {
  return {
    first_bounce: createFollowupAnchor(),
    second_bounce: createFollowupAnchor(),
    receiver_contact: createFollowupAnchor(),
    contact_window: { start_s: null, end_s: null },
    net_contacts_s: [],
    submitted_at: null,
  };
}

function createServeOnsetLabel(): ServeOnsetLabel {
  return {
    status: "unmarked",
    time_s: null,
    submitted_at: null,
  };
}

export function createServeDetectionLabel(): ServeDetectionHumanLabel {
  return {
    schema_version: 2,
    actual_serve_contact_s: null,
    no_observable_serve: null,
    events: [],
    notes: "",
    followup: createServeFollowupLabel(),
    onset: createServeOnsetLabel(),
  };
}

function hydrateFollowupAnchor(
  stored: unknown,
  key: ServeFollowupAnchorKey,
): ServeFollowupAnchor {
  if (!stored || typeof stored !== "object") {
    return createFollowupAnchor();
  }
  const input = stored as Partial<ServeFollowupAnchor>;
  const allowed: ServeFollowupAnchorStatus[] = [
    "unmarked",
    "exact",
    "not_visible",
    "does_not_occur",
  ];
  const status = allowed.includes(input.status as ServeFollowupAnchorStatus)
    ? (input.status as ServeFollowupAnchorStatus)
    : "unmarked";
  if (key === "first_bounce" && status === "does_not_occur") {
    throw new Error("First bounce cannot be marked as not occurring.");
  }
  if (status !== "exact") {
    return { status, time_s: null };
  }
  if (input.time_s === null || input.time_s === undefined) {
    return createFollowupAnchor();
  }
  return { status, time_s: roundedTime(Number(input.time_s)) };
}

function hydrateServeFollowupLabel(stored: unknown): ServeFollowupLabel {
  if (!stored || typeof stored !== "object") {
    return createServeFollowupLabel();
  }
  const input = stored as Partial<ServeFollowupLabel>;
  const windowInput = input.contact_window ?? {
    start_s: null,
    end_s: null,
  };
  const normalizeOptionalTime = (value: unknown): number | null =>
    value === null || value === undefined
      ? null
      : roundedTime(Number(value));
  const netContacts = Array.from(
    new Set(
      (input.net_contacts_s ?? []).map((time) => roundedTime(Number(time))),
    ),
  ).sort((left, right) => left - right);
  return {
    first_bounce: hydrateFollowupAnchor(
      input.first_bounce,
      "first_bounce",
    ),
    second_bounce: hydrateFollowupAnchor(
      input.second_bounce,
      "second_bounce",
    ),
    receiver_contact: hydrateFollowupAnchor(
      input.receiver_contact,
      "receiver_contact",
    ),
    contact_window: {
      start_s: normalizeOptionalTime(windowInput.start_s),
      end_s: normalizeOptionalTime(windowInput.end_s),
    },
    net_contacts_s: netContacts,
    submitted_at:
      typeof input.submitted_at === "string" ? input.submitted_at : null,
  };
}

function hydrateServeOnsetLabel(stored: unknown): ServeOnsetLabel {
  if (!stored || typeof stored !== "object") {
    return createServeOnsetLabel();
  }
  const input = stored as Partial<ServeOnsetLabel>;
  const status = ["unmarked", "exact", "not_visible"].includes(
    String(input.status),
  )
    ? (input.status as ServeOnsetLabel["status"])
    : "unmarked";
  return {
    status,
    time_s:
      status === "exact" &&
      input.time_s !== null &&
      input.time_s !== undefined
        ? roundedTime(Number(input.time_s))
        : null,
    submitted_at:
      typeof input.submitted_at === "string" ? input.submitted_at : null,
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
    schema_version: 2,
    actual_serve_contact_s: contact,
    no_observable_serve: noObservable,
    events,
    notes: String(input.notes ?? ""),
    followup: hydrateServeFollowupLabel(
      (stored as { followup?: unknown }).followup,
    ),
    onset: hydrateServeOnsetLabel(
      (stored as { onset?: unknown }).onset,
    ),
  };
}

export function setServeOnset(
  label: ServeDetectionHumanLabel,
  status: ServeOnsetLabel["status"],
  timeS?: number,
): ServeDetectionHumanLabel {
  if (status === "exact" && timeS === undefined) {
    throw new Error("An exact serve onset requires a timestamp.");
  }
  return {
    ...label,
    onset: {
      status,
      time_s: status === "exact" ? roundedTime(Number(timeS)) : null,
      submitted_at: null,
    },
  };
}

export function validateServeOnset(
  label: ServeDetectionHumanLabel,
): string[] {
  return label.onset.status === "unmarked" ? ["onset"] : [];
}

export function completeServeOnset(
  label: ServeDetectionHumanLabel,
  submittedAt = new Date().toISOString(),
): ServeDetectionHumanLabel {
  if (validateServeOnset(label).length) {
    throw new Error("Serve onset label is incomplete.");
  }
  return {
    ...label,
    onset: {
      ...label.onset,
      submitted_at: submittedAt,
    },
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

function resetFollowupCompletion(
  label: ServeDetectionHumanLabel,
): ServeDetectionHumanLabel {
  return {
    ...label,
    followup: {
      ...label.followup,
      submitted_at: null,
    },
  };
}

export function setFollowupAnchor(
  label: ServeDetectionHumanLabel,
  key: ServeFollowupAnchorKey,
  status: ServeFollowupAnchorStatus,
  timeS?: number,
): ServeDetectionHumanLabel {
  if (key === "first_bounce" && status === "does_not_occur") {
    throw new Error("First bounce cannot be marked as not occurring.");
  }
  if (status === "exact" && timeS === undefined) {
    throw new Error("An exact follow-up anchor requires a timestamp.");
  }
  const next = resetFollowupCompletion(label);
  return {
    ...next,
    followup: {
      ...next.followup,
      [key]: {
        status,
        time_s: status === "exact" ? roundedTime(Number(timeS)) : null,
      },
    },
  };
}

export function setContactWindowBoundary(
  label: ServeDetectionHumanLabel,
  boundary: "start_s" | "end_s",
  timeS: number | null,
): ServeDetectionHumanLabel {
  const next = resetFollowupCompletion(label);
  return {
    ...next,
    followup: {
      ...next.followup,
      contact_window: {
        ...next.followup.contact_window,
        [boundary]: timeS === null ? null : roundedTime(timeS),
      },
    },
  };
}

export function addFollowupNetContact(
  label: ServeDetectionHumanLabel,
  timeS: number,
): ServeDetectionHumanLabel {
  const next = resetFollowupCompletion(label);
  const normalized = roundedTime(timeS);
  return {
    ...next,
    followup: {
      ...next.followup,
      net_contacts_s: Array.from(
        new Set([...next.followup.net_contacts_s, normalized]),
      ).sort((left, right) => left - right),
    },
  };
}

export function removeFollowupNetContact(
  label: ServeDetectionHumanLabel,
  timeS: number,
): ServeDetectionHumanLabel {
  const next = resetFollowupCompletion(label);
  const normalized = roundedTime(timeS);
  return {
    ...next,
    followup: {
      ...next.followup,
      net_contacts_s: next.followup.net_contacts_s.filter(
        (time) => time !== normalized,
      ),
    },
  };
}

export function validateServeFollowup(
  label: ServeDetectionHumanLabel,
): string[] {
  const missing: string[] = [];
  for (const key of [
    "first_bounce",
    "second_bounce",
    "receiver_contact",
  ] as const) {
    if (label.followup[key].status === "unmarked") {
      missing.push(key);
    }
  }
  const { start_s: start, end_s: end } = label.followup.contact_window;
  if (
    (start === null) !== (end === null) ||
    (start !== null && end !== null && start > end)
  ) {
    missing.push("contact_window");
  }
  return missing;
}

export function completeServeFollowup(
  label: ServeDetectionHumanLabel,
  submittedAt = new Date().toISOString(),
): ServeDetectionHumanLabel {
  if (validateServeFollowup(label).length > 0) {
    throw new Error("Follow-up label is incomplete.");
  }
  return {
    ...label,
    followup: {
      ...label.followup,
      submitted_at: submittedAt,
    },
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
