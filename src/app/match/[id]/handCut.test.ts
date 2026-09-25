import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";

import {
  type Mark,
  allCalled,
  clearAwaiting,
  draftMode,
  firstUnscored,
  gapsAround,
  insertMark,
  lastClosedEnd,
  normalizeMarks,
  openAs,
  openingMode,
  scoringAsksFirstServer,
  INVALID,
  LEAD_MAX_S,
  LEAD_MIN_S,
  LONGEST_POINT_S,
  MAX_MARKS,
  MIN_POINT_S,
  PAST_END_ALLOWANCE_S,
  REFUSE,
  asPoints,
  emptyState,
  endMark,
  leadFor,
  moveEdge,
  openMark,
  removeMark,
  resetOpen,
  selectMark,
  setEdges,
  setOutcome,
  startMark,
  submittable,
  summarize,
  toggleStar,
  undoLast,
  validate,
  type MarkState,
} from "./handCut.ts";
import { buildFixture } from "../../../../scripts/handcut-fixture.ts";

type Answer = "user" | "opponent" | "let";
type Tap =
  | { at: number; start: true; rate?: number }
  | { at: number; end: true }
  | { answer: Answer };

/** Replay a session the way a person taps it: begin, end, answer. */
function run(taps: Tap[]): {
  state: MarkState;
  refusals: (string | undefined)[];
} {
  let state = emptyState;
  const refusals: (string | undefined)[] = [];
  let n = 0;
  for (const tap of taps) {
    const r =
      "start" in tap
        ? startMark(state, tap.at, tap.rate ?? 1, `m${++n}`)
        : "end" in tap
          ? endMark(state, tap.at)
          : setOutcome(state, tap.answer);
    state = r.state;
    refusals.push(r.refused);
  }
  return { state, refusals };
}

/** One whole rally, the way the pad is actually used. */
const rally = (a: number, b: number, answer?: Answer): Tap[] =>
  answer
    ? [{ at: a, start: true }, { at: b, end: true }, { answer }]
    : [{ at: a, start: true }, { at: b, end: true }];

test("the lead is the split constant, scaled by rate and clamped both ways", () => {
  assert.equal(leadFor(1), 0.6);
  assert.equal(leadFor(2), 1.2, "0.6 * 2, exactly the ceiling");
  assert.equal(leadFor(0.25), LEAD_MIN_S, "slow motion keeps the floor");
  assert.equal(leadFor(8), LEAD_MAX_S);
  assert.equal(leadFor(0), 0.6, "a nonsense rate falls back to 1x");
  assert.equal(leadFor(Number.NaN), 0.6);
});

test("Begin Point is led backwards, End Point is not", () => {
  const { state } = run(rally(10, 25, "user"));
  const m = state.marks[0];
  assert.equal(m.t0, 9.4, "start led back by 0.6 at 1x");
  assert.equal(m.t1, 25, "end taken at the tap, no lead");
  assert.equal(m.tap, 10, "the raw tap is kept for measuring the lead later");
});

test("the lead scales with playback rate", () => {
  const { state } = run([{ at: 10, start: true, rate: 2 }]);
  assert.equal(state.marks[0].t0, 8.8, "0.6 * 2 = 1.2 of video at 2x");
});

test("a clean run: begin, end, answer, three times", () => {
  const { state, refusals } = run([
    ...rally(10, 24, "user"),
    ...rally(40, 55, "opponent"),
    ...rally(70, 78, "let"),
  ]);
  assert.equal(refusals.filter(Boolean).length, 0, "nothing refused");
  assert.equal(state.marks.length, 3);
  assert.deepEqual(
    state.marks.map((m) => [m.winner, m.isLet]),
    [["user", false], ["opponent", false], [null, true]]
  );
  assert.equal(openMark(state.marks), null);
  assert.equal(state.awaitingId, null, "answered, so the row stops asking");
});

test("End Point asks who won, and names the point it is asking about", () => {
  const { state } = run(rally(10, 24));
  assert.equal(state.marks[0].t1, 24, "the point is closed");
  assert.equal(state.awaitingId, state.marks[0].id, "and the row lights up");
  assert.equal(state.marks[0].winner, null);
  assert.equal(summarize(state.marks).unscored, 1);
});

test("a point ended and never answered stays unscored, and that is allowed", () => {
  const { state, refusals } = run([...rally(10, 24), ...rally(40, 55, "user")]);
  assert.equal(refusals.filter(Boolean).length, 0);
  assert.equal(state.marks[0].winner, null, "left uncalled, never guessed");
  assert.equal(state.marks[1].winner, "user");
  assert.equal(state.awaitingId, null, "starting the next point stops the ask");
  assert.equal(summarize(state.marks).unscored, 1);
});

test("an answer with nothing ended is refused", () => {
  const r = setOutcome(emptyState, "user");
  assert.equal(r.refused, REFUSE.noneEnded);
  assert.equal(r.state.marks.length, 0);
});

