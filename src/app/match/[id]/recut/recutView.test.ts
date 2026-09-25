import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { handCutClaimError, normalizeMarks, scoreSwitchCopy, type Mark } from "../handCut.ts";
import {
  COACH_REVIEW_NOTE,
  MATCH_NOTES_LINE,
  REPLACE_LINE,
  autoRecutClaimError,
  moreOptionsView,
  processErrorMessage,
  readCopiedMatchId,
  readRecutClaim,
  readRecutOptions,
  recutChoiceView,
  recutClaimError,
  recutStartMode,
  unsentMarkCount,
  wayChoiceView,
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

test("an automatic Replace's refusals: the contract's, then the charge's", () => {
  assert.deepEqual(autoRecutClaimError("coach_review"), { code: "coach_review", text: null });
  for (const code of ["support_request", "processing", "already_processing"]) {
    assert.deepEqual(autoRecutClaimError(`P0001: ${code}`), {
      code,
      text: "Something is already running on this match.",
    });
  }
  assert.deepEqual(autoRecutClaimError("no_source"), {
    code: "no_source", text: "The original video is no longer stored.",
  });
  // The same charge as Process on the unprocessed page, in its words.
  assert.deepEqual(autoRecutClaimError("insufficient_minutes"), {
    code: "insufficient_minutes", text: "Not enough minutes for this video.",
  });
  assert.deepEqual(autoRecutClaimError("queue_full"), {
    code: "queue_full", text: "Your queue is full. Wait for a video to finish.",
  });
  // Never a hand cut's sentence: there are no marks here.
  for (const other of ["", "not_enabled", "trim_too_short", "bad_state", "commerce_disabled"]) {
    assert.deepEqual(autoRecutClaimError(other), { code: null, text: "Something went wrong. Try again." });
  }
});

test("More options: Replace under Automatically calls claim_auto_recut as the contract names it", () => {
  const src = readMatch("recut/MoreOptions.tsx");
  const call = src.slice(src.indexOf('rpc("claim_auto_recut"'), src.indexOf('rpc("claim_auto_recut"') + 400);
  for (const arg of ["p_match_id: match.id", "p_replace: true", "p_trim_start_s: req.trimStartS",
                     "p_trim_end_s: req.trimEndS", "p_strictness: req.strictness"]) {
    assert.ok(call.includes(arg), arg);
  }
  assert.match(src, /const refused = autoRecutClaimError\(error\.message\);/);
  // After Replace the sheet closes and the row shows the running re-cut.
  const after = src.slice(src.indexOf("readRecutClaim(data);", src.indexOf('rpc("claim_auto_recut"')));
  assert.match(after.slice(0, 300), /kind: "match_reprocess"[\s\S]*setOpen\(false\)/);
  // Keep keeps its path: the copy, then /api/process.
  assert.match(src, /rpc\("copy_match_for_recut"/);
  assert.match(src, /postProcess\(target, quote\.request\(\)\)/);
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

test("the two ways are one pick-one group: nothing selected until the player picks (Adil, 2026-09-25)", () => {
  const both = { automatic: true, hand: true, picked: null };
  // Neither way by default, whatever marks are waiting: the hand row's
  // "{N} marked" says so, and nothing shows under the group until a tap.
  assert.deepEqual(wayChoiceView(both), { group: true, selected: null });
  assert.deepEqual(wayChoiceView({ ...both, handDisabled: true }), { group: true, selected: null });
  // The player's own pick holds either way.
  assert.deepEqual(wayChoiceView({ ...both, picked: "hand" }), { group: true, selected: "hand" });
  assert.deepEqual(wayChoiceView({ ...both, picked: "automatic" }), {
    group: true, selected: "automatic",
  });
  // A greyed hand row (the raw page's video will not play here) is never
  // the selection, and does not fall back to Automatically either.
  assert.deepEqual(wayChoiceView({ ...both, handDisabled: true, picked: "hand" }), {
    group: true, selected: null,
  });
  assert.deepEqual(wayChoiceView({ ...both, handDisabled: true, picked: "automatic" }), {
    group: true, selected: "automatic",
  });
});

test("one way on offer: no group, only its content", () => {
  // Everyone without marking by hand: the automatic content alone, even
  // with a stale pick.
  assert.deepEqual(
    wayChoiceView({ automatic: true, hand: false, picked: "hand" }),
    { group: false, selected: "automatic" },
  );
  // More options where processing is not sold: marking by hand alone.
  assert.deepEqual(
    wayChoiceView({ automatic: false, hand: true, picked: null }),
    { group: false, selected: "hand" },
  );
  assert.deepEqual(
    wayChoiceView({ automatic: false, hand: false, picked: null }),
    { group: false, selected: null },
  );
});

const matchDir = join(process.cwd(), "src/app/match/[id]");
const readMatch = (name: string) => readFileSync(join(matchDir, name), "utf8");

test("the group is a radiogroup with arrow keys, and has no chevrons", () => {
  const shared = readMatch("BreakIntoPoints.tsx");
  const group = shared.slice(shared.indexOf("export function WayChoice"), shared.indexOf("export function useProcessQuote"));
  assert.match(group, /role="radiogroup"/);
  assert.match(group, /aria-label=\{label\}/);
  assert.match(group, /role="radio"/);
  assert.match(group, /aria-checked=\{on\}/);
  // One tab stop: the selected row, or the first usable one while
  // nothing is selected.
  assert.match(group, /selected: W \| null;/);
  assert.match(group, /tabIndex=\{tabStop \? 0 : -1\}/);
  assert.match(group, /selected == null \|\| !usable\.includes\(selected\) \? usable\[0\] === way : on/);
  for (const key of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"]) assert.ok(group.includes(key), key);
  assert.doesNotMatch(group, /ExpandChevron|aria-expanded/);
  // The Replace / Keep cells' own dress and radio mark, so the product's
  // two choices read as one pattern.
  assert.match(group, /choiceCellClass\(on, enabled\)/);
  assert.match(group, /<RadioMark on=\{on\} \/>/);
  // The titles and their lines, unchanged, under every title in both
  // places (as on iOS).
  assert.match(shared, /automatic: "Automatically"/);
  assert.match(shared, /hand: "Mark the points yourself"/);
  assert.match(shared, /"We find the rallies and cut them for you\."/);
  assert.match(shared, /"You mark where each point starts and ends\."/);
  assert.match(group, /<span className="mt-0\.5 block text-xs text-zinc-500">\{WAY_DETAIL\[way\]\}<\/span>/);
  assert.doesNotMatch(group, /details &&/);
  // The accordion rows and the one-open-at-a-time logic are gone.
  assert.doesNotMatch(shared, /export function AccordionRow/);
  for (const name of ["RawMatchView.tsx", "recut/MoreOptions.tsx"]) {
    const src = readMatch(name);
    assert.doesNotMatch(src, /AccordionRow|toggleWay|autoOpen|handOpen/, name);
    assert.match(src, /wayChoiceView\(/, name);
    // Only the selected way's content shows.
    assert.match(src, /ways\.selected === "automatic" && \(\s*<AutoProcessPanel/, name);
    assert.match(src, /ways\.selected === "hand" && \([\s\S]{0,40}<MarkYourselfPanel/, name);
    // The group shows with nothing selected; nothing under it until a pick.
    assert.match(src, /ways\.group && \(\s*<WayChoice/, name);
    assert.doesNotMatch(src, /ways\.group && ways\.selected/, name);
    assert.doesNotMatch(src, /markedCount/, name);
  }
});

test("the unprocessed page: the group sits inside Break it into points", () => {
  const src = readMatch("RawMatchView.tsx");
  const card = src.slice(src.indexOf("Break it into points\n"), src.indexOf("<SectionHeading>Tools</SectionHeading>"));
  const open = card.indexOf("{processOpen && (");
  assert.ok(open > 0 && open < card.indexOf("<WayChoice"));
  assert.ok(card.indexOf("<WayChoice") < card.indexOf("<AutoProcessPanel"));
  assert.ok(card.indexOf("<AutoProcessPanel") < card.indexOf("<MarkYourselfPanel"));
  // "{N} marked" on the hand row, and no minutes on Automatically: they
  // are said once, under the button.
  const group = card.slice(card.indexOf("<WayChoice"), card.indexOf("<AutoProcessPanel"));
  assert.doesNotMatch(group, / min`|automatic:/);
  assert.match(group, /`\$\{draftCount\} marked`/);
  // The trim previews the same file the player above shows.
  assert.match(card, /preview=\{\{\s*src: rawUrl,\s*playable: !!rawUrl && !undecodable && hasPicture !== false,\s*aspect: videoAspect,\s*\}\}/);
  // Marking by hand only where the account has it; greyed without a picture.
  assert.match(src, /hand: handCutEnabled && handCutReady,/);
  assert.match(src, /handDisabled: !rawUrl \|\| undecodable,/);
});

test("Replace / Keep share the ways' layout: radio left, title, lines under it", () => {
  const src = readMatch("recut/RecutChoice.tsx");
  const cell = src.slice(src.indexOf("<label"), src.indexOf("</label>"));
  assert.match(cell, /flex items-start gap-3/);
  assert.ok(cell.indexOf("<RadioMark on={on} />") < cell.indexOf("{label}"));
  assert.ok(cell.indexOf("{label}") < cell.indexOf("{lines.map"));
  // The wording is unchanged.
  assert.match(src, /"Replace this match"/);
  assert.match(src, /"Keep this match and add a new one"/);
  const ways = readMatch("BreakIntoPoints.tsx");
  assert.match(ways, /flex w-full items-start gap-3/);
});

test("More options says it processes the match again (Adil, 2026-09-25)", () => {
  const src = readMatch("recut/MoreOptions.tsx");
  const shared = readMatch("BreakIntoPoints.tsx");
  // A section label over the two ways, in the page's own label style.
  assert.match(src, /<SectionHeading[^>]*>Process again<\/SectionHeading>/);
  assert.ok(src.indexOf(">Process again<") < src.indexOf("<WayChoice"));
  assert.ok(src.indexOf("<WayChoice") < src.indexOf("<AutoProcessPanel"));
  assert.ok(src.indexOf("<AutoProcessPanel") < src.indexOf("<MarkYourselfPanel"));
  assert.doesNotMatch(src, /Process automatically/);
  const group = src.slice(src.indexOf("<WayChoice"), src.indexOf("<AutoProcessPanel"));
  assert.match(group, /`\$\{unsent\} marked`/);
  assert.doesNotMatch(group, / min`|automatic:/);
  // No original to mark on: the hand row greys, as on the unprocessed page.
  assert.match(group, /handDisabled=\{rawMissing\}/);
  assert.match(src, /handDisabled: rawMissing,/);
  // The button reads just "Process again"; the unprocessed page "Process".
  // The minutes are on the line under it (minutesUseLine), never on it.
  assert.match(src, /actionLabel="Process again"/);
  assert.match(shared, /actionLabel = "Process"/);
  assert.doesNotMatch(shared, /· \$\{q\.charge\} min|\$\{q\.charge\} min/);
  const panel = shared.slice(shared.indexOf("export function AutoProcessPanel"), shared.indexOf("export function MarkYourselfPanel"));
  assert.match(panel, />\s*\{actionLabel\}\s*<\/button>/);
  assert.match(panel, /const line = minutesUseLine\(q\.charge, q\.availableMinutes, q\.minutesShort\);/);
  assert.ok(panel.indexOf("{actionLabel}") < panel.indexOf("{line.text}"));
  // The out-of-minutes recovery stays where it was, under the line.
  assert.ok(panel.indexOf("{line.text}") < panel.indexOf("<AllowanceRecovery"));
  // Report a problem is its own group below, not under the label (as on
  // iOS): the Process again group closes before it opens.
  const group2 = src.indexOf("{processRows && (");
  const report = src.indexOf(">\n              Report a problem");
  assert.ok(group2 > 0 && report > group2);
  assert.match(src.slice(group2, report), /<\/>\s*\)\}[\s\S]*processRows \? "mt-9 border-b" : "mt-4"/);
});

test("cut strictness is gone from every player surface; new runs ask for normal (Adil, 2026-09-25)", () => {
  const shared = readMatch("BreakIntoPoints.tsx");
  const upload = readFileSync(join(process.cwd(), "src/app/dashboard/UploadCard.tsx"), "utf8");
  for (const [name, src] of [
    ["BreakIntoPoints.tsx", shared],
    ["RawMatchView.tsx", readMatch("RawMatchView.tsx")],
    ["recut/MoreOptions.tsx", readMatch("recut/MoreOptions.tsx")],
    ["UploadCard.tsx", upload],
  ] as const) {
    assert.doesNotMatch(src, /Cut strictness<|setStrictness|STRICTNESS|"Tight"|"Loose"/, name);
  }
  // Every request the product makes says "normal": the process body (which
  // claim_auto_recut also takes, as a required argument), and the legacy
  // upload job's options.
  const quote = shared.slice(shared.indexOf("export function useProcessQuote"), shared.indexOf("export type ProcessQuote"));
  assert.match(quote, /strictness: "normal" as const,/);
  assert.doesNotMatch(quote, /useState<.*Strictness|strictness,\n/);
  assert.equal(upload.split('strictness: "normal",').length - 1, 2);
  assert.doesNotMatch(upload, /f\.strictness|form\.strictness/);
  // A match cut before keeps its stored strictness for the clip padding.
  assert.match(readMatch("page.tsx"), /let strictness = "normal";/);
});

test("one trim with its preview, on all three surfaces (Adil, 2026-09-25)", () => {
  const shared = readMatch("BreakIntoPoints.tsx");
  const upload = readFileSync(join(process.cwd(), "src/app/dashboard/UploadCard.tsx"), "utf8");
  const more = readMatch("recut/MoreOptions.tsx");
  const panel = shared.slice(shared.indexOf("export function AutoProcessPanel"), shared.indexOf("export function MarkYourselfPanel"));
  // The unprocessed page and More options both reach it through
  // AutoProcessPanel; the upload card uses it directly.
  assert.match(panel, /<TrimPreview/);
  assert.doesNotMatch(shared, /<TrimBar|<ClipPlayer/);
  assert.match(upload, /<TrimPreview/);
  assert.doesNotMatch(upload, /<TrimBar|<video/);
  assert.doesNotMatch(more, /OriginalPreview|<ClipPlayer|picture=/);
  assert.match(more, /preview=\{\{\s*src: rawUrl,/);
  // The component itself: the box on a div in the video's shape, the
  // player in its cut mode (no native controls), the player's own clock,
  // seek on drag and exact on release, and the two stamps.
  const tp = readFileSync(join(process.cwd(), "src/components/TrimPreview.tsx"), "utf8");
  assert.match(tp, /style=\{\{ aspectRatio: ratio \}\}/);
  assert.match(tp, /<ClipPlayer[\s\S]*mode="cut"[\s\S]*fill/);
  assert.doesNotMatch(tp, /<video\s|\scontrols[\s=>{]/);
  assert.match(tp, /clock=\{playerClock\}/);
  assert.match(tp, /seeker\.scrub\(v, t\)/);
  assert.match(tp, /onScrubEnd=\{[\s\S]*seeker\.release\(v, t\)/);
  assert.match(tp, />\s*Start here\s*</);
  assert.match(tp, />\s*End here\s*</);
  // A file the browser cannot play: the bar alone, never a broken player.
  assert.match(tp, /const showPicture = playable && !failed && !unavailable;/);
  assert.match(tp, /onMediaError=\{\(\) => setFailed\(true\)\}/);
});
