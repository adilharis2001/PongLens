/**
 * Cut again: the pure rules behind the More options sheet
 * (docs/superpowers/specs/2026-09-25-cut-again-contract.md). What the sheet
 * offers for a given `recut_options` answer, how the Replace / Keep choice
 * reads, and which sentence a refusal becomes. No React and no network, so
 * the node tests hold every case.
 */

import { handCutClaimError, type CutMode, type Mark } from "../handCut.ts";

/** Why nothing can start, as `recut_options` names it. */
export type RecutReason = "not_ready" | "processing" | "no_source" | "support_request";

/** `recut_options(p_match_id)`, read into camelCase. */
export interface RecutOptions {
  available: boolean;
  reason: string | null;
  replaceByHand: boolean;
  replaceAutomatic: boolean;
  hasCoachReview: boolean;
  hasMatchNotes: boolean;
  cutSource: string | null;
}

/**
 * Read the jsonb `recut_options` returns. Anything that is not an object
 * with an `available` flag is no answer at all (null), which the sheet
 * treats like a call that is not live yet: it offers nothing new.
 */
export function readRecutOptions(raw: unknown): RecutOptions | null {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  if (typeof r.available !== "boolean") return null;
  const hasCoachReview = r.has_coach_review === true;
  return {
    available: r.available,
    reason: typeof r.reason === "string" ? r.reason : null,
    // A coach review always takes Replace away, whatever else the row says.
    replaceByHand: r.replace_by_hand === true && !hasCoachReview,
    replaceAutomatic: r.replace_automatic === true && !hasCoachReview,
    hasCoachReview,
    hasMatchNotes: r.has_match_notes === true,
    cutSource: typeof r.cut_source === "string" ? r.cut_source : null,
  };
}

export interface MoreOptionsView {
  /** "Automatically", under "Process again". */
  automatic: boolean;
  /** "Mark the points yourself". */
  hand: boolean;
  /** A cut is running on this match: the sheet shows its progress and
   *  nothing else can start. */
  running: boolean;
  /** One line in place of the two rows, when the reason is the player's
   *  business. Null when there is nothing to say. */
  note: string | null;
}

/**
 * Which rows the More options sheet shows. "Report a problem" always shows,
 * so it is not in here.
 */
export function moreOptionsView(s: {
  options: RecutOptions | null;
  handCutEnabled: boolean;
  commerceEnabled: boolean;
  hasOriginal: boolean;
  jobRunning: boolean;
}): MoreOptionsView {
  const none = { automatic: false, hand: false };
  if (s.jobRunning || s.options?.reason === "processing") {
    return { ...none, running: true, note: null };
  }
  // Not live yet, or not read yet: nothing new to offer.
  if (!s.options) return { ...none, running: false, note: null };
  if (!s.hasOriginal || s.options.reason === "no_source") {
    return { ...none, running: false, note: "The original video is no longer stored." };
  }
  if (!s.options.available) {
    return {
      ...none,
      running: false,
      note:
        s.options.reason === "support_request"
          ? "Something is already running on this match."
          : null,
    };
  }
  return {
    automatic: s.commerceEnabled,
    hand: s.handCutEnabled,
    running: false,
    note: null,
  };
}

export type RecutChoice = "replace" | "keep";
export type RecutWay = "automatic" | "hand";

export interface RecutChoiceView {
  replaceEnabled: boolean;
  /** Under a greyed Replace: "Has a coach review", or nothing. */
  replaceNote: string | null;
  /** The choice in force. Keep whenever Replace cannot be had. */
  selected: RecutChoice;
  /** Under Replace while it is selected. */
  replaceLines: string[];
}

export const REPLACE_LINE = "Points, scores and point notes will be deleted.";
export const MATCH_NOTES_LINE = "Match notes stay with the match.";
export const COACH_REVIEW_NOTE = "Has a coach review";

/**
 * The choice at the last step of either way. Keep is the default
 * (assumption B): Replace deletes the player's work, and the safer default
 * costs one tap to change. A coach review takes Replace away and says so;
 * automatic Replace is greyed with no line until the flag turns it on.
 */