test("an answer while a rally is still open is refused", () => {
  // A point is judged after it finishes. Answering mid-rally would be about
  // a rally nobody has seen the end of.
  const open = run([{ at: 10, start: true }]).state;
  const r = setOutcome(open, "user");
  assert.equal(r.refused, REFUSE.noneEnded);
  assert.equal(r.state.marks[0].winner, null);
  assert.equal(r.state.marks[0].t1, null, "still open");
});

test("End Point with nothing open is refused", () => {
  const r = endMark(emptyState, 12);
  assert.equal(r.refused, REFUSE.noneOpen);

  const done = run(rally(10, 24, "user")).state;
  const again = endMark(done, 30);
  assert.equal(again.refused, REFUSE.noneOpen);
  assert.equal(again.state.marks[0].t1, 24, "the closed point is untouched");
});

test("a second Begin too close to the first is refused, and changes nothing", () => {
  const before = run([{ at: 10, start: true }]).state;
  const r = startMark(before, 10.5, 1, "m2");
  assert.equal(r.refused, REFUSE.short);
  assert.deepEqual(r.state, before, "a refused tap is a no-op");
});

test("End Point too close to the start is refused", () => {
  const open = run([{ at: 10, start: true }]).state;
  const r = endMark(open, 9.8);
  assert.equal(r.refused, REFUSE.short);
  assert.equal(r.state.marks[0].t1, null, "still open");
});

test("a Begin before the last point ended is refused", () => {
  const { state } = run(rally(10, 60, "user"));
  const r = startMark(state, 30, 1, "m9");
  assert.equal(r.refused, REFUSE.past);
  assert.equal(r.state.marks.length, 1);
});

test("Begin while a rally is open closes it, unanswered, and they abut", () => {
  const { state, refusals } = run([
    { at: 10, start: true },
    { at: 40, start: true },
  ]);
  assert.equal(refusals.filter(Boolean).length, 0);
  const [a, b] = state.marks;
  assert.equal(a.t1, b.t0, "the forgotten end lands on the new start");
  assert.equal(a.winner, null);
  assert.equal(b.t1, null);
  assert.ok(a.t1 !== null && b.t0 >= a.t1, "ordering holds");
});

test("a selected chip retargets the answers once nothing is awaiting", () => {
  let { state } = run([...rally(10, 24, "user"), ...rally(40, 55, "opponent")]);
  assert.equal(state.awaitingId, null);
  state = selectMark(state, state.marks[0].id);
  state = setOutcome(state, "opponent").state;
  assert.equal(state.marks[0].winner, "opponent", "corrected");
  assert.equal(state.marks[0].t1, 24, "correcting never moves the timing");
  assert.equal(state.marks[1].winner, "opponent", "the other is untouched");
});

test("the point just ended outranks a selected chip", () => {
  let { state } = run(rally(10, 24, "user"));
  state = selectMark(state, state.marks[0].id);
  state = startMark(state, 40, 1, "m2").state;
  state = endMark(state, 55).state;
  state = setOutcome(state, "opponent").state;
  assert.equal(state.marks[0].winner, "user", "the old point kept its answer");
  assert.equal(state.marks[1].winner, "opponent");
});

test("re-tapping the answer a point already has clears it", () => {
  let { state } = run(rally(10, 24, "user"));
  state = selectMark(state, state.marks[0].id);
  state = setOutcome(state, "user").state;
  assert.equal(state.marks[0].winner, null, "toggled off");
});

test("a let clears a winner and a winner clears a let", () => {
  let { state } = run(rally(10, 24, "user"));
  state = selectMark(state, state.marks[0].id);

  state = setOutcome(state, "let").state;
  assert.equal(state.marks[0].isLet, true);
  assert.equal(state.marks[0].winner, null, "never both");

  state = setOutcome(state, "user").state;
  assert.equal(state.marks[0].isLet, false);
  assert.equal(state.marks[0].winner, "user");
});

test("undo steps back across every action type", () => {
  let s = startMark(emptyState, 10, 1, "a").state;
  assert.equal(undoLast(s).marks.length, 0);

  s = endMark(s, 30).state;
  const back = undoLast(s);
  assert.equal(back.marks[0].t1, null, "the point reopens");
  assert.equal(back.awaitingId, null, "and stops asking");

  s = setOutcome(s, "user").state;
  assert.equal(s.marks[0].winner, "user");
  assert.equal(undoLast(s).marks[0].winner, null);

  s = toggleStar(s, "a").state;
  assert.equal(s.marks[0].starred, true);
  assert.equal(undoLast(s).marks[0].starred, false);

  s = moveEdge(s, "a", "t1", 1).state;
  assert.equal(s.marks[0].t1, 31);
  assert.equal(undoLast(s).marks[0].t1, 30);

  const before = s.marks.slice();
  s = removeMark(s, "a").state;
  assert.equal(s.marks.length, 0);
  assert.deepEqual(undoLast(s).marks, before);
});

