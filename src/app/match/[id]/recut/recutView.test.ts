import assert from "node:assert/strict";
import test from "node:test";

import { handCutClaimError, normalizeMarks, scoreSwitchCopy, type Mark } from "../handCut.ts";
import {
  COACH_REVIEW_NOTE,
  MATCH_NOTES_LINE,
  REPLACE_LINE,
  moreOptionsView,
  processErrorMessage,
  readCopiedMatchId,
  readRecutClaim,
  readRecutOptions,
  recutChoiceView,
  recutClaimError,
  recutStartMode,
  unsentMarkCount,
  type RecutOptions,
} from "./recutView.ts";

/** recut_options as the database returns it (contract, 2026-09-25). */
const row = (patch: Record<string, unknown> = {}) => ({
  available: true,
  reason: null,
  replace_by_hand: true,
  replace_automatic: false,
  has_coach_review: false,
  has_match_notes: false,
  cut_source: "auto",
  ...patch,
});
const opts = (patch: Record<string, unknown> = {}) => readRecutOptions(row(patch)) as RecutOptions;

test("recut_options is read defensively", () => {
  assert.deepEqual(opts(), {
    available: true,
    reason: null,
    replaceByHand: true,
    replaceAutomatic: false,
    hasCoachReview: false,
    hasMatchNotes: false,
    cutSource: "auto",
  });
  // An RPC answer wrapped in an array reads the same.
  assert.deepEqual(readRecutOptions([row()]), opts());
  // Not live yet, or not that shape: no answer.
  assert.equal(readRecutOptions(null), null);
  assert.equal(readRecutOptions("nope"), null);
  assert.equal(readRecutOptions({ reason: "processing" }), null);
  // A coach review takes Replace away whatever the row says (assumption A).
  const reviewed = opts({ has_coach_review: true, replace_by_hand: true, replace_automatic: true });
  assert.equal(reviewed.replaceByHand, false);
  assert.equal(reviewed.replaceAutomatic, false);
});

test("which rows More options shows", () => {
  const base = { handCutEnabled: true, commerceEnabled: true, hasOriginal: true, jobRunning: false };
  assert.deepEqual(moreOptionsView({ ...base, options: opts() }), {
    automatic: true, hand: true, running: false, note: null,
  });
  // Marking by hand only where the account has it.
  assert.deepEqual(moreOptionsView({ ...base, handCutEnabled: false, options: opts() }), {
    automatic: true, hand: false, running: false, note: null,
  });
  // Automatic only where processing is sold.
  assert.deepEqual(moreOptionsView({ ...base, commerceEnabled: false, options: opts() }), {
    automatic: false, hand: true, running: false, note: null,
  });
  // Not live yet (the call failed): only Report a problem.
  assert.deepEqual(moreOptionsView({ ...base, options: null }), {
    automatic: false, hand: false, running: false, note: null,
  });
  // A cut running: its progress, nothing else can start.
  assert.deepEqual(moreOptionsView({ ...base, jobRunning: true, options: opts() }), {
    automatic: false, hand: false, running: true, note: null,
  });
  assert.deepEqual(
    moreOptionsView({ ...base, options: opts({ available: false, reason: "processing" }) }),
    { automatic: false, hand: false, running: true, note: null },
  );
  // The original is gone: said plainly, "no longer stored".
  assert.deepEqual(
    moreOptionsView({ ...base, options: opts({ available: false, reason: "no_source" }) }),
    { automatic: false, hand: false, running: false, note: "The original video is no longer stored." },
  );
  assert.equal(
    moreOptionsView({ ...base, hasOriginal: false, options: opts() }).note,
    "The original video is no longer stored.",
  );
  // A support request in progress (assumption C).
  assert.deepEqual(
    moreOptionsView({ ...base, options: opts({ available: false, reason: "support_request" }) }),
    { automatic: false, hand: false, running: false, note: "Something is already running on this match." },
  );
  // Not ready: nothing to offer and nothing to say.
  assert.deepEqual(
    moreOptionsView({ ...base, options: opts({ available: false, reason: "not_ready" }) }),
    { automatic: false, hand: false, running: false, note: null },
  );
});

