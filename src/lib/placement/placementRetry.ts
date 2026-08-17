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

export interface PlacementRequestAcknowledgement {
  id: number;
  message: string;
}

export interface PlacementRequestUiState {
  sheetOpen: boolean;
  acknowledgement: PlacementRequestAcknowledgement | null;
  acknowledgementSequence: number;
}

export type PlacementRequestUiEvent =
  | { type: "open" }
  | { type: "close" }
  | { type: "started" }
  | { type: "failed" }
  | { type: "dismiss_acknowledgement" };

export function placementRequestUiTransition(
  state: PlacementRequestUiState,
  event: PlacementRequestUiEvent,
): PlacementRequestUiState {
  switch (event.type) {
    case "open":
      return { ...state, sheetOpen: true };
    case "close":
      return { ...state, sheetOpen: false };
    case "started":
      const acknowledgementSequence = state.acknowledgementSequence + 1;
      return {
        sheetOpen: false,
        acknowledgement: {
          id: acknowledgementSequence,
          message: "Placement maps are generating. We'll email you when they're ready.",
        },
        acknowledgementSequence,
      };
    case "failed":
      return state;
    case "dismiss_acknowledgement":
      return { ...state, acknowledgement: null };
  }
}

export interface PlacementRequestFailureResolution {
  status: "processing" | "retrying" | null;
  retryCount: 1 | null;
  expireSource: boolean;
  reconcileLifecycle: boolean;
  showError: boolean;
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

export function placementRequestFailureResolution(
  action: PlacementActionKind,
  code?: string,
): PlacementRequestFailureResolution {
  if (
    action === "generate"
    && code === "generation_already_processing"
  ) {
    return {
      status: "processing",
      retryCount: null,
      expireSource: false,
      reconcileLifecycle: true,
      showError: false,
    };
  }
  if (action === "retry" && code === "already_retrying") {
    return {
      status: "retrying",
      retryCount: 1,
      expireSource: false,
      reconcileLifecycle: true,
      showError: false,
    };
  }

  const reconcileLifecycle = (
    code === "source_expired"
    || code === "generation_already_used"
    || code === "generation_unavailable"
    || code === "retry_already_used"
    || code === "retry_unavailable"
  );
  return {
    status: null,
    retryCount: null,
    expireSource: code === "source_expired",
    reconcileLifecycle,
    showError: true,
  };
}

const MAX_PLACEMENT_EXPIRY_TIMER_MS = 2_147_483_647;

export function placementExpiryTimerDelay(
  expiresAt: string | null,
  now = new Date(),
): number | null {
  if (!expiresAt) return null;
  const delay = new Date(expiresAt).getTime() - now.getTime();
  if (!Number.isFinite(delay) || delay <= 0) return null;
  return Math.min(delay + 1, MAX_PLACEMENT_EXPIRY_TIMER_MS);
}

interface ReadyPlacementScrollRoot {
  getElementById: (id: string) => {
    scrollIntoView: (options?: ScrollIntoViewOptions) => void;
  } | null;
}

export function scrollToReadyPlacement(
  root: ReadyPlacementScrollRoot,
): boolean {
  const target = root.getElementById("ball-map");
  if (!target) return false;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

const PLACEMENT_REQUEST_ERROR_COPY: Record<string, string> = {
  source_expired:
    "Placement maps couldn't be generated because the original video is no longer available.",
  generation_already_processing:
    "Placement maps are generating. We'll email you when they're ready.",
  already_retrying: "We're trying again. We'll email you when they're ready.",
  retry_already_used: "Placement maps have already been requested.",
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
    ?? "Placement maps couldn't be generated. Please try again.";
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
    return "The match owner can generate placement maps.";
  }
  return "The match owner can try again.";
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

export function showPlacementDeepDive(
  view: PlacementLifecycleView,
  hasDrawablePlacement: boolean,
): boolean {
  if (hasDrawablePlacement || view.showAggregate) return true;
  return !view.poll && view.noticeBody !== null;
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
  failureCode: string | null = null,
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
        "Placement maps haven't been generated for this match. You can "
        + "generate them from Tools.",
      noticeTitle: "Placement maps haven't been generated",
      noticeBody:
        "Placement maps haven't been generated for this match. You can "
        + "generate them from Tools.",
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
        "Placement maps couldn't be generated because the original video "
        + "is no longer available.",
      noticeTitle: "Placement maps unavailable",
      noticeBody:
        "Placement maps couldn't be generated because the original video "
        + "is no longer available.",
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
        "Placement maps are generating. We'll email you when they're ready.",
      noticeTitle: "Generating placement maps…",
      noticeBody:
        "Placement maps are generating. We'll email you when they're ready.",
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
        "Placement maps couldn't be generated because the table was hard to "
        + "detect in this video. You can try once more from Tools.",
      noticeTitle: "Placement maps need another try",
      noticeBody:
        "Placement maps couldn't be generated because the table was hard to "
        + "detect in this video. You can try once more from Tools.",
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
        "We're trying again. We'll email you when they're ready.",
      noticeTitle: "Generating placement maps…",
      noticeBody:
        "We're trying again. We'll email you when they're ready.",
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
        "Placement maps couldn't be generated because the original video "
        + "is no longer available.",
      noticeTitle: "Placement retry is no longer available",
      noticeBody:
        "Placement maps couldn't be generated because the original video "
        + "is no longer available.",
      actionKind: null,
      actionLabel: null,
      poll: false,
      showAggregate: false,
    };
  }

