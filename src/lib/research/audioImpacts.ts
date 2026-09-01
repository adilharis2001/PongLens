export const AUDIO_IMPACT_KINDS = [
  "paddle",
  "table",
  "floor",
  "shoe",
  "shoe_squeak",
  "stomp",
  "net",
  "background",
  "other",
  "no_impact",
  "unsure",
] as const;

export type AudioImpactKind = (typeof AUDIO_IMPACT_KINDS)[number];
export type AudioImpactDetectorOrigin =
  | "high_frequency"
  | "low_frequency"
  | "control";

export interface AudioImpactCandidate {
  id: string;
  time_s: number;
  detector_origins: AudioImpactDetectorOrigin[];
  strength: number;
}

export interface AudioImpactHumanEvent {
  id: string;
  candidate_id: string | null;
  time_s: number;
  unsnapped_time_s: number | null;
  origin: "proposal" | "manual";
  kind: AudioImpactKind | null;
}

export interface AudioImpactHumanLabel {
  schema_version: 1;
  events: AudioImpactHumanEvent[];
  sequence_complete: boolean;
}

export interface AudioImpactProgressItem {
  status: "not_started" | "in_progress" | "submitted";
  label: AudioImpactHumanLabel;
}

export interface AudioImpactProgress {
  labeled_sounds: number;
  total_sounds: number;
  completed_points: number;
  total_points: number;
}

const SHORTCUTS: Readonly<Record<string, AudioImpactKind>> = {
  p: "paddle",
  t: "table",
  f: "floor",
  h: "shoe",
  q: "shoe_squeak",
  s: "stomp",
  n: "net",
  b: "background",
  o: "other",
  x: "no_impact",
  u: "unsure",
};

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAudioImpactKind(value: unknown): value is AudioImpactKind {
  return AUDIO_IMPACT_KINDS.includes(value as AudioImpactKind);
}

function proposalEvent(candidate: AudioImpactCandidate): AudioImpactHumanEvent {
  return {
    id: candidate.id,
    candidate_id: candidate.id,
    time_s: round4(candidate.time_s),
    unsnapped_time_s: null,
    origin: "proposal",
    kind: null,
  };
}

export function createAudioImpactLabel(
  candidates: readonly AudioImpactCandidate[],
): AudioImpactHumanLabel {
  return {
    schema_version: 1,
    events: candidates.map(proposalEvent),
    sequence_complete: false,
  };
}

export function hydrateAudioImpactLabel(
  stored: unknown,
  candidates: readonly AudioImpactCandidate[],
): AudioImpactHumanLabel {
  const blank = createAudioImpactLabel(candidates);
  if (!isRecord(stored) || stored.schema_version !== 1) return blank;

  const storedEvents = Array.isArray(stored.events) ? stored.events : [];
  const byCandidate = new Map<string, Record<string, unknown>>();
  const manualEvents: AudioImpactHumanEvent[] = [];
  for (const value of storedEvents) {
    if (!isRecord(value)) continue;
    if (value.origin === "proposal" && typeof value.candidate_id === "string") {
      byCandidate.set(value.candidate_id, value);
      continue;
    }
    if (
      value.origin === "manual" &&
      typeof value.id === "string" &&
      typeof value.time_s === "number" &&
      Number.isFinite(value.time_s)
    ) {
      manualEvents.push({
        id: value.id,
        candidate_id: null,
        time_s: round4(value.time_s),
        unsnapped_time_s:
          typeof value.unsnapped_time_s === "number" &&
          Number.isFinite(value.unsnapped_time_s)
            ? round4(value.unsnapped_time_s)
            : round4(value.time_s),
        origin: "manual",
        kind: isAudioImpactKind(value.kind) ? value.kind : null,
      });
    }
  }

  const events = blank.events.map((event) => {
    const saved = byCandidate.get(event.id);
    return {
      ...event,
      kind: saved && isAudioImpactKind(saved.kind) ? saved.kind : null,
    };
  });
  events.push(...manualEvents.sort((left, right) => left.time_s - right.time_s));
  const allAnswered = events.every((event) => event.kind !== null);

  return {
    schema_version: 1,
    events,
    sequence_complete: stored.sequence_complete === true && allAnswered,
  };
}