test("the choice: Keep by default, Replace says what it deletes", () => {
  const hand = recutChoiceView("hand", opts(), null);
  assert.deepEqual(hand, { replaceEnabled: true, replaceNote: null, selected: "keep", replaceLines: [] });
  assert.deepEqual(recutChoiceView("hand", opts(), "replace"), {
    replaceEnabled: true, replaceNote: null, selected: "replace", replaceLines: [REPLACE_LINE],
  });
  // The second line only when the match has match notes.
  assert.deepEqual(recutChoiceView("hand", opts({ has_match_notes: true }), "replace").replaceLines, [
    REPLACE_LINE,
    MATCH_NOTES_LINE,
  ]);
  assert.equal(REPLACE_LINE, "Points, scores and point notes will be deleted.");
  assert.equal(MATCH_NOTES_LINE, "Match notes stay with the match.");
});

test("the choice: Replace greyed with its reason, or with none for automatic", () => {
  // A coach review: greyed with "Has a coach review", and Keep holds even
  // if Replace had been picked before the review arrived.
  const reviewed = recutChoiceView("hand", opts({ has_coach_review: true }), "replace");
  assert.deepEqual(reviewed, {
    replaceEnabled: false, replaceNote: COACH_REVIEW_NOTE, selected: "keep", replaceLines: [],
  });
  assert.equal(COACH_REVIEW_NOTE, "Has a coach review");
  // Automatic Replace in phase 1: greyed, no line.
  assert.deepEqual(recutChoiceView("automatic", opts(), "replace"), {
    replaceEnabled: false, replaceNote: null, selected: "keep", replaceLines: [],
  });
  // Once the flag is on, automatic Replace works like the hand one.
  assert.equal(recutChoiceView("automatic", opts({ replace_automatic: true }), "replace").selected, "replace");
  // No options at all: Keep, nothing else.
  assert.deepEqual(recutChoiceView("hand", null, "replace"), {
    replaceEnabled: false, replaceNote: null, selected: "keep", replaceLines: [],
  });
});

test("refusals become the contract's sentences", () => {
  // Not an error to show.
  assert.deepEqual(recutClaimError("coach_review"), { code: "coach_review", text: null });
  for (const code of ["support_request", "processing", "already_processing"]) {
    assert.deepEqual(recutClaimError(`P0001: ${code}`), {
      code,
      text: "Something is already running on this match.",
    });
  }
  assert.deepEqual(recutClaimError("no_source"), {
    code: "no_source", text: "The original video is no longer stored.",
  });
  // Everything else keeps the unprocessed page's hand-cut messages.
  assert.equal(recutClaimError("invalid_marks").text, "Some marks are not valid. Check for very short points.");
  assert.equal(recutClaimError("queue_full").text, "Your queue is full. Wait for a video to finish.");
  assert.equal(recutClaimError("").text, "That didn't send. Check your connection and try again.");
  // "processing" inside another word is not the processing code.
  assert.equal(recutClaimError("reprocessing_disabled").code, null);
  assert.equal(handCutClaimError("already_cut"), "This match already has points.");
  assert.equal(handCutClaimError("check_pending"), "Still checking the video. Try again in a moment.");
  assert.equal(processErrorMessage("insufficient_minutes"), "Not enough minutes for this video.");
  assert.equal(processErrorMessage("queue_full"), "Your queue is full. Wait for a video to finish.");
  assert.equal(processErrorMessage(undefined), "Something went wrong. Try again.");
});

test("the Score switch names the pass (Adil, 2026-09-25)", () => {
  assert.deepEqual(scoreSwitchCopy("score", true), {
    label: "Cut and score", line: "Say who won each point as you go.",
  });
  assert.deepEqual(scoreSwitchCopy("cut", true), {
    label: "Cut only", line: "Mark where each rally starts and ends.",
  });
  // Practice and drills, whatever was recorded.
  assert.deepEqual(scoreSwitchCopy("score", false), { label: "Cut only", line: "Scoring is for matches." });
  assert.deepEqual(scoreSwitchCopy("cut", false), { label: "Cut only", line: "Scoring is for matches." });
});

