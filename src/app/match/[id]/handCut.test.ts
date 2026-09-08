import assert from "node:assert/strict";
import test from "node:test";

import {
  LEAD_MAX_S,
  LEAD_MIN_S,
  MIN_POINT_S,
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
  setOutcome,
  startMark,
  submittable,
  summarize,
  toggleStar,
  undoLast,
  validate,
  type MarkState,
} from "./handCut.ts";

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
  const { state } = run(rally(10, 200, "user"));
  assert.equal(summarize(state.marks).long, 1);
  assert.deepEqual(validate(state.marks, 600), { ok: true });
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