test("undo of a forgotten end restores the open point", () => {
  const { state } = run([
    { at: 10, start: true },
    { at: 40, start: true },
  ]);
  const back = undoLast(state);
  assert.equal(back.marks.length, 1);
  assert.equal(back.marks[0].t1, null, "open again");
});

test("Reset drops the open rally and points back at the last finished one", () => {
  const { state } = run([...rally(10, 24, "user"), { at: 40, start: true }]);
  const r = resetOpen(state);
  assert.equal(r.state.marks.length, 1, "the open rally is gone");
  assert.equal(r.state.marks[0].winner, "user", "the finished one is untouched");
  assert.equal(r.backTo, 24, "back to where the last point ended");
});

test("Reset with nothing finished yet goes back to the start of the video", () => {
  const { state } = run([{ at: 40, start: true }]);
  const r = resetOpen(state);
  assert.equal(r.state.marks.length, 0);
  assert.equal(r.backTo, 0);
});

test("Reset with nothing open changes nothing", () => {
  const { state } = run(rally(10, 24, "user"));
  const r = resetOpen(state);
  assert.deepEqual(r.state.marks, state.marks);
  assert.equal(r.backTo, 24);
});

test("Reset is undoable, and brings the open rally back", () => {
  const { state } = run([...rally(10, 24, "user"), { at: 40, start: true }]);
  const after = resetOpen(state).state;
  const back = undoLast(after);
  assert.equal(back.marks.length, 2);
  assert.equal(back.marks[1].t1, null, "open again, at the same start");
  assert.equal(back.marks[1].t0, state.marks[1].t0);
});

test("undo on an empty stack is a no-op", () => {
  assert.deepEqual(undoLast(emptyState), emptyState);
});

test("moving an edge refuses rather than overlapping a neighbour", () => {
  let { state } = run([...rally(10, 24, "user"), ...rally(40, 55, "user")]);
  const r = moveEdge(state, state.marks[0].id, "t1", 20);
  assert.equal(r.refused, REFUSE.inside);
  assert.equal(r.state.marks[0].t1, 24);

  state = moveEdge(state, state.marks[0].id, "t1", 0.15).state;
  assert.equal(state.marks[0].t1, 24.15);
});

test("moving a start below zero clamps rather than going negative", () => {
  let { state } = run(rally(0.9, 20, "user"));
  state = moveEdge(state, state.marks[0].id, "t0", -5).state;
  assert.equal(state.marks[0].t0, 0);
});

test("summarize counts what the save sheet has to say out loud", () => {
  const { state } = run([
    ...rally(10, 24, "user"),
    ...rally(40, 55),
    ...rally(70, 76, "let"),
    { at: 90, start: true },
  ]);
  const s = summarize(state.marks);
  assert.equal(s.total, 3, "the open one is not a point yet");
  assert.equal(s.unscored, 1, "a let is not unscored; an unanswered end is");
  assert.equal(s.open, true);
  assert.equal(s.long, 0);
});

test("a forgotten end shows up as a long point rather than being dropped", () => {
  const { state } = run(rally(10, 150, "user"));
  assert.equal(summarize(state.marks).long, 1);
  assert.deepEqual(validate(state.marks, 600), { ok: true }, "long is a warning, not a refusal");
});

test("submittable drops the open mark and orders by start", () => {
  const { state } = run([...rally(10, 24, "user"), { at: 40, start: true }]);
  const rows = submittable(state.marks);
  assert.equal(rows.length, 1, "an unfinished point is never submitted");
  assert.deepEqual(rows[0], {
    t0: 9.4,
    t1: 24,
    w: "user",
    let: false,
    star: false,
    tap: 10,
    rate: 1,
  });
});

test("validate refuses an empty session and a point past the video's end", () => {
  assert.deepEqual(validate([], 600), { ok: false, reason: "Nothing marked yet." });
  const { state } = run(rally(10, 24, "user"));
  const past = validate(state.marks, 12);
  assert.equal(past.ok, false);
  assert.match((past as { reason: string }).reason, /past the end/);
});

test("validate accepts a normal session", () => {
  const taps: Tap[] = [];
  for (let i = 0; i < 40; i++) {
    taps.push(...rally(10 + i * 30, 24 + i * 30, i % 2 ? "user" : "opponent"));
  }
  const { state } = run(taps);
  assert.equal(state.marks.length, 40);
  assert.deepEqual(validate(state.marks, 2000), { ok: true });
});

test("asPoints hands the score functions only what they read, closed only", () => {
  const { state } = run([...rally(10, 24, "user"), { at: 40, start: true }]);
  const pts = asPoints(state.marks);
  assert.equal(pts.length, 1, "an open mark has no score contribution yet");
  assert.deepEqual(Object.keys(pts[0]).sort(), [
    "confirmed_winner",
    "game_end_override",
    "game_winner_override",
    "id",
    "is_let",
    "server_override",
  ]);
});

