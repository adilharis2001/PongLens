import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPatch,
  emptyLabel,
  endForPerson,
  isLabelled,
  labelScoreByPoint,
  normaliseSplits,
  personAtEnd,
  type ScoreRow,
} from "./pointLabels.ts";

test("a card with nothing filed is not labelled", () => {
  assert.equal(isLabelled(emptyLabel()), false);
  assert.equal(isLabelled(null), false);
  assert.equal(isLabelled({ ...emptyLabel(), joinNext: true }), true);
  assert.equal(isLabelled({ ...emptyLabel(), splits: [3.2] }), true);
  assert.equal(isLabelled({ ...emptyLabel(), serverEnd: "far" }), true);
});

test("a patch leaves the fields it does not name alone", () => {
  const start = applyPatch(emptyLabel(), { server_end: "near" });
  const next = applyPatch(start, { winner_end: "far" });
  assert.equal(next.serverEnd, "near");
  assert.equal(next.winnerEnd, "far");
  // This is the whole reason the write is a patch: four taps seconds
  // apart must not clobber one another.
  const cleared = applyPatch(next, { server_end: null });
  assert.equal(cleared.serverEnd, null);
  assert.equal(cleared.winnerEnd, "far");
});

test("splits are rounded, deduped and sorted, exactly as the row stores them", () => {
  assert.deepEqual(normaliseSplits([9.104, 3.2, 9.101, 3.2]), [3.2, 9.1]);
  assert.deepEqual(normaliseSplits([Number.NaN, 1.236, 1.234]), [1.23, 1.24]);
  assert.deepEqual(normaliseSplits([]), []);
  // The database normalises whatever it is sent the same way, so what the
  // page shows and what the row holds can only stay in step if running the
  // rule twice changes nothing.
  const once = normaliseSplits([4.567, 4.561, 2]);
  assert.deepEqual(normaliseSplits(once), once);
});

test("an end names a player only for the game it was read in", () => {
  // The uploader is at the near end in game one, the far end in game two.
  assert.equal(personAtEnd("near", "near"), "user");
  assert.equal(personAtEnd("near", "far"), "opponent");
  // No side for this game: an end names nobody rather than the wrong body.
  assert.equal(personAtEnd("near", null), null);
  assert.equal(personAtEnd(null, "near"), null);
  // And back the other way.
  assert.equal(endForPerson("user", "far"), "far");
  assert.equal(endForPerson("opponent", "far"), "near");
  assert.equal(endForPerson("user", null), null);
});

function row(
  id: string,
  winnerEnd: "near" | "far" | null,
  extra: Partial<ScoreRow> = {}
): ScoreRow {
  return { id, is_let: false, gameEndOverride: null, winnerEnd, ...extra };
}

test("the score counts the ends and closes a game at eleven clear by two", () => {
  const rows: ScoreRow[] = [];
  for (let i = 0; i < 11; i += 1) rows.push(row(`n${i}`, "near"));
  for (let i = 0; i < 4; i += 1) rows.push(row(`f${i}`, "far"));
  const { byPoint, games } = labelScoreByPoint(rows);
  // The eleventh near point ends game one at 11-0 and the walk resets.
  assert.deepEqual(games, [{ near: 11, far: 0 }]);
  const closing = byPoint.get("n10");
  assert.deepEqual(closing, { near: 11, far: 0, game: 1, closes: true });
  assert.deepEqual(byPoint.get("f3"), {
    near: 0,
    far: 4,
    game: 2,
    closes: false,
  });
});

test("deuce holds the game open", () => {
  const rows: ScoreRow[] = [];
  for (let i = 0; i < 10; i += 1) rows.push(row(`n${i}`, "near"));
  for (let i = 0; i < 10; i += 1) rows.push(row(`f${i}`, "far"));
  rows.push(row("n10", "near")); // 11-10, not clear by two
  const { byPoint, games } = labelScoreByPoint(rows);
  assert.deepEqual(games, []);
  assert.equal(byPoint.get("n10")?.closes, false);
  assert.deepEqual(byPoint.get("n10"), {
    near: 11,
    far: 10,
    game: 1,
    closes: false,
  });
});

test("a card nobody has called adds nothing and is counted", () => {
  const { byPoint, unmarked } = labelScoreByPoint([
    row("a", "near"),
    row("b", null),
    row("c", "far"),
  ]);
  assert.equal(unmarked, 1);
  assert.deepEqual(byPoint.get("b"), {
    near: 1,
    far: 0,
    game: 1,
    closes: false,
  });
  assert.deepEqual(byPoint.get("c"), {
    near: 1,
    far: 1,
    game: 1,
    closes: false,
  });
});

test("a skipped point is not an uncalled one", () => {
  const { unmarked } = labelScoreByPoint([
    row("a", null, { is_let: true }),
    row("b", null),
  ]);
  assert.equal(unmarked, 1);
});

test("the owner's own game-end pin closes the game where they put it", () => {
  const { byPoint, games } = labelScoreByPoint([
    row("a", "near"),
    row("b", "far", { gameEndOverride: "end" }),
    row("c", "near"),
  ]);
  assert.deepEqual(games, [{ near: 1, far: 1 }]);
  assert.equal(byPoint.get("b")?.closes, true);
  assert.deepEqual(byPoint.get("c"), {
    near: 1,
    far: 0,
    game: 2,
    closes: false,
  });
});
