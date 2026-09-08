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
  selectMark,
  startMark,
  submittable,
  summarize,
  toggleStar,
  undoLast,
  validate,
  type MarkState,
} from "./handCut.ts";

/** Replay a session the way a person taps it. Ids are positional so a
 *  failing case names the tap that broke, not a uuid. */
function run(
  taps: (
    | { at: number; start: true; rate?: number }
    | { at: number; end: "user" | "opponent" | "let" | "end" }
  )[]
): { state: MarkState; refusals: (string | undefined)[] } {
  let state = emptyState;
  const refusals: (string | undefined)[] = [];
  let n = 0;
  for (const tap of taps) {
    const r =
      "start" in tap
        ? startMark(state, tap.at, tap.rate ?? 1, `m${++n}`)
        : endMark(state, tap.at, tap.end);
    state = r.state;
    refusals.push(r.refused);
  }
  return { state, refusals };
}

test("the lead is the split constant, scaled by rate and clamped both ways", () => {
  assert.equal(leadFor(1), 0.6);
  // 0.6 * 2 = 1.2, exactly the ceiling.
  assert.equal(leadFor(2), 1.2);
  // Slow motion must not shrink the lead below the floor.
  assert.equal(leadFor(0.25), LEAD_MIN_S);
  // Nothing above the ceiling, whatever the rate.
  assert.equal(leadFor(8), LEAD_MAX_S);
  // A nonsense rate falls back to 1x rather than producing NaN.
  assert.equal(leadFor(0), 0.6);
  assert.equal(leadFor(Number.NaN), 0.6);
});

test("a start tap is led backwards, an end tap is not", () => {
  const { state } = run([
    { at: 10, start: true },
    { at: 25, end: "user" },
  ]);
  const m = state.marks[0];
  assert.equal(m.t0, 9.4, "start led back by 0.6 at 1x");
  assert.equal(m.t1, 25, "end taken at the tap, no lead");
  assert.equal(m.tap, 10, "the raw tap is kept for measuring the lead later");
  assert.equal(m.rate, 1);
});

test("the lead scales with playback rate", () => {
  const { state } = run([{ at: 10, start: true, rate: 2 }]);
  assert.equal(state.marks[0].t0, 8.8, "0.6 * 2 = 1.2 of video at 2x");
});

test("a clean run produces one closed mark per point", () => {
  const { state, refusals } = run([
    { at: 10, start: true },
    { at: 24, end: "user" },
    { at: 40, start: true },
    { at: 55, end: "opponent" },
    { at: 70, start: true },
    { at: 78, end: "let" },
  ]);
  assert.equal(refusals.filter(Boolean).length, 0, "nothing refused");
  assert.equal(state.marks.length, 3);
  assert.deepEqual(
    state.marks.map((m) => [m.winner, m.isLet]),
    [["user", false], ["opponent", false], [null, true]]
  );
  assert.equal(openMark(state.marks), null, "no point left open");
});

test("End closes a point with no winner and no let", () => {
  const { state } = run([
    { at: 10, start: true },
    { at: 24, end: "end" },
  ]);
  const m = state.marks[0];
  assert.equal(m.t1, 24);
  assert.equal(m.winner, null);
  assert.equal(m.isLet, false, "End is not a let; it is simply not called");
  assert.equal(summarize(state.marks).unscored, 1);
});

test("a start while a point is open closes it, unscored, and they abut", () => {
  const { state, refusals } = run([
    { at: 10, start: true },
    { at: 40, start: true },
  ]);
  assert.equal(refusals.filter(Boolean).length, 0);
  assert.equal(state.marks.length, 2);
  const [a, b] = state.marks;
  assert.equal(a.t1, b.t0, "the forgotten end lands exactly on the new start");
  assert.equal(a.winner, null, "and it is left uncalled rather than guessed");
  assert.equal(b.t1, null, "the new one is open");
  // Ordering is the invariant everything downstream leans on.
  assert.ok(a.t1 !== null && b.t0 >= a.t1);
});