export function recutChoiceView(
  way: RecutWay,
  options: RecutOptions | null,
  picked: RecutChoice | null,
): RecutChoiceView {
  const replaceEnabled =
    !!options && (way === "hand" ? options.replaceByHand : options.replaceAutomatic);
  const replaceNote = options?.hasCoachReview ? COACH_REVIEW_NOTE : null;
  const selected: RecutChoice = replaceEnabled && picked === "replace" ? "replace" : "keep";
  return {
    replaceEnabled,
    replaceNote: replaceEnabled ? null : replaceNote,
    selected,
    replaceLines:
      selected === "replace"
        ? [REPLACE_LINE, ...(options?.hasMatchNotes ? [MATCH_NOTES_LINE] : [])]
        : [],
  };
}

/**
 * A refused cut-again call as the player reads it. `coach_review` is not an
 * error to show: the sheet reads the options again, Replace greys out with
 * its reason, and the choice falls back to Keep. Everything the contract
 * does not name keeps the hand-cut messages the unprocessed page uses.
 */
export function recutClaimError(message: string): { code: string | null; text: string | null } {
  const m = message || "";
  if (/\bcoach_review\b/.test(m)) return { code: "coach_review", text: null };
  const busy = m.match(/\b(support_request|already_processing|processing)\b/);
  if (busy) return { code: busy[1], text: "Something is already running on this match." };
  if (/\bno_source\b/.test(m)) return { code: "no_source", text: "The original video is no longer stored." };
  return { code: null, text: handCutClaimError(m) };
}

/** `/api/process` refusals, as the unprocessed page words them. */
export function processErrorMessage(code: unknown): string {
  if (code === "insufficient_minutes") return "Not enough minutes for this video.";
  if (code === "queue_full") return "Your queue is full. Wait for a video to finish.";
  return "Something went wrong. Try again.";
}

/**
 * The trailing "{N} marked" on "Mark the points yourself": closed marks in
 * a draft nobody has sent. A sent draft (the cut that made this match) is
 * history, not work in progress, and shows nothing. Neither does a
 * prefilled one: start_recut copies this cut's points in as the marks the
 * marker opens on, and opening it only to look is not marking
 * (20260925133555). Nothing counted also means "Start marking", not
 * "Keep marking".
 */
export function unsentMarkCount(marks: Mark[], submitted: boolean, prefilled = false): number {
  if (submitted || prefilled) return 0;
  return marks.filter((m) => m.t1 !== null).length;
}

/**
 * Where the Score switch starts on a processed match, before the draft is
 * written: a draft being resumed keeps its pass; otherwise the pass
 * start_recut will record, which is scoring when the current cut has any
 * point called and cutting only when it has none. Never on for a practice.
 */
export function recutStartMode(s: {
  draftMarks: Mark[];
  draftMode: CutMode | null;
  draftSubmitted: boolean;
  anyCalled: boolean;
  scoringAllowed: boolean;
}): CutMode {
  if (!s.scoringAllowed) return "cut";
  if (!s.draftSubmitted && s.draftMarks.length > 0) {
    if (s.draftMode) return s.draftMode;
    return s.draftMarks.some((m) => m.isLet || m.winner !== null) ? "score" : "cut";
  }
  return s.anyCalled ? "score" : "cut";
}

/** What `claim_hand_recut` hands back, or null if it is not that shape. */
export function readRecutClaim(raw: unknown): { jobId: string | null; matchId: string } | null {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  if (typeof r.match_id !== "string" || !r.match_id) return null;
  return { jobId: typeof r.job_id === "string" ? r.job_id : null, matchId: r.match_id };
}

/** What `copy_match_for_recut` hands back: the new match's id. */
export function readCopiedMatchId(raw: unknown): string | null {
  if (typeof raw === "string" && raw) return raw;
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (typeof row === "object" && row !== null) {
    const r = row as Record<string, unknown>;
    for (const key of ["copy_match_for_recut", "match_id", "id"]) {
      if (typeof r[key] === "string" && r[key]) return r[key] as string;
    }
  }
  return null;
}
