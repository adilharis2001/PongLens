import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPatch,
  emptyLabel,
  endAt,
  endForPerson,
  isLabelled,
  labelScoreByPoint,
  normaliseSplits,
  personAtEnd,
  segmentBounds,
  segmentCount,
  withEndAt,
  type ScoreRow,
} from "./pointLabels.ts";

test("a card with nothing filed is not labelled", () => {
  assert.equal(isLabelled(emptyLabel()), false);
  assert.equal(isLabelled(null), false);
  assert.equal(isLabelled({ ...emptyLabel(), joinNext: true }), true);
  assert.equal(isLabelled({ ...emptyLabel(), splits: [3.2] }), true);
  assert.equal(isLabelled({ ...emptyLabel(), serverEnds: ["far"] }), true);
  // A row padded with nulls says nothing, which is what lets the database
  // delete it rather than keep an empty answer about.
  assert.equal(isLabelled({ ...emptyLabel(), serverEnds: [null, null] }), false);
});

test("a patch leaves the fields it does not name alone", () => {
  const start = applyPatch(emptyLabel(), { server_ends: ["near"] });
  const next = applyPatch(start, { winner_ends: ["far"] });
  assert.deepEqual(next.serverEnds, ["near"]);
  assert.deepEqual(next.winnerEnds, ["far"]);
  // This is the whole reason the write is a patch: answers filed seconds
  // apart must not clobber one another.
  const cleared = applyPatch(next, { server_ends: [] });
  assert.deepEqual(cleared.serverEnds, []);
  assert.deepEqual(cleared.winnerEnds, ["far"]);
});

test("a card is as many points as its cuts leave behind", () => {
  const label = { ...emptyLabel(), splits: [12, 20] };
  assert.equal(segmentCount(label), 3);
  assert.deepEqual(segmentBounds(label, 10, 26), [
    { start: 10, end: 12 },
    { start: 12, end: 20 },
    { start: 20, end: 26 },
  ]);
  assert.equal(segmentCount(emptyLabel()), 1);
});

test("an answer lands on the point it was given for", () => {
  // Answering the THIRD point of a card must not read back as an answer
  // about the first, which is the whole defect this replaced.
  const three = withEndAt([], 2, "far", 3);
  assert.deepEqual(three, [null, null, "far"]);
  assert.equal(endAt(three, 0), null);
  assert.equal(endAt(three, 2), "far");
  // Filing the first as well leaves the third alone.
  const both = withEndAt(three, 0, "near", 3);
  assert.deepEqual(both, ["near", null, "far"]);
  // Taking one back trims the tail rather than storing nulls for ever.
  assert.deepEqual(withEndAt(both, 2, null, 3), ["near"]);
  assert.deepEqual(withEndAt(["near"], 0, null, 1), []);
  // An index the card does not have changes nothing.
  assert.deepEqual(withEndAt(["near"], 5, "far", 1), ["near"]);
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
  return {
    id,
    is_let: false,
    gameEndOverride: null,
    winnerEnds: [winnerEnd],
    segments: 1,
    joinNext: false,
    ...extra,
  };
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

test("a card cut in three moves the score three times", () => {
  const { byPoint, bySegment, games } = labelScoreByPoint([
    row("a", "near"),
    {
      id: "b",
      is_let: false,
      gameEndOverride: null,
      winnerEnds: ["far", "far", "near"],
      segments: 3,
      joinNext: false,
    },
    row("c", "far"),
  ]);
  assert.deepEqual(games, []);
  // Three rallies in one card: far, far, near — so 2-2 by the end of it.
  assert.deepEqual(bySegment.get("b")?.map((s) => `${s.near}-${s.far}`), [
    "1-1",
    "1-2",
    "2-2",
  ]);
  // The card's own line is where it finished.
  assert.deepEqual(byPoint.get("b"), {
    near: 2,
    far: 2,
    game: 1,
    closes: false,
  });
  assert.deepEqual(byPoint.get("c"), {
    near: 2,
    far: 3,
    game: 1,
    closes: false,
  });
});

test("every point inside a cut card is counted as uncalled until it is answered", () => {
  const { unmarked } = labelScoreByPoint([
    {
      id: "a",
      is_let: false,
      gameEndOverride: null,
      winnerEnds: ["near"],
      segments: 3,
      joinNext: false,
    },
  ]);
  // One answered, two still open — the number used to be able to say 0
  // for a card holding three unanswered rallies.
  assert.equal(unmarked, 2);
});

test("a point joined across two cards is one point, counted once", () => {
  const { byPoint, unmarked } = labelScoreByPoint([
    { ...row("a", null), joinNext: true },
    row("b", "far"),
    row("c", "near"),
  ]);
  // The join's own point finishes on card b and takes b's answer. Card a
  // asks nobody for a winner, so it is not uncalled either.
  assert.equal(unmarked, 0);
  assert.deepEqual(byPoint.get("a"), {
    near: 0,
    far: 0,
    game: 1,
    closes: false,
  });
  assert.deepEqual(byPoint.get("b"), {
    near: 0,
    far: 1,
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

test("a join out of a cut card leaves only its LAST point open", () => {
  const { unmarked, bySegment } = labelScoreByPoint([
    {
      id: "a",
      is_let: false,
      gameEndOverride: null,
      winnerEnds: ["near", null],
      segments: 2,
      joinNext: true,
    },
    row("b", "far"),
  ]);
  // The first point inside the card was answered; the second runs on into
  // card b, so it is not waiting for an answer here.
  assert.equal(unmarked, 0);
  assert.deepEqual(bySegment.get("a")?.map((s) => `${s.near}-${s.far}`), [
    "1-0",
    "1-0",
  ]);
});
