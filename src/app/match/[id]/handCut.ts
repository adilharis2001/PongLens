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

/** A rally the player has marked. `t1` null means it is still open. */
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

type UndoEntry =
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
} as const;

export interface Applied {
  state: MarkState;
  /** Set when the tap changed nothing and the player must be told why. */
  refused?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function openMark(marks: Mark[]): Mark | null {
  const last = marks[marks.length - 1];
  return last && last.t1 === null ? last : null;
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
 */
export function startMark(
  state: MarkState,
  now: number,
  rate: number,
  id: string
): Applied {
  const t0 = round2(Math.max(0, now - leadFor(rate)));
  const open = openMark(state.marks);

  if (open) {
    if (t0 - open.t0 < MIN_POINT_S) return { state, refused: REFUSE.short };
    const next = state.marks.slice();
    next[next.length - 1] = { ...open, t1: t0 };
    next.push({ id, t0, t1: null, winner: null, isLet: false, starred: false, tap: round2(now), rate });
    return {
      state: {
        marks: next,
        undo: [...state.undo, { type: "start-over", id, prevId: open.id, prevT1: open.t1 }],
        selectedId: null,
        awaitingId: null,
      },
    };
  }

  const end = lastClosedEnd(state.marks);
  if (end !== null && t0 < end) return { state, refused: REFUSE.past };

  return {
    state: {
      marks: [
        ...state.marks,
        { id, t0, t1: null, winner: null, isLet: false, starred: false, tap: round2(now), rate },
      ],
      undo: [...state.undo, { type: "start", id }],
      selectedId: null,
      awaitingId: null,
    },
  };
}

/**
 * End Point.
 *
 * Closes the rally on screen and hands the pad to the answer row, which
 * lights up. Deliberately its own button rather than folded into the
 * winner tiles: ending and judging are two different thoughts, and pairing
 * End Point beside Begin Point is what makes the rhythm learnable.
 */
export function endMark(state: MarkState, now: number): Applied {
  const open = openMark(state.marks);
  if (!open) return { state, refused: REFUSE.noneOpen };

  const t1 = round2(now);
  if (t1 - open.t0 < MIN_POINT_S) return { state, refused: REFUSE.short };
  const next = state.marks.slice();
  next[next.length - 1] = { ...open, t1 };
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

export function selectMark(state: MarkState, id: string | null): MarkState {
  return { ...state, selectedId: state.selectedId === id ? null : id };
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
  if (prev && prev.t1 !== null && t0 < prev.t1) return { state, refused: REFUSE.inside };
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
  return { marks, undo, selectedId: state.selectedId, awaitingId: null };
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
 */
export function validate(
  marks: Mark[],
  durationS: number | null
): { ok: true } | { ok: false; reason: string } {
  const rows = submittable(marks);
  if (rows.length === 0) return { ok: false, reason: "Nothing marked yet." };
  if (rows.length > 400) return { ok: false, reason: "That is more than 400 points." };
  let prev = -Infinity;
  for (const r of rows) {
    if (!(r.t0 >= 0) || !(r.t1 > r.t0)) return { ok: false, reason: "A point has no length." };
    if (r.t1 - r.t0 < MIN_POINT_S) return { ok: false, reason: REFUSE.short };
    if (r.t0 < prev) return { ok: false, reason: "Two points overlap." };
    if (durationS !== null && r.t1 > durationS + 0.5) {
      return { ok: false, reason: "A point runs past the end of the video." };
    }
    if (r.w !== null && r.let) return { ok: false, reason: "A point is both a let and a win." };
    prev = r.t1;
  }
  return { ok: true };
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