const marks = (spec: [number, number | null, "user" | "opponent" | null, boolean?][]): Mark[] =>
  normalizeMarks(spec.map(([t0, t1, winner, isLet]) => ({ t0, t1, winner, isLet: !!isLet, starred: false })));

test("{N} marked counts only a draft nobody has sent", () => {
  const m = marks([[1, 5, null], [6, 9, "user"], [10, null, null]]);
  assert.equal(unsentMarkCount(m, false), 2);
  // The sent draft that made this match is not work in progress.
  assert.equal(unsentMarkCount(m, true), 0);
  assert.equal(unsentMarkCount([], false), 0);
});

test("a prefill nobody changed is not marking", () => {
  // start_recut wrote this cut's three points as the marks the marker
  // opens on; the player opened it, changed nothing and closed it. The row
  // must not read "3 marked" / "Keep marking" (QA, 2026-09-25, 5e432cde).
  const prefill = marks([[1, 5, "user"], [6, 9, "opponent"], [10, 14, null]]);
  assert.equal(unsentMarkCount(prefill, false, true), 0);
  // Once a save really changes them, the database clears the flag and the
  // marks are the player's own work again.
  assert.equal(unsentMarkCount(prefill, false, false), 3);
  // A sent draft stays history whatever the flag says.
  assert.equal(unsentMarkCount(prefill, true, true), 0);
  assert.equal(unsentMarkCount(prefill, true, false), 0);
  // The flag defaults off, so the unprocessed page's reads are unchanged.
  assert.equal(unsentMarkCount(prefill, false), 3);
});

test("where the switch starts on a processed match", () => {
  const scored = marks([[1, 5, "user"], [6, 9, null]]);
  const cutOnly = marks([[1, 5, null], [6, 9, null]]);
  const base = { draftMarks: [] as Mark[], draftMode: null, draftSubmitted: false, anyCalled: false, scoringAllowed: true };
  // No draft: the pass start_recut will record from the current cut.
  assert.equal(recutStartMode({ ...base, anyCalled: true }), "score");
  assert.equal(recutStartMode(base), "cut");
  // An unsent draft keeps its own pass.
  assert.equal(recutStartMode({ ...base, draftMarks: cutOnly, draftMode: "score", anyCalled: false }), "score");
  assert.equal(recutStartMode({ ...base, draftMarks: scored, anyCalled: false }), "score");
  assert.equal(recutStartMode({ ...base, draftMarks: cutOnly, anyCalled: true }), "cut");
  // A sent draft is history: the current cut decides.
  assert.equal(recutStartMode({ ...base, draftMarks: cutOnly, draftSubmitted: true, anyCalled: true }), "score");
  // Never on for practice.
  assert.equal(recutStartMode({ ...base, anyCalled: true, scoringAllowed: false }), "cut");
});

test("what the claims hand back", () => {
  assert.deepEqual(readRecutClaim({ job_id: "j1", match_id: "m1" }), { jobId: "j1", matchId: "m1" });
  assert.deepEqual(readRecutClaim([{ job_id: null, match_id: "m1" }]), { jobId: null, matchId: "m1" });
  assert.equal(readRecutClaim({ job_id: "j1" }), null);
  assert.equal(readRecutClaim(null), null);
  assert.equal(readCopiedMatchId("m2"), "m2");
  assert.equal(readCopiedMatchId({ copy_match_for_recut: "m3" }), "m3");
  assert.equal(readCopiedMatchId([{ id: "m4" }]), "m4");
  assert.equal(readCopiedMatchId(""), null);
  assert.equal(readCopiedMatchId(null), null);
});

test("start_recut's marks read as marks (tap and rate null, source seconds)", () => {
  const read = normalizeMarks([
    { id: "p1", t0: 12.5, t1: 18.25, winner: "user", isLet: false, starred: true, tap: null, rate: null },
    { id: "p2", t0: 20, t1: 26, winner: null, isLet: true, starred: false, tap: null, rate: null },
  ]);
  assert.deepEqual(read, [
    { id: "p1", t0: 12.5, t1: 18.25, winner: "user", isLet: false, starred: true, tap: 12.5, rate: 1 },
    { id: "p2", t0: 20, t1: 26, winner: null, isLet: true, starred: false, tap: 20, rate: 1 },
  ]);
});
