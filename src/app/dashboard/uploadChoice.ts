/**
 * "Break it into points" on the upload card (Adil, 2026-09-25, approved
 * from a mockup; the iPhone upload sheet carries the same three rows).
 *
 * It replaced the "Process when the upload finishes" switch. Later is that
 * switch off, Automatically is that switch on, and Mark the points yourself
 * is the switch off plus one thing: when the upload lands, the player is
 * taken to the match page with the marker already open. No React and no
 * network, so the node tests hold every case.
 */

/** The three rows, as the pick-one group (WayChoice) names them. */
export type UploadChoice = "later" | "automatic" | "hand";

/**
 * Later, every time. Never remembered: automatic processing spends
 * minutes, and a default that spends them is a default that has to be
 * noticed to be refused (the switch was off by default for the same
 * reason, 2026-09-09).
 */
export const DEFAULT_UPLOAD_CHOICE: UploadChoice = "later";

/**
 * The rows in the order the card lists them. "Mark the points yourself"
 * only for an account that has marking by hand (`hand_cut_enabled`, the
 * check the match page makes).
 */
export function uploadChoiceRows(handCutEnabled: boolean): UploadChoice[] {
  return handCutEnabled ? ["later", "automatic", "hand"] : ["later", "automatic"];
}

/** The row that is actually selected: a hand choice the account cannot
 *  use (its row is not shown) reads as Later. */
export function selectedUploadChoice(
  choice: UploadChoice,
  handCutEnabled: boolean,
): UploadChoice {
  return choice === "hand" && !handCutEnabled ? "later" : choice;
}

export interface UploadChoicePlan {
  /** Exactly the old switch: on claims processing (/api/process, same
   *  body) once the upload lands and the button has been pressed. */
  autoProcess: boolean;
  /** Take the player to the match page with the marker open when the
   *  upload lands. Nothing is processed automatically. */
  openMarker: boolean;
}

/** What the upload does when it lands, for the selected row. */
export function uploadChoicePlan(choice: UploadChoice): UploadChoicePlan {
  switch (choice) {
    case "automatic":
      return { autoProcess: true, openMarker: false };
    case "hand":
      return { autoProcess: false, openMarker: true };
    default:
      return { autoProcess: false, openMarker: false };
  }
}

/**
 * The /api/process body for an automatic run, exactly what the switch sent:
 * the detailed analysis always, and the trim window only when a handle
 * actually moved (the full window would be the same charge, but the job
 * would then record a trim nobody asked for).
 */
export function uploadProcessBody(
  matchId: string,
  trim: { start: number; end: number } | null,
): { matchId: string; placement: true; trimStartS?: number; trimEndS?: number } {
  return {
    matchId,
    placement: true,
    ...(trim ? { trimStartS: trim.start, trimEndS: trim.end } : {}),
  };
}

/** What happens the moment the upload lands. */
export type UploadLanding =
  /** Claim processing (/api/process with uploadProcessBody). */
  | { kind: "process" }
  /** Nothing is processed; go to the match page with the marker open. */
  | { kind: "marker"; href: string }
  /** The video waits in the library, the button still on screen. */
  | { kind: "library" };

/**
 * The upload has landed. The press is what spends the minutes, not the
 * last byte: Automatically processes only once the button has been
 * pressed, as the switch did. Mark the points yourself goes to the marker
 * either way, because it spends nothing. A review order's upload is paid
 * for by the review, so it never does either.
 */
export function uploadLanding(s: {
  choice: UploadChoice;
  committed: boolean;
  orderId: string | null;
  matchId: string | null;
}): UploadLanding {
  if (s.orderId) return { kind: "library" };
  const plan = uploadChoicePlan(s.choice);
  if (plan.autoProcess && s.committed) return { kind: "process" };
  if (plan.openMarker && s.matchId) {
    return { kind: "marker", href: uploadedMatchHref(s.matchId, s.choice) };
  }
  return { kind: "library" };
}

/**
 * The query flag the match page reads once to open the marker. It is taken
 * off the address as soon as it is read, so a reload or Back does not open
 * the marker again.
 */
export const MARK_ON_OPEN_PARAM = "mark";

/** Where the upload card sends the player for this match. */
export function uploadedMatchHref(matchId: string, choice: UploadChoice): string {
  const base = `/match/${matchId}`;
  return uploadChoicePlan(choice).openMarker ? `${base}?${MARK_ON_OPEN_PARAM}=1` : base;
}

/** Did the player arrive asking for the marker? `search` is
 *  `location.search`, with or without its "?". */
export function wantsMarkerOnOpen(search: string): boolean {
  return new URLSearchParams(search).get(MARK_ON_OPEN_PARAM) === "1";
}

/**
 * The button under the card and the line that replaces it once pressed,
 * for the selected row. Mark the points yourself used to read "Save video
 * in library", which is true but not what happens next (Adil, 2026-09-25).
 */
export function uploadChoiceLabels(choice: UploadChoice): {
  button: string;
  committed: string;
} {
  switch (choice) {
    case "automatic":
      return { button: "Process video", committed: "Will process when the upload finishes" };
    case "hand":
      return { button: "Save and start marking", committed: "Marking starts when the upload finishes" };
    default:
      return { button: "Save video in library", committed: "Will stay in your library" };
  }
}
