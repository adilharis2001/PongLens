export const EVENT_SHORTCUTS = {
  p: "paddle",
  t: "table",
  n: "net",
  f: "floor",
  b: "body_catch",
  v: "voice",
  o: "other",
  u: "unsure",
} as const;

export type ResearchEventType =
  (typeof EVENT_SHORTCUTS)[keyof typeof EVENT_SHORTCUTS];
export type ResearchEventOrigin = "audio" | "blurball" | "both" | "manual";

export interface HumanEventLabel {
  event_id: string;
  time_s: number;
  origin: ResearchEventOrigin;
  event_type: ResearchEventType | null;
  belongs_to_visible_point: "yes" | "background" | "unsure" | null;
  phase:
    | "pre_serve"
    | "serve"
    | "rally"
    | "point_ending"
    | "post_point"
    | null;
  audibility: "clear" | "faint" | "not_audible" | "unsure" | null;
  visual_support: "clear" | "weak" | "absent" | null;
  player_side: "near" | "far" | "neither" | "unsure" | null;
  confidence: "certain" | "likely" | "unsure" | null;
  proposal_confirmed: "confirmed" | "corrected" | "rejected" | null;
  table_bounce: {
    table_side: "near" | "far" | "net_center" | "unsure" | null;
    landing_status: "in" | "edge" | "out" | "unsure" | null;
    table_u: number | null;
    table_v: number | null;
    screen_x: number | null;
    screen_y: number | null;
    homography_version: string | null;
    location_visibility: "clear" | "estimated" | "not_visible" | null;
    location_confidence: "certain" | "likely" | "unsure" | null;
    track_candidate_id: string | null;
  } | null;
}

interface ProposedEventSeed {
  eventId: string;
  timeS: number;
  origin: ResearchEventOrigin;
  proposalType?: string | null;
}

/**
 * Creates an empty human answer for a proposed event. proposalType is
 * deliberately ignored: detector semantics must never silently become truth.
 */
export function createHumanEventLabel(seed: ProposedEventSeed): HumanEventLabel {
  return {
    event_id: seed.eventId,
    time_s: seed.timeS,
    origin: seed.origin,
    event_type: null,
    belongs_to_visible_point: null,
    phase: null,
    audibility: null,
    visual_support: null,
    player_side: null,
    confidence: null,
    proposal_confirmed: null,
    table_bounce: null,
  };
}

export const REQUIRED_POINT_FIELDS = [
  "server",
  "winner",
  "point_validity",
  "serve_contact_s",
  "decisive_c_s",
  "review_end_s",
  "last_hitter",
  "responsible_player",
  "ending_type",
  "final_ball_result",
  "return_contact_after_final_bounce",
  "point_confidence",
] as const;

export function requiredPointFields(
  point: Record<string, unknown>,
): string[] {
  return REQUIRED_POINT_FIELDS.filter((field) => {
    const value = point[field];
    return value === null || value === undefined || value === "";
  });
}

const EVENT_LETTERS: Record<ResearchEventType, string> = {
  paddle: "P",
  table: "T",
  net: "N",
  floor: "F",
  body_catch: "B",
  voice: "V",
  other: "O",
  unsure: "U",
};

const EVENT_NAMES: Record<ResearchEventType, string> = {
  paddle: "Paddle",
  table: "Table",
  net: "Net",
  floor: "Floor",
  body_catch: "Body/catch",
  voice: "Voice",
  other: "Other",
  unsure: "Unsure",
};

export function reviewDotText(eventType: ResearchEventType | null) {
  if (!eventType) return { letter: "", title: "Not reviewed" };
  return {
    letter: EVENT_LETTERS[eventType],
    title: `Reviewed as ${EVENT_NAMES[eventType]}`,
  };
}

export interface PilotAssignmentSeed {
  sourceId: string;
  sequence: number;
  isRepeat: boolean;
  duplicateGroup: string | null;
}

export interface ResearchPointLabel {
  server: "near" | "far" | "unsure" | null;
  winner: "near" | "far" | "let" | "unsure" | null;
  point_validity: "rally" | "let_replay" | "abandoned" | "unusable" | null;
  serve_contact_s: number | "not_visible" | null;
  decisive_c_s: number | null;
  review_end_s: number | null;
  last_hitter: "near" | "far" | "no_contact" | "unsure" | null;
  responsible_player: "near" | "far" | "neither" | "unsure" | null;
  ending_type:
    | "clean_winner"
    | "net_error"
    | "long_error"
    | "wide_error"
    | "edge_ball"
    | "net_cord_winner"
    | "double_bounce"
    | "body_catch_obstruction"
    | "serve_fault"
    | "let_replay"
    | "other"
    | "unsure"
    | null;
  final_ball_result:
    | "in"
    | "net"
    | "long"
    | "wide"
    | "edge"
    | "double_bounce"
    | "body_catch"
    | "unknown"
    | null;
  return_contact_after_final_bounce: "yes" | "no" | "unsure" | null;
  point_confidence: "certain" | "likely" | "unsure" | null;
  reaction_cues: string[];
}

