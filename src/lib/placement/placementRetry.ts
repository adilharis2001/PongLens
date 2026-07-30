import type { MatchPlacementStatus } from "../types.ts";

export type PlacementRetryAction =
  | "enqueue"
  | "expired"
  | "used"
  | "already_retrying"
  | "unavailable";

export interface PlacementRetryView {
  tone: "warning" | "progress" | "muted";
  title: string;
  body: string;
  action: string | null;
  poll: boolean;
}

export type PlacementActionAvailability =
  | "generate"
  | "retry"
  | "expired"
  | "already_processing"
  | "used"
  | "unavailable";

export type PlacementActionKind = "generate" | "retry";

export interface PlacementRequestIdentity {
  matchId: string;
  epoch: number;
}

export function isPlacementRequestCurrent(
  started: PlacementRequestIdentity,
  current: PlacementRequestIdentity,
): boolean {
  return started.matchId === current.matchId
    && started.epoch === current.epoch;
}

export function placementActionEndpoint(action: PlacementActionKind): string {
  return action === "generate"
    ? "/api/placement-generate"
    : "/api/placement-retry";
}

const PLACEMENT_REQUEST_ERROR_COPY: Record<string, string> = {
  source_expired:
    "The original recording is no longer available for placement analysis.",
  generation_already_processing: "Placement maps are already being generated.",
  already_retrying: "Placement maps are already being generated.",
  retry_already_used: "The one-time placement retry has already been used.",
  generation_already_used:
    "Placement maps have already been requested for this match.",
  generation_unavailable: "Placement maps aren't available for this match.",
  retry_unavailable: "The placement retry is no longer available.",
  match_not_found: "We couldn't find this match.",
  not_owner: "Only the match owner can request placement maps.",
  not_authenticated: "Please sign in again before requesting placement maps.",
};

export function placementRequestErrorCopy(code?: string): string {
  return PLACEMENT_REQUEST_ERROR_COPY[code ?? ""]
    ?? "We couldn't start placement analysis. Please try again.";
}

export function isPlacementTerminal(status: MatchPlacementStatus): boolean {
  return (
    status === "ready"
    || status === "retry_available"
    || status === "final_failed"
  );
}

export function placementNoticeForViewer(
  view: PlacementLifecycleView,
  isOwner: boolean,
): string | null {
  if (isOwner || view.actionKind === null) return view.noticeBody;
  if (view.actionKind === "generate") {
    return "The match owner can request placement maps while the original "
      + "recording is available.";
  }
  return "Placement maps need another try. The match owner can request the "
    + "stronger retry once.";
}

export interface PlacementLifecycleView {
  tone: "warning" | "progress" | "muted";
  toolStatus: "Generate" | "Generating…" | "Try again" | "Retrying…"
    | "Ready" | "Unavailable";
  sheetTitle: string;
  sheetBody: string;
  noticeTitle: string | null;
  noticeBody: string | null;
  actionKind: PlacementActionKind | null;
  actionLabel: string | null;
  poll: boolean;
  showAggregate: boolean;
}

export function placementActionAvailability(
  status: MatchPlacementStatus,
  retryCount: number,
  expiresAt: string | null,
  now = new Date(),
): PlacementActionAvailability {
  if (status === "processing" || status === "retrying") {
    return "already_processing";
  }
  if (status !== "not_requested" && status !== "retry_available") {
    return "unavailable";
  }
  if (retryCount !== 0) return "used";
  if (!expiresAt || new Date(expiresAt).getTime() <= now.getTime()) {
    return "expired";
  }
  return status === "not_requested" ? "generate" : "retry";
}