test("a second start too close to the first is refused, and changes nothing", () => {
  const before = run([{ at: 10, start: true }]).state;
  const r = startMark(before, 10.5, 1, "m2");
  assert.equal(r.refused, REFUSE.short);
  assert.deepEqual(r.state, before, "a refused tap is a no-op");
});

test("an outcome with nothing open is refused", () => {
  const r = endMark(emptyState, 12, "user");
  assert.equal(r.refused, REFUSE.noneOpen);
  assert.equal(r.state.marks.length, 0);

  // And after a completed point, with nothing selected.
  const { state } = run([
    { at: 10, start: true },
    { at: 24, end: "user" },
  ]);
  const after = endMark(state, 30, "opponent");
  assert.equal(after.refused, REFUSE.noneOpen);
  assert.equal(after.state.marks[0].winner, "user", "the called point is untouched");
});

test("an end tap too close to the start is refused", () => {
  const open = run([{ at: 10, start: true }]).state;
  const r = endMark(open, 9.8, "user");
  assert.equal(r.refused, REFUSE.short);
  assert.equal(r.state.marks[0].t1, null, "still open");
});

test("a start before the last point ended is refused", () => {
  const { state } = run([
    { at: 10, start: true },
    { at: 60, end: "user" },
  ]);
  const r = startMark(state, 30, 1, "m9");
  assert.equal(r.refused, REFUSE.past);
  assert.equal(r.state.marks.length, 1);
});

test("an open point never has its outcome stolen by a selected chip", () => {
  // Call point 1, select it, then start point 2 and call it. The tap must
  // land on the rally being watched, not on the selection.
  let { state } = run([
    { at: 10, start: true },
    { at: 24, end: "user" },
  ]);
  state = selectMark(state, state.marks[0].id);
  assert.equal(state.selectedId, state.marks[0].id);

  state = startMark(state, 40, 1, "m2").state;
  assert.equal(state.selectedId, null, "starting clears the selection");
  state = endMark(state, 55, "opponent").state;

  assert.equal(state.marks[0].winner, "user", "point 1 kept its answer");
  assert.equal(state.marks[1].winner, "opponent", "point 2 got the tap");
});

test("a selected chip retargets the outcome buttons when nothing is open", () => {
  let { state } = run([
    { at: 10, start: true },
    { at: 24, end: "user" },
    { at: 40, start: true },
    { at: 55, end: "opponent" },
  ]);
  state = selectMark(state, state.marks[0].id);
  state = endMark(state, 99, "opponent").state;
  assert.equal(state.marks[0].winner, "opponent", "the wrong winner was corrected");
  assert.equal(state.marks[0].t1, 24, "correcting a winner never moves the timing");
  assert.equal(state.marks[1].winner, "opponent", "the other point is untouched");
});

test("re-tapping the outcome a point already has clears it", () => {
  let { state } = run([
    { at: 10, start: true },
    { at: 24, end: "user" },
  ]);
  state = selectMark(state, state.marks[0].id);
  state = endMark(state, 99, "user").state;
  assert.equal(state.marks[0].winner, null, "toggled off, as the winner tiles always have");
});

test("a let clears a winner and a winner clears a let", () => {
  let { state } = run([
    { at: 10, start: true },
    { at: 24, end: "user" },
  ]);
  state = selectMark(state, state.marks[0].id);

  state = endMark(state, 99, "let").state;
  assert.equal(state.marks[0].isLet, true);
  assert.equal(state.marks[0].winner, null, "is_let and a winner can never coexist");

  state = endMark(state, 99, "user").state;
  assert.equal(state.marks[0].isLet, false);
  assert.equal(state.marks[0].winner, "user");
});