export interface ResearchHumanLabel {
  schema_version: 1;
  point: ResearchPointLabel;
  events: HumanEventLabel[];
  notes: string;
}

interface ProposalMarkerSeed {
  id: string;
  time_s: number;
  origin: ResearchEventOrigin;
  audio_id?: string | null;
  visual_id?: string | null;
}

interface ProposalSeed {
  markers?: ProposalMarkerSeed[];
}

function emptyPointLabel(): ResearchPointLabel {
  return {
    server: null,
    winner: null,
    point_validity: null,
    serve_contact_s: null,
    decisive_c_s: null,
    review_end_s: null,
    last_hitter: null,
    responsible_player: null,
    ending_type: null,
    final_ball_result: null,
    return_contact_after_final_bounce: null,
    point_confidence: null,
    reaction_cues: [],
  };
}

export function hydrateHumanLabel(
  proposal: ProposalSeed,
  current: Partial<ResearchHumanLabel> | null,
): ResearchHumanLabel {
  const existingEvents = new Map(
    (current?.events ?? []).map((event) => [event.event_id, event]),
  );
  const events = (proposal.markers ?? []).map((marker) => {
    const existing = existingEvents.get(marker.id);
    return existing
      ? existing
      : createHumanEventLabel({
          eventId: marker.id,
          timeS: marker.time_s,
          origin: marker.origin,
        });
  });
  for (const event of current?.events ?? []) {
    if (!events.some((candidate) => candidate.event_id === event.event_id)) {
      events.push(event);
    }
  }
  return {
    schema_version: 1,
    point: { ...emptyPointLabel(), ...(current?.point ?? {}) },
    events: events.sort((left, right) => left.time_s - right.time_s),
    notes: current?.notes ?? "",
  };
}

const REQUIRED_EVENT_FIELDS = [
  "event_type",
  "belongs_to_visible_point",
  "phase",
  "audibility",
  "visual_support",
  "player_side",
  "confidence",
  "proposal_confirmed",
] as const;

export function unresolvedEventFields(event: HumanEventLabel): string[] {
  const missing = REQUIRED_EVENT_FIELDS.filter(
    (field) => event[field] === null || event[field] === undefined,
  ) as string[];
  if (event.event_type === "table") {
    if (!event.table_bounce) {
      missing.push("table_bounce");
    } else {
      for (const field of [
        "table_side",
        "landing_status",
        "location_visibility",
        "location_confidence",
      ] as const) {
        if (event.table_bounce[field] === null) {
          missing.push(`table_bounce.${field}`);
        }
      }
    }
  }
  return missing;
}

export function isResearchMediaKey(key: string): boolean {
  return /^research\/fused-labeling\/v\d+\/sources\/[0-9a-f-]{36}\.mp4$/i.test(
    key,
  );
}

function seededScore(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * A 30-assignment pilot: 20 unique sources and hidden second passes for the
 * first 10. The deterministic shuffle is reproducible for QA and seeding.
 */
export function buildPilotAssignmentOrder(
  sourceIds: string[],
  seed: string,
): PilotAssignmentSeed[] {
  if (sourceIds.length !== 20) {
    throw new Error("The pilot requires exactly 20 unique source points.");
  }

  const duplicateGroups = new Map(
    sourceIds.slice(0, 10).map((sourceId, index) => [
      sourceId,
      `duplicate-${String(index + 1).padStart(2, "0")}`,
    ]),
  );
  const jobs = sourceIds.flatMap((sourceId) => {
    const duplicateGroup = duplicateGroups.get(sourceId) ?? null;
    const ordinary = { sourceId, isRepeat: false, duplicateGroup };
    return duplicateGroup
      ? [ordinary, { sourceId, isRepeat: true, duplicateGroup }]
      : [ordinary];
  });

  return jobs
    .map((item, index) => ({
      item,
      index,
      score: seededScore(`${seed}:${item.sourceId}:${item.isRepeat ? 1 : 0}`),
    }))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ item }, index) => ({ ...item, sequence: index + 1 }));
}
