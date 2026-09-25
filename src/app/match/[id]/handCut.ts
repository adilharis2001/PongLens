/**
 * Marking a match by hand: the whole rule, with no React and no clocks of
 * its own.
 *
 * The player watches their own upload and taps three times per rally:
 * Begin Point as the serve goes up, End Point when it finishes, then who
 * won it. This module owns what each tap MEANS. It holds no video, reads no time, and touches no network, so the
 * rhythm of the thing can be tested by replaying a list of taps.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT KNOW:
 *
 *   cut_t0, cut segments, and which seconds the cut video keeps.
 *
 * Those are the cut-clock geometry, and the worker computes them ONCE
 * through the same three functions the automatic pipeline uses
 * (play_cut_segments / segment_cut_offsets / cut_position in
 * points_pipeline.py). The app never re-derives them. That is the whole
 * mitigation for the failure this codebase has already paid for twice: one
 * rule written in two places drifts, and the placement mirror survived
 * eight months exactly that way. Keeping the shared rule down to "what does
 * a tap mean" is what makes the second copy small enough to trust.
 *
 * A mark is in SOURCE seconds — the original upload's own clock, which is
 * the only clock that exists while marking. There is no cut video yet.
 */

import type { MatchServer } from "./serving";

/**
 * A rally the player has marked. `t1` null means it is still open.
 *
 * The list is always ordered by `t0`. At most one mark is open, and it is
 * usually the last one, but not always: a point removed from the middle of
 * the strip ("Mark again") is marked again in the gap it left, so the open
 * rally can sit between two closed ones until it is ended.
 */
export interface Mark {
  /** Stable within the session; the worker assigns the real row ids. */
  id: string;
  /** Source seconds. Already carries the backward lead — see `leadFor`. */
  t0: number;
  t1: number | null;
  winner: MatchServer | null;
  isLet: boolean;
  starred: boolean;
  /** The raw playhead at the start tap, before the lead was applied, and
   *  the rate it was tapped at. Kept so the lead constant can be measured
   *  against real sessions later without a schema change. */
  tap: number;
  rate: number;
}

/** What the three answer buttons say. Closing a point is a separate tap
 *  (End Point), so there is no "end" outcome: a point closed and never
 *  answered is simply unscored, which the strip already draws as dashed. */
export type Outcome = "user" | "opponent" | "let";

export type UndoEntry =
  | { type: "start"; id: string }
  | { type: "start-over"; id: string; prevId: string; prevT1: number | null }
  | { type: "end"; id: string; t1: number | null; winner: MatchServer | null; isLet: boolean }
  | { type: "outcome"; id: string; winner: MatchServer | null; isLet: boolean }
  | { type: "star"; id: string; starred: boolean }
  | { type: "move"; id: string; t0: number; t1: number | null }
  | { type: "remove"; index: number; mark: Mark };

export interface MarkState {
  marks: Mark[];
  undo: UndoEntry[];
  /** A closed chip the player tapped, so the answer buttons retarget it. */
  selectedId: string | null;
  /**
   * The point just closed by End Point and not yet answered. This is what
   * the answer row lights up FOR: after ending a rally the next input is
   * who won it, and the pad says so rather than leaving the player to
   * work it out. Cleared by an answer, by starting the next point, or by
   * undo.
   */
  awaitingId: string | null;
}

export const emptyState: MarkState = {
  marks: [],
  undo: [],
  selectedId: null,
  awaitingId: null,
};

/**
 * A rally shorter than this is a mis-tap, not a point. The same floor the
 * client and the database both apply, so nothing is ever silently dropped
 * between them: the tap is refused where the player can see it.
 */
export const MIN_POINT_S = 0.7;

/**
 * Not a refusal — an allowance. A forgotten end produces one of these and
 * the save sheet names the count, because the player should see it before
 * committing rather than discover it in the finished match.
 */
export const MAX_POINT_S = 120;

/**
 * The bounds `claim_hand_cut` refuses a whole submission over
 * (supabase/migrations/20260908143746_hand_cut.sql). `validate` applies the
 * same three numbers, so a pass the client accepts is never turned away by
 * the server with a message the player cannot act on.
 *
 * LONGEST_POINT_S is a refusal, unlike MAX_POINT_S above, which only warns.
 */
export const MAX_MARKS = 400;
export const LONGEST_POINT_S = 180;
export const PAST_END_ALLOWANCE_S = 1;