test("the minimum point length is the same number the database applies", () => {
  // If this drifts from claim_hand_cut's floor, the client would let a tap
  // through that the RPC then rejects, and a session would be lost to a
  // refusal the player was never shown.
  assert.equal(MIN_POINT_S, 0.7);
});

/* --------------------------------------------------------- review pass */

const closed = (
  id: string,
  t0: number,
  t1: number | null,
  winner: "user" | "opponent" | null = null,
  isLet = false,
): Mark => ({ id, t0, t1, winner, isLet, starred: false, tap: t0, rate: 1 });

test("firstUnscored walks the closed points without a winner; a let counts as answered", () => {
  const marks = [
    closed("a", 0, 5, "user"),
    closed("b", 10, 15),
    closed("c", 20, 25, null, true),
    closed("d", 30, 35),
    closed("open", 40, null),
  ];
  assert.equal(firstUnscored(marks)?.id, "b");
  assert.equal(firstUnscored(marks, "b")?.id, "d");
  assert.equal(firstUnscored(marks, "d"), null);
  assert.equal(firstUnscored([closed("o", 40, null)]), null);
  assert.equal(firstUnscored([]), null);
});

test("allCalled is true only when every point is closed and answered", () => {
  assert.equal(allCalled([]), false);
  assert.equal(allCalled([closed("a", 0, 5, "user")]), true);
  assert.equal(
    allCalled([closed("a", 0, 5, "user"), closed("b", 10, 15, null, true)]),
    true,
  );
  assert.equal(
    allCalled([closed("a", 0, 5, "user"), closed("b", 10, 15)]),
    false,
  );
  assert.equal(
    allCalled([closed("a", 0, 5, "user"), closed("open", 10, null)]),
    false,
  );
});

test("openAs tells a review from a pass someone walked away from", () => {
  const called = [closed("a", 10, 15, "user"), closed("b", 30, 35, "opponent")];
  // Nothing marked at all.
  assert.equal(openAs([], 600), "fresh");
  // A point still without a winner: the scoring pass, whatever the tail.
  assert.equal(openAs([...called, closed("c", 50, 55)], 60), "scoring");
  // Called, and the tape runs out with the last point.
  assert.equal(openAs(called, 60), "review");
  assert.equal(openAs(called, 35 + 45), "review");
  // Called, but minutes of match still ahead: ask.
  assert.equal(openAs(called, 35 + 46), "choice");
  assert.equal(openAs(called, 600), "choice");
  // No duration to measure against: ask rather than guess.
  assert.equal(openAs(called, null), "choice");
  assert.equal(openAs(called, 0), "choice");
});

/* ------------------------------------------------------- adding one back */

const stateOf = (marks: Mark[], selectedId: string | null = null) => ({
  ...emptyState,
  marks,
  selectedId,
});

test("gapsAround offers a window either side of the point stood on, and nowhere else", () => {
  const marks = [
    closed("a", 10, 15, "user"),
    closed("b", 30, 35, "user"),
    closed("c", 60, 65, "user"),
  ];
  // Nothing selected: nothing offered.
  assert.deepEqual(gapsAround(marks, null, 100), { before: null, after: null });
  // Standing on the middle one: the holes on both sides.
  assert.deepEqual(gapsAround(marks, "b", 100), {
    before: { lo: 15, hi: 30 },
    after: { lo: 35, hi: 60 },
  });
  // The first point's "before" opens at zero; the last one's "after" runs
  // to the end of the video.
  assert.deepEqual(gapsAround(marks, "a", 100).before, { lo: 0, hi: 10 });
  assert.deepEqual(gapsAround(marks, "c", 100).after, { lo: 65, hi: 100 });
  // Too tight for a rally, so no offer.
  const tight = [closed("a", 10, 15, "user"), closed("b", 17, 22, "user")];
  assert.equal(gapsAround(tight, "a", 100).after, null);
  // No duration to bound the tail: no offer past the last point.
  assert.equal(gapsAround(marks, "c", null).after, null);
});

test("insertMark drops a rally into its place in order, and Undo takes it out", () => {
  const before = stateOf([closed("a", 10, 15, "user"), closed("c", 60, 65, "user")]);
  const added = insertMark(before, 30, 36, "b");
  assert.equal(added.refused, undefined);
  assert.deepEqual(added.state.marks.map((m) => m.id), ["a", "b", "c"]);
  assert.equal(added.state.selectedId, "b");
  assert.equal(added.state.marks[1].winner, null);
  assert.deepEqual(undoLast(added.state).marks.map((m) => m.id), ["a", "c"]);
  // Too short to be a rally, and overlapping one that exists.
  assert.equal(insertMark(before, 30, 30.2, "x").refused, REFUSE.short);
  assert.equal(insertMark(before, 12, 20, "x").refused, REFUSE.inside);
});