  if (
    status === "final_failed"
    && (failureCode === "source_expired" || failureCode === "source_missing")
  ) {
    return {
      tone: "muted",
      toolStatus: "Unavailable",
      sheetTitle: "Placement maps couldn't be generated",
      sheetBody:
        "Placement maps couldn't be generated because the original video "
        + "is no longer available.",
      noticeTitle: "Placement maps couldn't be generated",
      noticeBody:
        "Placement maps couldn't be generated because the original video "
        + "is no longer available.",
      actionKind: null,
      actionLabel: null,
      poll: false,
      showAggregate: false,
    };
  }

  // Every table detector declined this video, so there is nothing left to
  // try and no point offering a retry that would run the same ladder and
  // reach the same answer. Say so plainly and leave the placement request
  // unspent — the rest of the match processed normally.
  if (status === "final_failed" && failureCode === "no_table_found") {
    return {
      tone: "muted",
      toolStatus: "Unavailable",
      sheetTitle: "No placement maps for this match",
      sheetBody:
        "We couldn't find the table in this video, so there are no placement "
        + "maps. Everything else in the match is unaffected.",
      noticeTitle: "No placement maps for this match",
      noticeBody:
        "We couldn't find the table in this video, so there are no placement "
        + "maps. Everything else in the match is unaffected.",
      actionKind: null,
      actionLabel: null,
      poll: false,
      showAggregate: false,
    };
  }

  if (status === "final_failed" && retryCount === 0) {
    return {
      tone: "muted",
      toolStatus: "Unavailable",
      sheetTitle: "Placement maps couldn't be generated",
      sheetBody:
        "Placement maps couldn't be generated because the table was hard to "
        + "detect in this video.",
      noticeTitle: "Placement maps couldn't be generated",
      noticeBody:
        "Placement maps couldn't be generated because the table was hard to "
        + "detect in this video.",
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
      "Placement maps couldn't be generated because the table was hard to "
      + "detect in this video.",
    noticeTitle: "Placement maps couldn't be generated",
    noticeBody:
      "Placement maps couldn't be generated because the table was hard to "
      + "detect in this video.",
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
  failureCode: string | null = null,
): PlacementRetryView | null {
  if (
    status === "ready"
    || status === "not_requested"
    || status === "processing"
  ) {
    return null;
  }

  const view = placementLifecycleView(
    status,
    retryCount,
    expiresAt,
    now,
    failureCode,
  );
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