export function labelAudioImpactEvent(
  label: AudioImpactHumanLabel,
  eventId: string,
  kind: AudioImpactKind,
): AudioImpactHumanLabel {
  let changed = false;
  const events = label.events.map((event) => {
    if (event.id !== eventId || event.kind === kind) return event;
    changed = true;
    return { ...event, kind };
  });
  if (!changed) return label;
  return { ...label, events, sequence_complete: false };
}

export function setAudioImpactSequenceComplete(
  label: AudioImpactHumanLabel,
  complete: boolean,
): AudioImpactHumanLabel {
  return label.sequence_complete === complete
    ? label
    : { ...label, sequence_complete: complete };
}

export function insertManualAudioImpactEvent(
  label: AudioImpactHumanLabel,
  playheadTimeS: number,
  snapCandidates: readonly AudioImpactCandidate[],
): AudioImpactHumanLabel {
  const playhead = round4(playheadTimeS);
  const capturedIds = new Set(
    label.events.flatMap((event) =>
      event.candidate_id === null ? [] : [event.candidate_id],
    ),
  );
  const nearby = snapCandidates
    .filter(
      (candidate) =>
        !capturedIds.has(candidate.id) &&
        Math.abs(candidate.time_s - playheadTimeS) <= 0.05,
    )
    .sort(
      (left, right) =>
        right.strength - left.strength ||
        Math.abs(left.time_s - playheadTimeS) -
          Math.abs(right.time_s - playheadTimeS) ||
        left.id.localeCompare(right.id),
    );
  const timeS = round4(nearby[0]?.time_s ?? playheadTimeS);
  const timeMs = Math.round(playheadTimeS * 1000);
  const prefix = `manual-${timeMs}-`;
  const suffix =
    label.events.filter((event) => event.id.startsWith(prefix)).length + 1;
  const manual: AudioImpactHumanEvent = {
    id: `${prefix}${suffix}`,
    candidate_id: null,
    time_s: timeS,
    unsnapped_time_s: playhead,
    origin: "manual",
    kind: null,
  };
  return {
    ...label,
    sequence_complete: false,
    events: [...label.events, manual].sort(
      (left, right) => left.time_s - right.time_s || left.id.localeCompare(right.id),
    ),
  };
}

export function validateAudioImpactLabel(
  label: AudioImpactHumanLabel,
): string[] {
  const missing = label.events
    .filter((event) => event.kind === null)
    .map((event) => `events.${event.id}.kind`);
  if (!label.sequence_complete) missing.push("sequence_complete");
  return missing;
}

export function audioImpactProgress(
  items: readonly AudioImpactProgressItem[],
): AudioImpactProgress {
  return items.reduce<AudioImpactProgress>(
    (progress, item) => ({
      labeled_sounds:
        progress.labeled_sounds +
        item.label.events.filter((event) => event.kind !== null).length,
      total_sounds: progress.total_sounds + item.label.events.length,
      completed_points:
        progress.completed_points + (item.status === "submitted" ? 1 : 0),
      total_points: progress.total_points + 1,
    }),
    {
      labeled_sounds: 0,
      total_sounds: 0,
      completed_points: 0,
      total_points: 0,
    },
  );
}

export function audioImpactKindForShortcut(
  key: string,
): AudioImpactKind | null {
  return SHORTCUTS[key.toLowerCase()] ?? null;
}

export function isAudioImpactShortcutTarget(target: unknown): boolean {
  if (!isRecord(target)) return false;
  const tagName =
    typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
  if (["input", "textarea", "select", "button", "dialog"].includes(tagName)) {
    return true;
  }
  if (target.isContentEditable === true) return true;
  if (typeof target.closest === "function") {
    return Boolean(
      target.closest(
        "input,textarea,select,button,dialog,[contenteditable='true']",
      ),
    );
  }
  return false;
}