test("draftMode takes the recorded choice, and infers one only where none was recorded", () => {
  const uncalled = [closed("a", 10, 15), closed("b", 30, 35)];
  const called = [closed("a", 10, 15, "user"), closed("b", 30, 35)];
  // Recorded wins, whatever the marks look like.
  assert.equal(draftMode(uncalled, "score"), "score");
  assert.equal(draftMode(called, "cut"), "cut");
  // Nothing recorded: one call anywhere means someone was scoring.
  assert.equal(draftMode(called, null), "score");
  assert.equal(draftMode([closed("a", 10, 15, null, true)], null), "score");
  assert.equal(draftMode(uncalled, null), "cut");
  assert.equal(draftMode([], null), "cut");
});

test("Score starts on for a fresh match, off for practice, and a draft keeps its pass", () => {
  const uncalled = [closed("a", 10, 15), closed("b", 30, 35)];
  const called = [closed("a", 10, 15, "user"), closed("b", 30, 35)];
  // Fresh: on for a match, off where there is no score to keep.
  assert.equal(openingMode([], null, true), "score");
  assert.equal(openingMode([], null, false), "cut");
  // A draft keeps the pass it recorded, both ways.
  assert.equal(openingMode(uncalled, "cut", true), "cut");
  assert.equal(openingMode(uncalled, "score", true), "score");
  assert.equal(openingMode(called, "cut", true), "cut");
  // A draft saved before the pass was recorded is inferred as before.
  assert.equal(openingMode(called, null, true), "score");
  assert.equal(openingMode(uncalled, null, true), "cut");
  // Practice is never scored, whatever its draft says; winners stay on
  // the marks, the switch is just off.
  assert.equal(openingMode(called, "score", false), "cut");
});

test("turning Score on asks who served first only where the answer is missing and no rally is open", () => {
  const done = [closed("a", 10, 15)];
  const rallyOpen = [...done, { ...closed("b", 30, 35), t1: null }];
  assert.equal(scoringAsksFirstServer([], true, false), true);
  assert.equal(scoringAsksFirstServer(done, true, false), true);
  // Known already, or no rotation to set.
  assert.equal(scoringAsksFirstServer(done, true, true), false);
  assert.equal(scoringAsksFirstServer(done, false, false), false);
  // Never over a rally being marked.
  assert.equal(scoringAsksFirstServer(rallyOpen, true, false), false);
});

test("a cut-only pass never opens as a scoring pass", () => {
  const uncalled = [closed("a", 10, 15), closed("b", 30, 35)];
  // Scoring would send them through every point asking for a winner.
  assert.equal(openAs(uncalled, 600, "score"), "scoring");
  // Cut only has nothing to answer: it is a question of where they got to.
  assert.equal(openAs(uncalled, 600, "cut"), "choice");
  assert.equal(openAs(uncalled, 60, "cut"), "review");
});

/* ------------------------------------------ marking again, in any gap */

/** Three called points: a 9.4-24, b 39.4-55, c 69.4-78. */
const three = (): MarkState => {
  let s = emptyState;
  s = startMark(s, 10, 1, "a").state;
  s = endMark(s, 24).state;
  s = setOutcome(s, "user").state;
  s = startMark(s, 40, 1, "b").state;
  s = endMark(s, 55).state;
  s = setOutcome(s, "opponent").state;
  s = startMark(s, 70, 1, "c").state;
  s = endMark(s, 78).state;
  s = setOutcome(s, "user").state;
  return s;
};

test("Mark again works on a point in the middle, not only the last", () => {
  // The web defect: removing b and pressing Begin in its gap was refused
  // with "That's before the last point ended." because the start was
  // checked against c, the last point.
  let s = removeMark(three(), "b").state;
  const r = startMark(s, 41, 1, "b2");
  assert.equal(r.refused, undefined, "a start in the gap is allowed");
  s = r.state;
  assert.deepEqual(s.marks.map((m) => m.id), ["a", "b2", "c"], "placed in order");
  assert.equal(openMark(s.marks)?.id, "b2", "open between two closed points");
  assert.equal(summarize(s.marks).open, true);
  assert.equal(submittable(s.marks).length, 2, "the open one is still not sent");

  s = endMark(s, 54).state;
  assert.equal(s.awaitingId, "b2");
  s = setOutcome(s, "opponent").state;
  assert.deepEqual(
    s.marks.map((m) => [m.id, m.t0, m.t1, m.winner]),
    [
      ["a", 9.4, 24, "user"],
      ["b2", 40.4, 54, "opponent"],
      ["c", 69.4, 78, "user"],
    ]
  );
  assert.deepEqual(validate(s.marks, 600), { ok: true });
});