test("undo steps back across every action type", () => {
  // start
  let s = startMark(emptyState, 10, 1, "a").state;
  assert.equal(undoLast(s).marks.length, 0);

  // end
  s = endMark(s, 30, "user").state;
  const afterUndoEnd = undoLast(s);
  assert.equal(afterUndoEnd.marks[0].t1, null, "the point reopens");
  assert.equal(afterUndoEnd.marks[0].winner, null);

  // star
  s = toggleStar(s, "a").state;
  assert.equal(s.marks[0].starred, true);
  assert.equal(undoLast(s).marks[0].starred, false);

  // outcome on a selection
  s = selectMark(s, "a");
  s = endMark(s, 99, "opponent").state;
  assert.equal(s.marks[0].winner, "opponent");
  assert.equal(undoLast(s).marks[0].winner, "user", "back to the previous answer");

  // move
  s = moveEdge(s, "a", "t1", 1).state;
  assert.equal(s.marks[0].t1, 31);
  assert.equal(undoLast(s).marks[0].t1, 30);

  // remove, and it comes back in its original position
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
  assert.equal(back.marks.length, 1, "the second point is gone");
  assert.equal(back.marks[0].t1, null, "and the first is open again");
});

test("undo on an empty stack is a no-op", () => {
  assert.deepEqual(undoLast(emptyState), emptyState);
});

test("moving an edge refuses rather than overlapping a neighbour", () => {
  let { state } = run([
    { at: 10, start: true },
    { at: 24, end: "user" },
    { at: 40, start: true },
    { at: 55, end: "user" },
  ]);
  // Point 1 ends at 24, point 2 starts at 39.4. Pushing point 1's end past
  // that must refuse, not silently swallow the neighbour.
  const r = moveEdge(state, state.marks[0].id, "t1", 20);
  assert.equal(r.refused, REFUSE.inside);
  assert.equal(r.state.marks[0].t1, 24);

  // A legal nudge works and keeps two decimals.
  state = moveEdge(state, state.marks[0].id, "t1", 0.15).state;
  assert.equal(state.marks[0].t1, 24.15);
});

test("moving a start below zero clamps at zero rather than going negative", () => {
  let { state } = run([
    { at: 0.9, start: true },
    { at: 20, end: "user" },
  ]);
  state = moveEdge(state, state.marks[0].id, "t0", -5).state;
  assert.equal(state.marks[0].t0, 0);
});

test("summarize counts what the save sheet has to say out loud", () => {
  const { state } = run([
    { at: 10, start: true },
    { at: 24, end: "user" },
    { at: 40, start: true },
    { at: 55, end: "end" },
    { at: 70, start: true },
    { at: 76, end: "let" },
    { at: 90, start: true },
  ]);
  const s = summarize(state.marks);
  assert.equal(s.total, 3, "the open one is not a point yet");
  assert.equal(s.unscored, 1, "a let is not unscored; End is");
  assert.equal(s.open, true);
  assert.equal(s.long, 0);
});

test("a forgotten end shows up as a long point rather than being dropped", () => {
  const { state } = run([
    { at: 10, start: true },
    { at: 200, end: "user" },
  ]);
  assert.equal(summarize(state.marks).long, 1);
  // It is still submittable: the sheet names it, the player decides.
  assert.deepEqual(validate(state.marks, 600), { ok: true });
});

test("submittable drops the open mark and orders by start", () => {
  const { state } = run([
    { at: 10, start: true },
    { at: 24, end: "user" },
    { at: 40, start: true },
  ]);
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

  const { state } = run([
    { at: 10, start: true },
    { at: 24, end: "user" },
  ]);
  const past = validate(state.marks, 12);
  assert.equal(past.ok, false);
  assert.match((past as { reason: string }).reason, /past the end/);
});

test("validate accepts a normal session", () => {
  const taps: Parameters<typeof run>[0] = [];
  for (let i = 0; i < 40; i++) {
    taps.push({ at: 10 + i * 30, start: true });
    taps.push({ at: 24 + i * 30, end: i % 2 ? "user" : "opponent" });
  }
  const { state } = run(taps);
  assert.equal(state.marks.length, 40);
  assert.deepEqual(validate(state.marks, 2000), { ok: true });
});

test("asPoints hands the score functions only what they read, closed only", () => {
  const { state } = run([
    { at: 10, start: true },
    { at: 24, end: "user" },
    { at: 40, start: true },
  ]);
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

test("the minimum point length is the same number the database will apply", () => {
  // If this ever drifts from claim_hand_cut's floor, the client would let a
  // tap through that the RPC then rejects, and the player would lose a
  // session to a refusal they were never shown.
  assert.equal(MIN_POINT_S, 0.7);
});