export function placementLifecycleView(
  status: MatchPlacementStatus,
  retryCount: number,
  expiresAt: string | null,
  now = new Date(),
): PlacementLifecycleView {
  const availability = placementActionAvailability(
    status,
    retryCount,
    expiresAt,
    now,
  );

  if (status === "not_requested" && availability === "generate") {
    return {
      tone: "muted",
      toolStatus: "Generate",
      sheetTitle: "Generate placement maps?",
      sheetBody:
        "We'll analyze the original recording and generate placement maps "
        + "without changing your points, clips, score, or notes.",
      noticeTitle: "Placement maps haven't been generated",
      noticeBody:
        "You can request placement maps from Tools while the original "
        + "recording is available.",
      actionKind: "generate",
      actionLabel: "Generate placement maps",
      poll: false,
      showAggregate: false,
    };
  }

  if (status === "not_requested" && availability === "expired") {
    return {
      tone: "muted",
      toolStatus: "Unavailable",
      sheetTitle: "Placement maps unavailable",
      sheetBody:
        "The original recording is no longer available, so placement maps "
        + "can't be generated.",
      noticeTitle: "Placement maps unavailable",
      noticeBody:
        "The original recording is no longer available, so placement maps "
        + "can't be generated.",
      actionKind: null,
      actionLabel: null,
      poll: false,
      showAggregate: false,
    };
  }

  if (status === "processing") {
    return {
      tone: "progress",
      toolStatus: "Generating…",
      sheetTitle: "Generating placement maps…",
      sheetBody:
        "We're running normal placement analysis. You can leave this page; "
        + "we'll email you when it finishes.",
      noticeTitle: "Generating placement maps…",
      noticeBody:
        "We're running normal placement analysis. You can leave this page; "
        + "we'll email you when it finishes.",
      actionKind: null,
      actionLabel: null,
      poll: true,
      showAggregate: false,
    };
  }

  if (status === "retry_available" && availability === "retry") {
    return {
      tone: "warning",
      toolStatus: "Try again",
      sheetTitle: "Try placement again?",
      sheetBody:
        "Your match is ready, but we couldn't map the table reliably enough "
        + "to generate placement maps. The stronger retry is available once.",
      noticeTitle: "Placement maps need another try",
      noticeBody:
        "Your match is ready, but we couldn't map the table reliably enough "
        + "to generate placement maps. The stronger retry is available once.",
      actionKind: "retry",
      actionLabel: "Try placement again",
      poll: false,
      showAggregate: false,
    };
  }

  if (status === "retrying") {
    return {
      tone: "progress",
      toolStatus: "Retrying…",
      sheetTitle: "Retrying placement maps…",
      sheetBody:
        "We're trying a stronger table-calibration method. You can leave "
        + "this page; we'll email you when it finishes.",
      noticeTitle: "Generating placement maps…",
      noticeBody:
        "We're trying a stronger table-calibration method. You can leave "
        + "this page; we'll email you when it finishes.",
      actionKind: null,
      actionLabel: null,
      poll: true,
      showAggregate: false,
    };
  }

  if (status === "ready") {
    return {
      tone: "muted",
      toolStatus: "Ready",
      sheetTitle: "Placement maps ready",
      sheetBody: "Placement maps are ready to explore.",
      noticeTitle: null,
      noticeBody: null,
      actionKind: null,
      actionLabel: null,
      poll: false,
      showAggregate: true,
    };
  }

  if (status === "retry_available" && availability === "expired") {
    return {
      tone: "muted",
      toolStatus: "Unavailable",
      sheetTitle: "Placement retry is no longer available",
      sheetBody:
        "The original recording has passed its processing-retention window. "
        + "Your points, score, clips, and notes are still available.",
      noticeTitle: "Placement retry is no longer available",
      noticeBody:
        "The original recording has passed its processing-retention window. "
        + "Your points, score, clips, and notes are still available.",
      actionKind: null,
      actionLabel: null,
      poll: false,
      showAggregate: false,
    };
  }

  return {
    tone: "muted",
    toolStatus: "Unavailable",
    sheetTitle: "Placement maps couldn't be generated",
    sheetBody:
      "We tried again, but couldn't generate reliable placement maps from "
      + "this recording. Your points, score, clips, and notes are still "
      + "available.",
    noticeTitle: "Placement maps couldn't be generated",
    noticeBody:
      "We tried again, but couldn't generate reliable placement maps from "
      + "this recording. Your points, score, clips, and notes are still "
      + "available.",
    actionKind: null,
    actionLabel: null,
    poll: false,
    showAggregate: false,
  };
}

export function placementRetryView(
  status: MatchPlacementStatus,
  retryCount: number,
  expiresAt: string | null,
  now = new Date(),
): PlacementRetryView | null {
  if (
    status === "ready"
    || status === "not_requested"
    || status === "processing"
  ) {
    return null;
  }

  const view = placementLifecycleView(status, retryCount, expiresAt, now);
  return {
    tone: view.tone,
    title: view.noticeTitle ?? view.sheetTitle,
    body: view.noticeBody ?? view.sheetBody,
    action: view.actionLabel,
    poll: view.poll,
  };
}

export function placementRetryAction(
  status: MatchPlacementStatus,
  retryCount: number,
  expiresAt: string | null,
  now = new Date(),
): PlacementRetryAction {
  const availability = placementActionAvailability(
    status,
    retryCount,
    expiresAt,
    now,
  );
  if (availability === "retry") return "enqueue";
  if (availability === "expired") return "expired";
  if (availability === "used") return "used";
  if (availability === "already_processing") return "already_retrying";
  return "unavailable";
}

export function placementRetryError(error: {
  code?: string;
  message?: string;
}): { status: number; code: string } {
  if (error.code === "P0002") {
    return { status: 404, code: "match_not_found" };
  }
  if (error.code === "23514") {
    return { status: 409, code: "retry_already_used" };
  }
  if (error.code === "P0001") {
    if ((error.message ?? "").includes("already queued")) {
      return { status: 409, code: "already_retrying" };
    }
    return { status: 409, code: "retry_unavailable" };
  }
  if (error.code === "42501") {
    return { status: 403, code: "not_owner" };
  }
  return { status: 500, code: "queue_failed" };
}

export function placementGenerationError(error: {
  code?: string;
  message?: string;
}): { status: number; code: string } {
  if (error.code === "P0002") {
    return { status: 404, code: "match_not_found" };
  }
  if (error.code === "42501") {
    return { status: 403, code: "not_owner" };
  }
  if (error.code === "23514") {
    return { status: 409, code: "generation_already_used" };
  }
  if (error.code === "P0001") {
    if ((error.message ?? "").includes("already queued")) {
      return { status: 409, code: "generation_already_processing" };
    }
    return { status: 409, code: "generation_unavailable" };
  }
  return { status: 500, code: "queue_failed" };
}