test("a start inside a point is refused, and says which point", () => {
  const s = three();
  assert.equal(startMark(s, 75, 1, "x").refused, REFUSE.past, "inside the last one");
  assert.equal(startMark(s, 45, 1, "x").refused, REFUSE.insideAnother, "inside an earlier one");
  assert.equal(startMark(s, 12, 1, "x").refused, REFUSE.insideAnother);
  assert.equal(startMark(s, 45, 1, "x").state, s, "a refused tap is a no-op");
  // Exactly where a point ended is beside it, not inside it.
  assert.equal(startMark(s, 24.6, 1, "x").refused, undefined);
});

test("a start in a gap needs room to be a point before the next one", () => {
  const s = removeMark(three(), "b").state;
  // Begin lands at 68.9, half a second before c starts at 69.4.
  assert.equal(startMark(s, 69.5, 1, "x").refused, REFUSE.intoNext);
  // 0.7 of room is enough.
  assert.equal(startMark(s, 69.3, 1, "x").refused, undefined);
});

test("End Point refuses to run into the next point, and may meet it exactly", () => {
  let s = removeMark(three(), "b").state;
  s = startMark(s, 41, 1, "b2").state;
  const late = endMark(s, 72);
  assert.equal(late.refused, REFUSE.intoNext);
  assert.equal(late.state, s, "still open, nothing moved");
  const meet = endMark(s, 69.4);
  assert.equal(meet.refused, undefined);
  assert.equal(meet.state.marks[1].t1, 69.4);
  // The short rule still comes first.
  assert.equal(endMark(s, 40.5).refused, REFUSE.short);
});

test("a forgotten end inside a gap closes it and opens the next in place", () => {
  let s = removeMark(three(), "b").state;
  s = startMark(s, 41, 1, "b2").state;
  const r = startMark(s, 50, 1, "b3");
  assert.equal(r.refused, undefined);
  assert.deepEqual(
    r.state.marks.map((m) => [m.id, m.t0, m.t1]),
    [
      ["a", 9.4, 24],
      ["b2", 40.4, 49.4],
      ["b3", 49.4, null],
      ["c", 69.4, 78],
    ]
  );
  // Undo puts the first one back open, where it was.
  const back = undoLast(r.state);
  assert.deepEqual(back.marks.map((m) => [m.id, m.t1]), [
    ["a", 24],
    ["b2", null],
    ["c", 78],
  ]);
  // A forgotten end past the next point would overlap it.
  assert.equal(startMark(s, 72, 1, "x").refused, REFUSE.intoNext);
});

test("the forgotten end at the end of the list is unchanged", () => {
  const { state } = run([...rally(10, 24, "user"), { at: 40, start: true }, { at: 60, start: true }]);
  assert.deepEqual(state.marks.map((m) => [m.t0, m.t1]), [
    [9.4, 24],
    [39.4, 59.4],
    [59.4, null],
  ]);
});

test("Reset inside a gap goes back to the point before the gap, not the last one", () => {
  let s = removeMark(three(), "b").state;
  s = startMark(s, 41, 1, "b2").state;
  const r = resetOpen(s);
  assert.equal(r.backTo, 24, "a's end, not c's");
  assert.deepEqual(r.state.marks.map((m) => m.id), ["a", "c"]);
  const back = undoLast(r.state);
  assert.deepEqual(back.marks.map((m) => m.id), ["a", "b2", "c"], "undo puts it back in place");
  assert.equal(back.marks[1].t1, null);
});

test("Reset clears a selection that pointed at the rally it threw away", () => {
  let { state } = run([...rally(10, 24, "user"), { at: 40, start: true }]);
  state = selectMark(state, state.marks[1].id);
  assert.equal(resetOpen(state).state.selectedId, null);
  state = selectMark(state, state.marks[0].id);
  assert.equal(resetOpen(state).state.selectedId, state.marks[0].id, "any other selection stays");
});

test("gapsAround never offers a gap across a rally still being marked", () => {
  // At the end of the list: the gap after the last point stops where the
  // open rally started, instead of running to the end of the video.
  let { state } = run([...rally(10, 24, "user"), { at: 60, start: true }]);
  assert.deepEqual(gapsAround(state.marks, state.marks[0].id, 600).after, { lo: 24, hi: 59.4 });

  // In a gap: the point before it gets the gap up to the open start, and
  // the point after it gets nothing before.
  state = startMark(removeMark(three(), "b").state, 41, 1, "b2").state;
  assert.deepEqual(gapsAround(state.marks, "a", 600).after, { lo: 24, hi: 40.4 });
  assert.equal(gapsAround(state.marks, "c", 600).before, null);
  assert.deepEqual(gapsAround(state.marks, "b2", 600), { before: null, after: null }, "the open one gets no offer");
});

test("insertMark refuses to land on a rally being marked", () => {
  const s = startMark(removeMark(three(), "b").state, 41, 1, "b2").state;
  assert.equal(insertMark(s, 45, 50, "x").refused, REFUSE.inside, "inside the open one");
  assert.equal(insertMark(s, 38, 44, "x").refused, REFUSE.inside, "across its start");
  const before = insertMark(s, 30, 36, "x");
  assert.equal(before.refused, undefined, "the part of the gap before it is still free");
  assert.deepEqual(before.state.marks.map((m) => m.id), ["a", "x", "b2", "c"]);
});

