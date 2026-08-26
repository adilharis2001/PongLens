import assert from "node:assert/strict";
import test from "node:test";
import { couldHaveEnded, scoreMatch, type ScoringPoint } from "./scoreGaps.ts";

let seq = 0;
function p(
  winner: "user" | "opponent" | null,
  t0: number,
  extra: Partial<ScoringPoint> = {},
): ScoringPoint {
  seq += 1;
  return {
    id: `p${seq}`,
    idx: seq,
    t0,
    t1: t0 + 8,
    is_let: false,
    confirmed_winner: winner,
    game_end_override: null,
    ...extra,
  };
}

/** A whole game to `to`, the loser taking `losing` of them. */
function game(to: number, losing: number, start: number, step = 20) {
  const out: ScoringPoint[] = [];
  let t = start;
  for (let i = 0; i < losing; i++, t += step) out.push(p("opponent", t));
  for (let i = 0; i < to; i++, t += step) out.push(p("user", t));
  return out;
}

test("a game ending 11-6 is legal and never suspect", () => {
  const s = scoreMatch(game(11, 6, 0));
  assert.equal(s.games.length, 1);
  assert.equal(s.games[0].you, 11);
  assert.equal(s.games[0].them, 6);
  assert.ok(s.games[0].legal);
  assert.equal(s.games[0].suspect, false);
  assert.equal(s.missing, 0);
});

test("deuce needs the two-point lead, not just eleven", () => {
  assert.equal(couldHaveEnded(11, 10), false);
  assert.equal(couldHaveEnded(12, 10), true);
  assert.equal(couldHaveEnded(13, 11), true);
  assert.equal(couldHaveEnded(10, 8), false);
});

test("a score can also be too high to be a real game", () => {
  // at 11-7 the game was already over, so 17-7 never happened
  assert.equal(couldHaveEnded(17, 7), false);
  assert.equal(couldHaveEnded(14, 10), false);
  assert.equal(couldHaveEnded(11, 9), true);
});

test("a game running past eleven is flagged, but nothing is missing", () => {
  const pts: ScoringPoint[] = [];
  let t = 0;
  for (let i = 0; i < 7; i++, t += 20) pts.push(p("opponent", t));
  for (let i = 0; i < 17; i++, t += 20)
    pts.push(p("user", t, i === 0 ? { game_end_override: "continue" } : {}));
  pts.push({ ...p("user", t), game_end_override: "end" });
  const s = scoreMatch([...pts, ...game(11, 2, 5000)]);
  assert.equal(s.games[0].legal, false);
  assert.equal(s.games[0].overrun, true);
  // too many points rather than too few: a boundary in the wrong place,
  // counted on its own rather than as a missing rally
  assert.equal(s.games[0].suspect, false);
  assert.equal(s.overrun, 1);
  assert.equal(s.missing, 0);
});

test("a game with points still unscored is not evidence of anything", () => {
  const s = scoreMatch([
    p("user", 0),
    p("user", 20),
    p(null, 40), // never scored
    { ...p("opponent", 60), game_end_override: "end" },
    ...game(11, 3, 1000),
  ]);
  assert.equal(s.games[0].legal, false);
  assert.equal(s.games[0].unscored, 1);
  assert.equal(s.games[0].suspect, false);
  assert.equal(s.suspect, 0);
});

test("the last game being short is not evidence of anything", () => {
  // the recording simply stopped: game 2 is short but nothing follows it
  const s = scoreMatch([
    ...game(11, 4, 0),
    ...game(6, 3, 1000),
  ]);
  assert.equal(s.games.length, 2);
  assert.equal(s.games[1].legal, false);
  assert.equal(s.games[1].final, true);
  assert.equal(s.games[1].suspect, false);
  assert.equal(s.suspect, 0);
  assert.equal(s.missing, 0);
});

test("a short game with play after it is points gone missing", () => {
  const first = game(9, 5, 0); // 9-5 cannot have ended a game
  first[first.length - 1] = {
    ...first[first.length - 1],
    game_end_override: "end",
  };
  const s = scoreMatch([...first, ...game(11, 6, 1000)]);
  assert.equal(s.games.length, 2);
  assert.equal(s.games[0].suspect, true);
  assert.equal(s.suspect, 1);
  // 9 is the best either player did, so at least two rallies are absent
  assert.equal(s.missing, 2);
});

test("time order wins over idx, which a split scrambles", () => {
  // split_point gives the child max(idx)+1, so the row that belongs third
  // arrives last. Ordered by idx the game would close in the wrong place.
  const pts: ScoringPoint[] = [
    p("user", 0),
    p("user", 20),
    p("opponent", 60),
    { ...p("user", 40), idx: 99 },
  ];
  const s = scoreMatch(pts);
  assert.deepEqual(
    s.points.map((x) => x.t0),
    [0, 20, 40, 60],
  );
  assert.deepEqual(
    s.points.map((x) => `${x.you}-${x.them}`),
    ["1-0", "2-0", "3-0", "3-1"],
  );
});

test("an owner's game-end pin closes the game where the score cannot", () => {
  const s = scoreMatch([
    p("user", 0),
    { ...p("opponent", 20), game_end_override: "end" },
    ...game(11, 2, 1000),
  ]);
  assert.equal(s.games.length, 2);
  assert.equal(s.games[0].you, 1);
  assert.equal(s.games[0].them, 1);
  assert.equal(s.games[0].suspect, true);
});

test("a skipped point scores nothing but still sits in its game", () => {
  const s = scoreMatch([
    p("user", 0),
    { ...p(null, 20), is_let: true },
    p("user", 40),
  ]);
  assert.equal(s.scored, 2);
  assert.equal(s.visible, 3);
  assert.equal(s.games[0].you, 2);
  assert.equal(s.points[1].skipped, true);
  assert.equal(s.points[1].game, 1);
});

test("a gap is long relative to its own game, not to the clock", () => {
  // 20s between points throughout, then one gap of 300s
  const pts = [
    p("user", 0),
    p("user", 20),
    p("opponent", 40),
    p("user", 400),
    p("user", 420),
  ];
  const s = scoreMatch(pts);
  const gaps = s.games[0].gaps;
  assert.equal(gaps.length, 1);
  assert.equal(Math.round(gaps[0].seconds), 352);
});

test("an unhurried game does not flag its ordinary pauses", () => {
  // every gap 12s: three times the median is 36s and nothing reaches it
  const pts = [0, 20, 40, 60, 80, 100].map((t) => p("user", t));
  assert.equal(scoreMatch(pts).games[0].gaps.length, 0);
});

test("a match nobody has scored produces no games and no alarm", () => {
  const s = scoreMatch([p(null, 0), p(null, 20), p(null, 40)]);
  assert.equal(s.scored, 0);
  assert.equal(s.visible, 3);
  assert.equal(s.games.length, 1);
  assert.equal(s.games[0].final, true);
  assert.equal(s.suspect, 0);
});