/**
 * The backward lead on a START tap.
 *
 * Not a new constant: `SPLIT_LEAD_S` is already in Player.tsx and mirrored
 * in Core/Playhead.swift, written for this exact gesture — the tap lands a
 * beat AFTER the thing it marks. A third value for one human fact is the
 * shape of the placement mirror bug, so this reuses it.
 *
 * It scales with the playback rate because a 0.3s human delay is 0.6s of
 * VIDEO at 2x, and it is clamped so the 1.2s pre pad the clip is cut with
 * can never be double-counted.
 */
export const SPLIT_LEAD_S = 0.6;
export const LEAD_MIN_S = 0.6;
export const LEAD_MAX_S = 1.2;

export function leadFor(rate: number): number {
  const r = Number.isFinite(rate) && rate > 0 ? rate : 1;
  return Math.min(LEAD_MAX_S, Math.max(LEAD_MIN_S, SPLIT_LEAD_S * r));
}

/**
 * The END tap gets NO lead, and that is measured rather than assumed.
 * playhead.ts records the boundary study: a winner tap lands at the rally's
 * true end at the median and up to 0.7s EARLY. Subtracting anything would
 * make it worse. The 1.3s post pad covers both directions.
 */

/** Refusals the player sees, inline, for a beat. Never a dialog. */
export const REFUSE = {
  short: "Too short to be a point.",
  noneOpen: "No point open.",
  noneEnded: "End the point first.",
  inside: "That's inside the last point.",
  past: "That's before the last point ended.",
  /** A start inside a point other than the last one. Only a seek back
   *  reaches it, since starting in the gaps between points is allowed. */
  insideAnother: "That's inside another point.",
  /** A rally marked into a gap has to end before the next point starts. */
  intoNext: "That runs into the next point.",
} as const;

export type RefusalKey = keyof typeof REFUSE;

/** Why `validate` refuses a submission, word for word. */
export const INVALID = {
  empty: "Nothing marked yet.",
  tooMany: "That is more than 400 points.",
  noLength: "A point has no length.",
  short: REFUSE.short,
  tooLong: "A point is over three minutes long.",
  overlap: "Two points overlap.",
  pastEnd: "A point runs past the end of the video.",
  letAndWin: "A point is both a let and a win.",
} as const;