test("a point after an open rally cannot be dragged back onto it", () => {
  const s = startMark(removeMark(three(), "b").state, 41, 1, "b2").state;
  assert.equal(setEdges(s, "c", 40, 78).refused, REFUSE.inside, "before its start");
  assert.equal(setEdges(s, "c", 40.8, 78).refused, REFUSE.inside, "leaving it no room");
  assert.equal(setEdges(s, "c", 41.1, 78).refused, undefined);
  assert.equal(moveEdge(s, "c", "t0", -29).refused, REFUSE.inside);
});

test("undo clears a selection whose point it took away", () => {
  const base = { ...emptyState, marks: three().marks };
  const added = insertMark(base, 30, 36, "x").state;
  assert.equal(added.selectedId, "x");
  const back = undoLast(added);
  assert.equal(back.selectedId, null, "the inserted point is gone, so is the selection");

  // A selection on a point that survives the undo is kept.
  let s = selectMark(three(), "a");
  s = toggleStar(s, "a").state;
  assert.equal(undoLast(s).selectedId, "a");

  // Undoing an end reopens the point, and a selection is only ever a
  // closed point, so it goes too.
  let r = startMark(emptyState, 10, 1, "a").state;
  r = endMark(r, 24).state;
  r = selectMark(r, "a");
  const reopened = undoLast(r);
  assert.equal(reopened.marks[0].t1, null);
  assert.equal(reopened.selectedId, null);
});

test("an answer never lands on a rally still open, even one selected", () => {
  let s = startMark(emptyState, 10, 1, "a").state;
  s = selectMark(s, "a");
  const r = setOutcome(s, "user");
  assert.equal(r.refused, REFUSE.noneEnded);
  assert.equal(r.state, s);
});

test("clearAwaiting stops asking without answering", () => {
  const { state } = run(rally(10, 24));
  assert.equal(state.awaitingId, state.marks[0].id);
  const after = clearAwaiting(state);
  assert.equal(after.awaitingId, null);
  assert.equal(after.marks[0].winner, null, "still uncalled");
  assert.equal(setOutcome(after, "user").refused, REFUSE.noneEnded, "nothing to answer now");
  assert.equal(clearAwaiting(after), after, "a no-op when nothing is awaited");
});

test("lastClosedEnd skips a rally still open in a gap", () => {
  const s = startMark(removeMark(three(), "b").state, 41, 1, "b2").state;
  assert.equal(lastClosedEnd(s.marks), 78);
  assert.equal(openAs(s.marks, 600, "cut"), "choice");
  assert.equal(openAs(s.marks, 600, "score"), "scoring", "an open rally is not called");
});

/* ------------------------------------------- matching the server */

const long = (len: number): Mark[] => [closed("a", 10, 10 + len, "user")];

test("validate refuses what claim_hand_cut refuses, with the same numbers", () => {
  assert.equal(LONGEST_POINT_S, 180);
  assert.equal(PAST_END_ALLOWANCE_S, 1);
  assert.equal(MAX_MARKS, 400);

  assert.deepEqual(validate(long(180), 600), { ok: true }, "exactly three minutes is allowed");
  assert.deepEqual(validate(long(180.5), 600), { ok: false, reason: INVALID.tooLong });
  assert.equal(INVALID.tooLong, "A point is over three minutes long.");

  // The server allows a second past the end of the file, not half of one.
  const end = [closed("a", 10, 101, "user")];
  assert.deepEqual(validate(end, 100), { ok: true });
  assert.deepEqual(validate([closed("a", 10, 101.5, "user")], 100), {
    ok: false,
    reason: INVALID.pastEnd,
  });
});

test("validate has a message for every refusal", () => {
  const reason = (marks: Mark[], d: number | null = 600) => {
    const v = validate(marks, d);
    return v.ok ? null : v.reason;
  };
  assert.equal(reason([]), INVALID.empty);
  assert.equal(reason([closed("o", 10, null)]), INVALID.empty, "an open rally is not a point");
  const many = Array.from({ length: 401 }, (_, i) => closed(`m${i}`, i * 2, i * 2 + 1));
  assert.equal(reason(many, null), INVALID.tooMany);
  assert.equal(reason(many.slice(0, 400), null), null, "400 is allowed");
  assert.equal(reason([closed("a", 10, 10)]), INVALID.noLength);
  assert.equal(reason([closed("a", -1, 10)]), INVALID.noLength);
  assert.equal(reason([closed("a", 10, 10.5)]), INVALID.short);
  assert.equal(reason([closed("a", 10, 200)]), INVALID.tooLong);
  assert.equal(reason([closed("a", 10, 20), closed("b", 15, 30)]), INVALID.overlap);
  assert.equal(reason([closed("a", 10, 20)], 18), INVALID.pastEnd);
  assert.equal(reason([closed("a", 10, 20, "user", true)]), INVALID.letAndWin);
  assert.equal(reason([closed("a", 10, 20)], null), null, "no duration, no end check");
});

