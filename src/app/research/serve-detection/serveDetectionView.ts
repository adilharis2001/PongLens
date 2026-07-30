import type {
  ServeQueueFilter,
  ServeResearchAssignment,
  ServeFollowupReason,
  ServeReviewMode,
} from "./types";

export function applyServeReviewPlaybackDefaults(media: {
  defaultPlaybackRate: number;
  playbackRate: number;
}): void {
  media.defaultPlaybackRate = 0.25;
  media.playbackRate = 0.25;
}

export function filterServeAssignments(
  assignments: ServeResearchAssignment[],
  filter: ServeQueueFilter,
): ServeResearchAssignment[] {
  return assignments.filter(
    (assignment) =>
      (filter.match === "all" ||
        assignment.source.match_label === filter.match) &&
      (filter.status === "all" ||
        assignment.source.proposal.detector.status === filter.status),
  );
}

export function serveProgress(
  assignments: ServeResearchAssignment[],
): { completed: number; total: number } {
  return {
    completed: assignments.filter((item) => item.status === "submitted")
      .length,
    total: assignments.length,
  };
}

export function followupServeAssignments(
  assignments: ServeResearchAssignment[],
): ServeResearchAssignment[] {
  return assignments
    .filter(
      (assignment) =>
        assignment.source.prefill?.followup_v2?.included === true,
    )
    .sort(
      (left, right) =>
        (left.source.prefill.followup_v2?.order ??
          Number.MAX_SAFE_INTEGER) -
          (right.source.prefill.followup_v2?.order ??
            Number.MAX_SAFE_INTEGER) ||
        left.sequence - right.sequence,
    );
}

export function serveFollowupProgress(
  assignments: ServeResearchAssignment[],
): { completed: number; total: number } {
  const selected = followupServeAssignments(assignments);
  return {
    completed: selected.filter(
      (item) => item.human_label?.followup?.submitted_at,
    ).length,
    total: selected.length,
  };
}

export function onsetServeAssignments(
  assignments: ServeResearchAssignment[],
): ServeResearchAssignment[] {
  return assignments
    .filter(
      (assignment) =>
        assignment.source.prefill?.onset_v3?.included === true,
    )
    .sort(
      (left, right) =>
        (left.source.prefill.onset_v3?.order ??
          Number.MAX_SAFE_INTEGER) -
          (right.source.prefill.onset_v3?.order ??
            Number.MAX_SAFE_INTEGER) ||
        left.sequence - right.sequence,
    );
}

export function serveOnsetProgress(
  assignments: ServeResearchAssignment[],
): { completed: number; total: number } {
  const selected = onsetServeAssignments(assignments);
  return {
    completed: selected.filter(
      (item) => item.human_label?.onset?.submitted_at,
    ).length,
    total: selected.length,
  };
}

export function serveModeAssignments(
  assignments: ServeResearchAssignment[],
  mode: ServeReviewMode,
  filter: ServeQueueFilter,
): ServeResearchAssignment[] {
  const modeAssignments =
    mode === "onset"
      ? onsetServeAssignments(assignments)
      : mode === "followup"
      ? followupServeAssignments(assignments)
      : assignments;
  return filterServeAssignments(modeAssignments, filter);
}

export function serveModeProgress(
  assignments: ServeResearchAssignment[],
  mode: ServeReviewMode,
): { completed: number; total: number } {
  return mode === "onset"
    ? serveOnsetProgress(assignments)
    : mode === "followup"
    ? serveFollowupProgress(assignments)
    : serveProgress(assignments);
}

export function serveMediaSessionKey(
  assignment: Pick<ServeResearchAssignment, "id"> | null,
): string | null {
  return assignment?.id ?? null;
}

export function initialServePlaybackTime(
  mode: ServeReviewMode,
  storedLabel: unknown,
  durationS: number,
  proposal?: {
    service_motion?: { onset_t?: number | null };
  },
): number {
  if (mode === "onset") {
    const onset = Number(proposal?.service_motion?.onset_t);
    if (Number.isFinite(onset) && onset >= 0) {
      return Math.min(onset, durationS);
    }
    return 0;
  }
  if (
    mode !== "followup" ||
    !storedLabel ||
    typeof storedLabel !== "object" ||
    !Number.isFinite(durationS) ||
    durationS <= 0
  ) {
    return 0;
  }
  const contact = Number(
    (storedLabel as { actual_serve_contact_s?: unknown })
      .actual_serve_contact_s,
  );
  if (!Number.isFinite(contact) || contact < 0) {
    return 0;
  }
  return Math.min(contact, durationS);
}

export function nextIncompleteOnsetIndex(
  assignments: ServeResearchAssignment[],
  currentIndex: number,
): number {
  if (assignments.length === 0) return 0;
  for (let offset = 1; offset <= assignments.length; offset += 1) {
    const index = (currentIndex + offset) % assignments.length;
    if (!assignments[index]?.human_label?.onset?.submitted_at) {
      return index;
    }
  }
  return Math.min(currentIndex, assignments.length - 1);
}

export function nextUnsubmittedIndex(
  assignments: ServeResearchAssignment[],
  currentIndex: number,
): number {
  if (assignments.length === 0) return 0;
  for (let offset = 1; offset <= assignments.length; offset += 1) {
    const index = (currentIndex + offset) % assignments.length;
    if (assignments[index]?.status !== "submitted") return index;
  }
  return Math.min(currentIndex, assignments.length - 1);
}

export function nextIncompleteFollowupIndex(
  assignments: ServeResearchAssignment[],
  currentIndex: number,
): number {
  if (assignments.length === 0) return 0;
  for (let offset = 1; offset <= assignments.length; offset += 1) {
    const index = (currentIndex + offset) % assignments.length;
    if (!assignments[index]?.human_label?.followup?.submitted_at) {
      return index;
    }
  }
  return Math.min(currentIndex, assignments.length - 1);
}

export function followupReasonLabel(reason: ServeFollowupReason): string {
  switch (reason) {
    case "occluded":
      return "Serve contact is occluded";
    case "high_confidence_wrong_server":
      return "High-confidence server disagreement";
    case "correct_control":
      return "Visible comparison example";
  }
}

export function actionLabel(type: string): string {
  switch (type) {
    case "serve_contact":
      return "Likely serve contact";
    case "serve_first_bounce":
      return "Likely first bounce";
    case "serve_second_bounce":
      return "Likely second bounce";
    case "return_contact":
      return "Likely return contact";
    case "return_bounce":
      return "Likely return bounce";
    default:
      return "Likely action";
  }
}