export interface Applied {
  state: MarkState;
  /** Set when the tap changed nothing and the player must be told why. */
  refused?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The rally in progress, wherever it sits in the list. */
export function openMark(marks: Mark[]): Mark | null {
  for (const m of marks) if (m.t1 === null) return m;
  return null;
}

/** The first closed mark at or after index `from`. */
function nextClosed(marks: Mark[], from: number): Mark | null {
  for (let i = Math.max(0, from); i < marks.length; i++) {
    if (marks[i].t1 !== null) return marks[i];
  }
  return null;
}

/** The last closed mark before index `before`. */
function prevClosed(marks: Mark[], before: number): Mark | null {
  for (let i = Math.min(before, marks.length) - 1; i >= 0; i--) {
    if (marks[i].t1 !== null) return marks[i];
  }
  return null;
}

/**
 * The closed mark `t` falls inside. The start is inside and the end is
 * not, so a start exactly where a point ended sits beside it, which is how
 * a forgotten end leaves two points.
 */
function closedAt(marks: Mark[], t: number): Mark | null {
  for (const m of marks) {
    if (m.t1 !== null && m.t0 <= t && t < m.t1) return m;
  }
  return null;
}

/** Where a mark starting at `t0` goes: after every mark starting no later. */
function insertionIndex(marks: Mark[], t0: number): number {
  let i = marks.length;
  while (i > 0 && marks[i - 1].t0 > t0) i--;
  return i;
}

/**
 * The first closed point still waiting for a winner, scanning after
 * `afterId` when given. A let is scored: nobody won it, and that is the
 * answer. Null when every point has its answer.
 */
export function firstUnscored(
  marks: Mark[],
  afterId: string | null = null
): Mark | null {
  let past = afterId === null;
  for (const m of marks) {
    if (!past) {
      if (m.id === afterId) past = true;
      continue;
    }
    if (m.t1 !== null && !m.isLet && m.winner === null) return m;
  }
  return null;
}

/**
 * A hole in the strip wide enough to offer a new point in. The same
 * number the scorekeeper's own insert affordance uses, so a gap that
 * invites a rally there invites one here.
 */
export const GAP_WORTH_MARKING_S = 4;

export interface Gap {
  /** Source seconds a new point may occupy, exclusive of its neighbours. */
  lo: number;
  hi: number;
}

/**
 * Where a rally could be added on either side of one point.
 *
 * Only ever asked about the point being stood on, because a "+" beside
 * every chip is a row of plus signs rather than an offer. Before the
 * first point the window opens at zero; after the last it runs to the end
 * of the video, and with no duration to bound it there is no offer.
 *
 * A rally still open owns the time from its start until it is ended, so
 * no gap runs across one: the gap before an open rally stops at its
 * start, and there is none between an open rally and the point after it.
 */
export function gapsAround(
  marks: Mark[],
  id: string | null,
  durationS: number | null
): { before: Gap | null; after: Gap | null } {
  const none = { before: null, after: null };
  if (!id) return none;
  const i = marks.findIndex((m) => m.id === id);
  if (i < 0) return none;
  const m = marks[i];
  if (m.t1 === null) return none;
  const wide = (lo: number, hi: number): Gap | null =>
    hi - lo >= GAP_WORTH_MARKING_S ? { lo, hi } : null;
  const prev = i > 0 ? marks[i - 1] : null;
  const next = i + 1 < marks.length ? marks[i + 1] : null;
  const before =
    prev === null ? wide(0, m.t0) : prev.t1 === null ? null : wide(prev.t1, m.t0);
  const nextStart =
    next !== null
      ? next.t0
      : durationS !== null && durationS > 0
        ? durationS
        : null;
  return {
    before,
    after: nextStart === null ? null : wide(m.t1, nextStart),
  };
}

/**
 * A rally the first pass went past, put back in its place.
 *
 * Ordered by t0 like every other mark, so the strip, the score and the
 * worker's segments all read it the same way, and undone by the same
 * entry a fresh start uses.
 */
export function insertMark(
  state: MarkState,
  t0: number,
  t1: number,
  id: string
): Applied {
  if (!(t1 - t0 >= MIN_POINT_S)) return { state, refused: REFUSE.short };
  const clash = state.marks.some(
    (m) => m.t1 !== null && t0 < m.t1 && m.t0 < t1
  );
  if (clash) return { state, refused: REFUSE.inside };
  // The open rally owns everything from its start to the next closed
  // point, because nobody knows yet where it ends.
  const open = openMark(state.marks);
  if (open) {
    const after = nextClosed(state.marks, state.marks.indexOf(open) + 1);
    const owned = after ? after.t0 : Infinity;
    if (t1 > open.t0 && t0 < owned) return { state, refused: REFUSE.inside };
  }
  const mark: Mark = {
    id,
    t0,
    t1,
    winner: null,
    isLet: false,
    starred: false,
    tap: t0,
    rate: 1,
  };
  const marks = [...state.marks, mark].sort((a, b) => a.t0 - b.t0);
  return {
    state: {
      marks,
      undo: [...state.undo, { type: "start", id }],
      selectedId: id,
      awaitingId: null,
    },
  };
}

/** Video left after the last point that still counts as "marked to the
 *  end": time enough to walk off and stop the recording, not time enough
 *  for another rally to have gone unmarked. */
export const TAIL_S = 45;

/** Cutting only, or cutting and scoring. */
export type CutMode = "cut" | "score";

/**
 * Which pass a draft is, read from the row where the choice was recorded.
 *
 * A draft written before the choice was recorded has to be inferred, and
 * the only honest signal is whether anything was ever called: one winner
 * anywhere means someone was scoring, none at all across a whole pass
 * means they were not. Guessing "scoring" instead is what put a cut-only
 * pass into a scoring screen over points its owner had deliberately left
 * uncalled.
 */
export function draftMode(marks: Mark[], recorded: CutMode | null): CutMode {
  if (recorded) return recorded;
  return marks.some((m) => m.isLet || m.winner !== null) ? "score" : "cut";
}

/** What the pad is on the way in. */
export type OpenAs =
  /** Nothing marked: the cutting gate. */
  | "fresh"
  /** Points still without a winner: the scoring pass, from the first one. */
  | "scoring"
  /** Every point called and the tape ends with them: a review from point one. */
  | "review"
  /** Every point called but the match runs on: ask which one they came back for. */
  | "choice";

/**
 * Which of the four a reopened draft is.
 *
 * Called is not the same as finished, and conflating them was a real bug:
 * ten rallies marked and called at the front of a long match is a pass
 * someone walked away from, not a match to sit and watch. What separates
 * them is how much tape is left after the last point. With no duration to
 * measure against, ask rather than guess.
 */
export function openAs(
  marks: Mark[],
  durationS: number | null,
  mode: CutMode = "score"
): OpenAs {
  if (marks.length === 0) return "fresh";
  // A cut-only pass has nothing to answer, so it is never a scoring pass
  // however few of its points carry a winner.
  if (mode === "score" && !allCalled(marks)) return "scoring";
  if (durationS === null || !(durationS > 0)) return "choice";
  const end = lastClosedEnd(marks) ?? 0;
  return durationS - end <= TAIL_S ? "review" : "choice";
}

/**
 * Every point closed and every point called: nothing left to mark and
 * nothing left to answer. An empty list is not finished, it is unstarted.
 * A let counts as called — nobody won it, and that is the answer.
 */
export function allCalled(marks: Mark[]): boolean {
  return (
    marks.length > 0 &&
    marks.every((m) => m.t1 !== null && (m.isLet || m.winner !== null))
  );
}

export function lastClosedEnd(marks: Mark[]): number | null {
  for (let i = marks.length - 1; i >= 0; i--) {
    const t1 = marks[i].t1;
    if (t1 !== null) return t1;
  }
  return null;
}

/**
 * Point starts.
 *
 * With a point already open this is a forgotten end, not an error: the open
 * point closes AT THE NEW MARK, unscored, and a new one opens at the same
 * instant. They abut exactly, which is what keeps the list ordered — the
 * alternative (closing at the raw tap) puts the previous end after the new
 * start and breaks the one invariant everything downstream leans on.
 *
 * With nothing open, a start is allowed anywhere that is not inside a
 * closed point, including a gap between two of them. That is what lets
 * "Mark again" work on any point, not only the last: the point comes out,
 * the player plays the gap back, and Begin lands in it. The new rally is
 * placed in order, so it can sit between closed points until it is ended.
 * Either way the new rally needs room to become a point before the next
 * closed one starts, or it could never be ended.
 */
export function startMark(
  state: MarkState,
  now: number,
  rate: number,
  id: string
): Applied {
  const t0 = round2(Math.max(0, now - leadFor(rate)));
  const open = openMark(state.marks);
  const fresh: Mark = {
    id,
    t0,
    t1: null,
    winner: null,
    isLet: false,
    starred: false,
    tap: round2(now),
    rate,
  };

  if (open) {
    const i = state.marks.indexOf(open);
    if (t0 - open.t0 < MIN_POINT_S) return { state, refused: REFUSE.short };
    const after = nextClosed(state.marks, i + 1);
    if (after && after.t0 - t0 < MIN_POINT_S) {
      return { state, refused: REFUSE.intoNext };
    }
    const next = state.marks.slice();
    next[i] = { ...open, t1: t0 };
    next.splice(i + 1, 0, fresh);
    return {
      state: {
        marks: next,
        undo: [...state.undo, { type: "start-over", id, prevId: open.id, prevT1: open.t1 }],
        selectedId: null,
        awaitingId: null,
      },
    };
  }

  const hit = closedAt(state.marks, t0);
  if (hit) {
    const last = prevClosed(state.marks, state.marks.length);
    return {
      state,
      refused: hit === last ? REFUSE.past : REFUSE.insideAnother,
    };
  }
  const at = insertionIndex(state.marks, t0);
  const after = nextClosed(state.marks, at);
  if (after && after.t0 - t0 < MIN_POINT_S) {
    return { state, refused: REFUSE.intoNext };
  }

  const marks = state.marks.slice();
  marks.splice(at, 0, fresh);
  return {
    state: {
      marks,
      undo: [...state.undo, { type: "start", id }],
      selectedId: null,
      awaitingId: null,
    },
  };
}

/**
 * Reset: the Begin tap was too early.
 *
 * Throws away the rally that is open and hands back the second the last
 * finished point ended, so the caller can rewind there and let the run-up
 * play again. Nothing else moves: earlier points, their answers and the
 * score are all untouched.
 *
 * This is what the left button means while a point is open. Pressing Begin
 * again to mean "I forgot the end" is the rarer mistake and it has Undo;
 * pressing Begin a beat too early happens constantly, and until now it
 * could only be fixed by ending a rally that had not started.
 *
 * "The last finished point" is the one before the open rally. For a rally
 * marked into a gap that is the point before the gap, not the last point
 * of the match, so Reset replays the run-up it was marking.
 */
export function resetOpen(state: MarkState): { state: MarkState; backTo: number } {
  const open = openMark(state.marks);
  if (!open) return { state, backTo: lastClosedEnd(state.marks) ?? 0 };
  const i = state.marks.indexOf(open);
  const backTo = prevClosed(state.marks, i)?.t1 ?? 0;
  const marks = state.marks.slice();
  marks.splice(i, 1);
  // A "remove" entry, not a "start" one: undoing a start DELETES the mark,
  // and Reset has already done that. What undo has to do here is put the
  // open rally back exactly as it was.
  return {
    state: {
      marks,
      undo: [...state.undo, { type: "remove", index: i, mark: open }],
      selectedId: state.selectedId === open.id ? null : state.selectedId,
      awaitingId: state.awaitingId === open.id ? null : state.awaitingId,
    },
    backTo,
  };
}

/**
 * End Point.
 *
 * Closes the rally on screen and hands the pad to the answer row, which
 * lights up. Deliberately its own button rather than folded into the
 * winner tiles: ending and judging are two different thoughts, and pairing
 * End Point beside Begin Point is what makes the rhythm learnable.
 *
 * A rally marked into a gap must end by the time the next point starts.
 * Ending exactly there is allowed; the two sit side by side.
 */
export function endMark(state: MarkState, now: number): Applied {
  const open = openMark(state.marks);
  if (!open) return { state, refused: REFUSE.noneOpen };
  const i = state.marks.indexOf(open);

  const t1 = round2(now);
  if (t1 - open.t0 < MIN_POINT_S) return { state, refused: REFUSE.short };
  const after = nextClosed(state.marks, i + 1);
  if (after && t1 > after.t0) return { state, refused: REFUSE.intoNext };
  const next = state.marks.slice();
  next[i] = { ...open, t1 };
  return {
    state: {
      marks: next,
      undo: [
        ...state.undo,
        { type: "end", id: open.id, t1: open.t1, winner: open.winner, isLet: open.isLet },
      ],
      selectedId: null,
      awaitingId: open.id,
    },
  };
}

/**
 * Me / Them / Let.
 *
 * Answers the point just ended, or a chip the player selected. Never the
 * rally still in progress: a point is judged after it finishes, so an
 * answer while one is open would be about a rally nobody has seen the end
 * of. Tapping the answer a point already carries clears it, the same
 * toggle the scorekeeper's winner tiles have always had.
 */
export function setOutcome(state: MarkState, outcome: Outcome): Applied {
  const id = state.awaitingId ?? state.selectedId;
  if (!id) return { state, refused: REFUSE.noneEnded };
  const i = state.marks.findIndex((m) => m.id === id);
  if (i < 0) return { state, refused: REFUSE.noneEnded };

  const m = state.marks[i];
  if (m.t1 === null) return { state, refused: REFUSE.noneEnded };
  const wanted = outcome === "let" ? null : outcome;
  const sameWinner = wanted !== null && m.winner === wanted && !m.isLet;
  const sameLet = outcome === "let" && m.isLet;
  const next = state.marks.slice();
  next[i] = {
    ...m,
    winner: sameWinner ? null : wanted,
    isLet: sameLet ? false : outcome === "let",
  };
  return {
    state: {
      marks: next,
      undo: [...state.undo, { type: "outcome", id: m.id, winner: m.winner, isLet: m.isLet }],
      selectedId: state.selectedId,
      // Answered, so the row stops asking.
      awaitingId: null,
    },
  };
}

export function toggleStar(state: MarkState, id: string): Applied {
  const i = state.marks.findIndex((m) => m.id === id);
  if (i < 0) return { state };
  const next = state.marks.slice();
  next[i] = { ...next[i], starred: !next[i].starred };
  return {
    state: {
      marks: next,
      undo: [...state.undo, { type: "star", id, starred: state.marks[i].starred }],
      selectedId: state.selectedId,
      awaitingId: state.awaitingId,
    },
  };
}

/**
 * Stop asking who won, without answering.
 *
 * The player moved on instead. The point stays closed and uncalled, which
 * the strip already draws as a dashed chip and Keep score will ask about
 * later; the brief was always that the answer is optional.
 */
export function clearAwaiting(state: MarkState): MarkState {
  if (state.awaitingId === null) return state;
  return { ...state, awaitingId: null };
}

export function selectMark(state: MarkState, id: string | null): MarkState {
  return { ...state, selectedId: state.selectedId === id ? null : id };
}

/**
 * Would a closed mark starting at `t0` cross the mark before it? A closed
 * neighbour is crossed at its end. An open one (a rally being marked into
 * the gap before this point) still needs room to be ended, so this point
 * may not start within MIN_POINT_S of it.
 */
function crossesPrev(prev: Mark | undefined, t0: number): boolean {
  if (!prev) return false;
  if (prev.t1 !== null) return t0 < prev.t1;
  return t0 - prev.t0 < MIN_POINT_S;
}

/**
 * Nudge one edge of a closed mark. Refuses rather than clamping: a control
 * that silently does nothing at a limit is one the player keeps pressing.
 */
export function moveEdge(
  state: MarkState,
  id: string,
  edge: "t0" | "t1",
  delta: number
): Applied {
  const i = state.marks.findIndex((m) => m.id === id);
  if (i < 0) return { state };
  const m = state.marks[i];
  if (m.t1 === null) return { state };

  const t0 = edge === "t0" ? round2(Math.max(0, m.t0 + delta)) : m.t0;
  const t1 = edge === "t1" ? round2(m.t1 + delta) : m.t1;
  if (t1 - t0 < MIN_POINT_S) return { state, refused: REFUSE.short };

  const prev = state.marks[i - 1];
  const nextM = state.marks[i + 1];
  if (crossesPrev(prev, t0)) return { state, refused: REFUSE.inside };
  if (nextM && t1 > nextM.t0) return { state, refused: REFUSE.inside };

  const next = state.marks.slice();
  next[i] = { ...m, t0, t1 };
  return {
    state: {
      marks: next,
      undo: [...state.undo, { type: "move", id, t0: m.t0, t1: m.t1 }],
      selectedId: state.selectedId,
      awaitingId: state.awaitingId,
    },
  };
}

/**
 * Set both edges of a closed mark at once, from the Adjust sheet.
 *
 * `moveEdge` nudges one edge by a step; this takes the pair a drag
 * produced. Same guards either way: never shorter than a point, never
 * across a neighbour, because the list stays ordered by start and the
 * worker's segment arithmetic assumes it.
 */
export function setEdges(
  state: MarkState,
  id: string,
  t0: number,
  t1: number
): Applied {
  const i = state.marks.findIndex((m) => m.id === id);
  if (i < 0) return { state };
  const m = state.marks[i];
  if (m.t1 === null) return { state };

  const a = round2(Math.max(0, t0));
  const b = round2(t1);
  if (b - a < MIN_POINT_S) return { state, refused: REFUSE.short };

  const prev = state.marks[i - 1];
  const next = state.marks[i + 1];
  if (crossesPrev(prev, a)) return { state, refused: REFUSE.inside };
  if (next && b > next.t0) return { state, refused: REFUSE.inside };

  const marks = state.marks.slice();
  marks[i] = { ...m, t0: a, t1: b };
  return {
    state: {
      marks,
      undo: [...state.undo, { type: "move", id, t0: m.t0, t1: m.t1 }],
      selectedId: state.selectedId,
      awaitingId: state.awaitingId,
    },
  };
}

export function removeMark(state: MarkState, id: string): Applied {
  const i = state.marks.findIndex((m) => m.id === id);
  if (i < 0) return { state };
  const next = state.marks.slice();
  const [gone] = next.splice(i, 1);
  return {
    state: {
      marks: next,
      undo: [...state.undo, { type: "remove", index: i, mark: gone }],
      selectedId: state.selectedId === id ? null : state.selectedId,
      awaitingId: state.awaitingId === id ? null : state.awaitingId,
    },
  };
}

/** One step back, across every action type. */
export function undoLast(state: MarkState): MarkState {
  const entry = state.undo[state.undo.length - 1];
  if (!entry) return state;
  const undo = state.undo.slice(0, -1);
  const marks = state.marks.slice();
  const at = (id: string) => marks.findIndex((m) => m.id === id);

  switch (entry.type) {
    case "start": {
      const i = at(entry.id);
      if (i >= 0) marks.splice(i, 1);
      break;
    }
    case "start-over": {
      const i = at(entry.id);
      if (i >= 0) marks.splice(i, 1);
      const p = at(entry.prevId);
      if (p >= 0) marks[p] = { ...marks[p], t1: entry.prevT1 };
      break;
    }
    case "end": {
      const i = at(entry.id);
      if (i >= 0) marks[i] = { ...marks[i], t1: entry.t1, winner: entry.winner, isLet: entry.isLet };
      break;
    }
    case "outcome": {
      const i = at(entry.id);
      if (i >= 0) marks[i] = { ...marks[i], winner: entry.winner, isLet: entry.isLet };
      break;
    }
    case "star": {
      const i = at(entry.id);
      if (i >= 0) marks[i] = { ...marks[i], starred: entry.starred };
      break;
    }
    case "move": {
      const i = at(entry.id);
      if (i >= 0) marks[i] = { ...marks[i], t0: entry.t0, t1: entry.t1 };
      break;
    }
    case "remove":
      marks.splice(entry.index, 0, entry.mark);
      break;
  }
  // Undoing a start or an insert takes the point away, and undoing an end
  // reopens it. A selection is always a closed point, so one left on a
  // point that is gone or open again would aim the answers at nothing, or
  // at a rally nobody has seen the end of.
  const selectedId =
    state.selectedId !== null &&
    marks.some((m) => m.id === state.selectedId && m.t1 !== null)
      ? state.selectedId
      : null;
  return { marks, undo, selectedId, awaitingId: null };
}

export interface MarkSummary {
  /** Closed marks, which are the only ones that become points. */
  total: number;
  /** Closed, not a let, no winner: they cut fine and get called later. */
  unscored: number;
  /** A start with no end. Dropped on submit, and named before it is. */
  open: boolean;
  /** Closed marks longer than MAX_POINT_S, almost always a forgotten end. */
  long: number;
  starred: number;
}

export function summarize(marks: Mark[]): MarkSummary {
  let total = 0;
  let unscored = 0;
  let long = 0;
  let starred = 0;
  for (const m of marks) {
    if (m.t1 === null) continue;
    total += 1;
    if (!m.isLet && m.winner === null) unscored += 1;
    if (m.t1 - m.t0 > MAX_POINT_S) long += 1;
    if (m.starred) starred += 1;
  }
  return { total, unscored, open: openMark(marks) !== null, long, starred };
}

/** What goes to `claim_hand_cut`: closed marks only, ordered, terse. */
export function submittable(marks: Mark[]): {
  t0: number;
  t1: number;
  w: MatchServer | null;
  let: boolean;
  star: boolean;
  tap: number;
  rate: number;
}[] {
  return marks
    .filter((m): m is Mark & { t1: number } => m.t1 !== null)
    .sort((a, b) => a.t0 - b.t0)
    .map((m) => ({
      t0: m.t0,
      t1: m.t1,
      w: m.winner,
      let: m.isLet,
      star: m.starred,
      tap: m.tap,
      rate: m.rate,
    }));
}

/**
 * The same bounds `claim_hand_cut` applies, so the two can never disagree
 * about what is valid. The client refuses at the tap; this is the check
 * before submitting, not a second opinion.
 *
 * Every bound the server refuses is here with the server's own number:
 * at most MAX_MARKS points, none shorter than MIN_POINT_S or longer than
 * LONGEST_POINT_S, none overlapping, and none ending more than
 * PAST_END_ALLOWANCE_S past the video. The duration here is the player's
 * own reading of the file; the server checks against the match row's.
 */
export function validate(
  marks: Mark[],
  durationS: number | null
): { ok: true } | { ok: false; reason: string } {
  const bad = (reason: string) => ({ ok: false as const, reason });
  const rows = submittable(marks);
  if (rows.length === 0) return bad(INVALID.empty);
  if (rows.length > MAX_MARKS) return bad(INVALID.tooMany);
  let prev = -Infinity;
  for (const r of rows) {
    if (!(r.t0 >= 0) || !(r.t1 > r.t0)) return bad(INVALID.noLength);
    if (r.t1 - r.t0 < MIN_POINT_S) return bad(INVALID.short);
    if (r.t1 - r.t0 > LONGEST_POINT_S) return bad(INVALID.tooLong);
    if (r.t0 < prev) return bad(INVALID.overlap);
    if (durationS !== null && r.t1 > durationS + PAST_END_ALLOWANCE_S) {
      return bad(INVALID.pastEnd);
    }
    if (r.w !== null && r.let) return bad(INVALID.letAndWin);
    prev = r.t1;
  }
  return { ok: true };
}

/**
 * A stored draft, read back as marks.
 *
 * `hand_cut_drafts.marks` holds two shapes. A draft saved while marking
 * holds full marks. A draft handed back after a failed cut holds what
 * `claim_hand_cut` was sent, the short form from `submittable`:
 * `{t0, t1, w, let, star, tap, rate}` with no id. Passed straight in as
 * marks, the short form has no `winner` field, so every point reads as
 * called and the pass reopens as a finished review.
 *
 * Both shapes are read here. An entry that is not an object, or whose
 * times are not numbers, is dropped. A winner other than "user" or
 * "opponent" is read as uncalled rather than dropping the rally with it.
 * Marks come back ordered by start with at most one still open (the
 * latest), and an open one carries no answer. A missing or repeated id is
 * replaced with `d1`, `d2` and so on
 * in order, so the same draft always reads back with the same ids.
 */
export function normalizeMarks(raw: unknown): Mark[] {
  if (!Array.isArray(raw)) return [];
  const read: (Omit<Mark, "id"> & { id: string | null })[] = [];
  for (const entry of raw) {
    const m = readMark(entry);
    if (m) read.push(m);
  }
  // Array.prototype.sort is stable, so marks that share a start keep the
  // order they were stored in.
  read.sort((a, b) => a.t0 - b.t0);

  let keepOpen = -1;
  for (let i = read.length - 1; i >= 0; i--) {
    if (read[i].t1 === null) {
      keepOpen = i;
      break;
    }
  }
  const kept = read.filter((m, i) => m.t1 !== null || i === keepOpen);

  const given = new Set(
    kept.map((m) => m.id).filter((id): id is string => id !== null)
  );
  const used = new Set<string>();
  let n = 0;
  return kept.map((m) => {
    let id = m.id;
    if (id === null || used.has(id)) {
      do id = `d${++n}`;
      while (given.has(id) || used.has(id));
    }
    used.add(id);
    return { ...m, id };
  });
}

function readMark(entry: unknown): (Omit<Mark, "id"> & { id: string | null }) | null {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return null;
  }
  const r = entry as Record<string, unknown>;
  const finite = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v);
  if (!finite(r.t0)) return null;
  const t0 = r.t0;
  let t1: number | null;
  if (r.t1 === null) t1 = null;
  else if (finite(r.t1)) t1 = r.t1;
  else return null;
  const w = r.winner !== undefined ? r.winner : r.w;
  const isLet = r.isLet !== undefined ? r.isLet : r.let;
  const starred = r.starred !== undefined ? r.starred : r.star;
  // A rally still open has not been answered, whatever the row says.
  const answered = t1 !== null;
  return {
    id: typeof r.id === "string" && r.id.length > 0 ? r.id : null,
    t0,
    t1,
    winner: answered && (w === "user" || w === "opponent") ? w : null,
    isLet: answered && isLet === true,
    starred: starred === true,
    tap: finite(r.tap) ? r.tap : t0,
    rate: finite(r.rate) && r.rate > 0 ? r.rate : 1,
  };
}

/**
 * Marks as the shape `computeServing` and `computeMatchScore` read.
 *
 * Those two are the ITTF rotation and the game walk the whole product runs
 * on, and CLAUDE.md's rule is that the rotation is never re-derived. So the
 * ticker here does not compute a score: it borrows the product's own, by
 * handing it the six fields it actually reads.
 */
export function asPoints(marks: Mark[]): {
  id: string;
  confirmed_winner: MatchServer | null;
  is_let: boolean;
  server_override: MatchServer | null;
  game_end_override: null;
  game_winner_override: null;
}[] {
  return marks
    .filter((m) => m.t1 !== null)
    .map((m) => ({
      id: m.id,
      confirmed_winner: m.winner,
      is_let: m.isLet,
      server_override: null,
      game_end_override: null,
      game_winner_override: null,
    }));
}