/* ------------------------------------------- reading a stored draft */

test("a draft handed back after a failed cut reads its winners correctly", () => {
  // What claim_hand_cut was sent, and what the draft row holds after it.
  const stored = [
    { t0: 39.4, t1: 55, w: "opponent", let: false, star: true, tap: 40, rate: 1 },
    { t0: 9.4, t1: 24, w: null, let: false, star: false, tap: 10, rate: 1 },
    { t0: 69.4, t1: 78, w: null, let: true, star: false, tap: 70, rate: 2 },
  ];
  const marks = normalizeMarks(stored);
  assert.deepEqual(marks, [
    { id: "d1", t0: 9.4, t1: 24, winner: null, isLet: false, starred: false, tap: 10, rate: 1 },
    { id: "d2", t0: 39.4, t1: 55, winner: "opponent", isLet: false, starred: true, tap: 40, rate: 1 },
    { id: "d3", t0: 69.4, t1: 78, winner: null, isLet: true, starred: false, tap: 70, rate: 2 },
  ]);
  // The bug: read as Mark[] directly, every point looked called.
  assert.equal(allCalled(stored as unknown as Mark[]), true);
  assert.equal(allCalled(marks), false, "the uncalled one is uncalled");
  assert.equal(openAs(marks, 600, "score"), "scoring");
  assert.deepEqual(normalizeMarks(stored), marks, "the same draft reads back with the same ids");
  // And it round-trips: submittable of the normalised marks is what was sent.
  assert.deepEqual(
    submittable(marks),
    [...stored].sort((a, b) => a.t0 - b.t0)
  );
});

test("a draft saved while marking reads back unchanged", () => {
  const { state } = run([...rally(10, 24, "user"), ...rally(40, 55), { at: 70, start: true }]);
  assert.deepEqual(normalizeMarks(JSON.parse(JSON.stringify(state.marks))), state.marks);
});

test("normalizeMarks drops what it cannot read and keeps what it can", () => {
  assert.deepEqual(normalizeMarks(null), []);
  assert.deepEqual(normalizeMarks({ marks: [] }), []);
  const marks = normalizeMarks([
    null,
    7,
    [1, 2],
    { t1: 5 },
    { t0: "3", t1: 5 },
    { t0: 3 },
    { t0: 3, t1: "5" },
    { t0: Number.NaN, t1: 5 },
    { id: "k", t0: 30, t1: 35, winner: "near", isLet: "yes", starred: 1 },
    { id: "k", t0: 10, t1: 15, winner: "user" },
    { id: "", t0: 20, t1: 25, w: "user", rate: 0, tap: null },
  ]);
  assert.deepEqual(marks, [
    { id: "k", t0: 10, t1: 15, winner: "user", isLet: false, starred: false, tap: 10, rate: 1 },
    { id: "d1", t0: 20, t1: 25, winner: "user", isLet: false, starred: false, tap: 20, rate: 1 },
    { id: "d2", t0: 30, t1: 35, winner: null, isLet: false, starred: false, tap: 30, rate: 1 },
  ]);
});

test("normalizeMarks keeps one open rally, the latest", () => {
  const marks = normalizeMarks([
    { id: "o1", t0: 10, t1: null, winner: null, isLet: false, starred: false, tap: 10, rate: 1 },
    { id: "a", t0: 20, t1: 25, winner: null, isLet: false, starred: false, tap: 20, rate: 1 },
    { id: "o2", t0: 30, t1: null, winner: "user", isLet: true, starred: true, tap: 30, rate: 1 },
  ]);
  assert.deepEqual(marks.map((m) => m.id), ["a", "o2"]);
  assert.deepEqual(
    [marks[1].winner, marks[1].isLet, marks[1].starred],
    [null, false, true],
    "an open rally carries no answer, but keeps its star"
  );
});

test("normalizeMarks never generates an id that is already taken", () => {
  const marks = normalizeMarks([
    { t0: 1, t1: 5 },
    { id: "d1", t0: 10, t1: 15 },
  ]);
  assert.deepEqual(marks.map((m) => m.id), ["d2", "d1"]);
});

/* ---------------------------------------------------- parity fixture */

test("the iOS parity fixture is what this module produces today", () => {
  // If this fails, the rules changed: run
  //   node --experimental-strip-types scripts/handcut-fixture.ts
  // and the Swift port has to follow the new fixture.
  const committed = JSON.parse(
    readFileSync(new URL("../../../../ios/Tests/fixtures/handcut-parity.json", import.meta.url), "utf8")
  );
  assert.deepEqual(buildFixture(), committed);
});
