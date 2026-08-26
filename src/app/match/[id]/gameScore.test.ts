import assert from "node:assert/strict";
import test from "node:test";

import type { Point } from "../../../lib/types.ts";
import type { GameEndOverride } from "./gameScore.ts";
import {
  computeMatchScore,
  gameBoundaryAction,
  gameWinner,
  resolvedGameWinner,
  runningScoreByPoint,
} from "./gameScore.ts";

/** Minimal point rows: only what the walk reads. */
function pt(
  idx: number,
  winner: "user" | "opponent" | null,
  override: "end" | "continue" | null = null,
  isLet = false
): Point {
  return {
    id: `p${idx}`,
    idx,
    t0: idx,
    confirmed_winner: winner,
    is_let: isLet,
    game_end_override: override,
  } as unknown as Point;
}

/** `seq` reads U/T/. per point; a trailing E or C pins that point's override. */
function build(seq: string): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < seq.length; i++) {
    const c = seq[i];
    let override: "end" | "continue" | null = null;
    if (seq[i + 1] === "E") {
      override = "end";
      i++;
    } else if (seq[i + 1] === "C") {
      override = "continue";
      i++;
    }
    points.push(
      pt(
        points.length,
        c === "U" ? "user" : c === "T" ? "opponent" : null,
        override
      )
    );
  }
  return points;
}

test("gameWinner needs 11 and a clear two", () => {
  assert.equal(gameWinner({ you: 11, them: 3 }), "user");
  assert.equal(gameWinner({ you: 9, them: 11 }), "opponent");
  assert.equal(gameWinner({ you: 13, them: 11 }), "user");
  assert.equal(gameWinner({ you: 11, them: 10 }), null);
  assert.equal(gameWinner({ you: 8, them: 10 }), null);
  assert.equal(gameWinner({ you: 0, them: 1 }), null);
  assert.equal(gameWinner({ you: 0, them: 0 }), null);
});

test("an auto boundary always names a winner", () => {
  const score = computeMatchScore(build("UUUUUUUUUUUTTT"));
  assert.equal(score.games.length, 1);
  assert.deepEqual(score.games[0], { you: 11, them: 0 });
  assert.equal(score.gamesYou, 1);
  assert.equal(score.gamesThem, 0);
  assert.deepEqual(score.current, { you: 0, them: 3 });
});

test("a pinned end on a barely scored game counts for nobody", () => {
  // Game one is played out. Game two is pinned where the players switched
  // sides, but only one of its points has been scored: 0-1 is a lead over
  // nothing, and crediting it would hand the match to whoever happens to
  // be ahead in scoring that isn't finished.
  const score = computeMatchScore(build("UUUUUUUUUUU" + "...T........E"));
  assert.equal(score.games.length, 2);
  assert.deepEqual(score.games[1], { you: 0, them: 1 });
  assert.equal(score.gamesYou, 1);
  assert.equal(score.gamesThem, 0);
});

test("a pinned end on an entirely unscored game counts for nobody", () => {
  const score = computeMatchScore(build("UUUUUUUUUUU" + "..........E"));
  assert.equal(score.games.length, 2);
  assert.equal(score.gamesYou, 1);
  assert.equal(score.gamesThem, 0);
});

test("a pinned end on a finished game still counts", () => {
  // The owner held the game open past 11-0 (a 'continue'), then pinned its
  // real end at 11-9. The score itself proves that game, so it counts —
  // the new rule only withholds games the score can't speak for.
  const score = computeMatchScore(build("UUUUUUUUUUUC" + "TTTTTTTTTE"));
  assert.equal(score.games.length, 1);
  assert.deepEqual(score.games[0], { you: 11, them: 9 });
  assert.equal(score.gamesYou, 1);
  assert.equal(score.gamesThem, 0);
});

test("a continue holds the game open past the auto rule", () => {
  const score = computeMatchScore(build("UUUUUUUUUUCUTTT"));
  assert.equal(score.games.length, 0);
  assert.deepEqual(score.current, { you: 11, them: 3 });
  assert.equal(score.open, true);
});

test("the boundary button names the tap, and every tap has an inverse", () => {
  // Nothing here: offer to end the game, and the tap pins it.
  const quiet = gameBoundaryAction(null, false);
  assert.deepEqual(quiet, {
    label: "Game ended",
    next: "end",
    endsHere: false,
  });

  // 11-9: the walk closed the game, so this point offers to reopen it.
  const auto = gameBoundaryAction(null, true);
  assert.deepEqual(auto, {
    label: "Didn't end",
    next: "continue",
    endsHere: true,
  });

  // Having taken that, the same point offers to close it again — clearing
  // back to automatic is enough, because automatic already ends it here.
  const reopened = gameBoundaryAction("continue", false);
  assert.deepEqual(reopened, {
    label: "Game ended",
    next: null,
    endsHere: false,
  });

  // And a point you ended yourself offers the undo, for free.
  const pinned = gameBoundaryAction("end", false);
  assert.deepEqual(pinned, {
    label: "Didn't end",
    next: null,
    endsHere: true,
  });
});

test("every boundary tap is its own undo", () => {
  // Applying `next` and asking again must offer the opposite label. That is
  // what stops a correction you already made from looking like one you have
  // not — which is how a game ends up held open by twenty-two taps.
  //
  // Every state this control can actually put you in, and what the auto
  // rule says underneath it. ('end' with the rule ALSO ending the game here
  // is excluded: the button never offers to pin 'end' where the game
  // already ends, so it is only reachable by later scoring moving the rule
  // onto a point you had pinned. See gameBoundaryAction.)
  const reachable = [
    { override: null, auto: false },
    { override: null, auto: true },
    { override: "continue" as const, auto: true },
    { override: "end" as const, auto: false },
  ];
  const walkSays = (override: GameEndOverride, auto: boolean) =>
    override === "end" ? true : override === "continue" ? false : auto;

  for (const { override, auto } of reachable) {
    const first = gameBoundaryAction(override, walkSays(override, auto));
    const second = gameBoundaryAction(first.next, walkSays(first.next, auto));
    assert.notEqual(
      first.label,
      second.label,
      `tap did not flip from ${override} (auto=${auto})`
    );
    assert.notEqual(
      first.next,
      override,
      `tap wrote back the value it started from (${override})`
    );
  }
});

test("an owner-named winner makes an unprovable pinned game count", () => {
  // Game one is played out; game two is pinned closed at 3-1 (a cut ate
  // the rest) and the owner named the opponent as its winner (099). The
  // tally counts it; the summary carries the answer for the dividers.
  const points = build("UUUUUUUUUUU" + "UUUT.......E");
  points[points.length - 1].game_winner_override = "opponent";
  const score = computeMatchScore(points);
  assert.equal(score.games.length, 2);
  assert.deepEqual(score.games[1], {
    you: 3,
    them: 1,
    winnerOverride: "opponent",
  });
  assert.equal(score.gamesYou, 1);
  assert.equal(score.gamesThem, 1);
  const boundary = score.boundaryAfter.get(points[points.length - 1].id);
  assert.equal(boundary?.winnerOverride, "opponent");
});

test("resolvedGameWinner: the named winner beats the heuristic", () => {
  // Unprovable score, no answer: nobody.
  assert.equal(resolvedGameWinner({ you: 3, them: 1 }), null);
  // Unprovable score, named: the name.
  assert.equal(
    resolvedGameWinner({ you: 3, them: 1, winnerOverride: "opponent" }),
    "opponent"
  );
  // Provable score, no answer: the rule, unchanged.
  assert.equal(resolvedGameWinner({ you: 11, them: 6 }), "user");
  // A name always wins — human answer over heuristic.
  assert.equal(
    resolvedGameWinner({ you: 11, them: 6, winnerOverride: "opponent" }),
    "opponent"
  );
});

test("runningScoreByPoint: the score once each point was played", () => {
  const points = build("UUT.U");
  const scores = runningScoreByPoint(points);
  assert.deepEqual(scores.get("p0"), { you: 1, them: 0 });
  assert.deepEqual(scores.get("p1"), { you: 2, them: 0 });
  assert.deepEqual(scores.get("p2"), { you: 2, them: 1 });
  // A skipped or unscored point carries the standing score, unchanged.
  assert.deepEqual(scores.get("p3"), { you: 2, them: 1 });
  assert.deepEqual(scores.get("p4"), { you: 3, them: 1 });
});

test("runningScoreByPoint: a closing point carries the game's final", () => {
  const points = build("UUUUUUUUUUUT");
  const scores = runningScoreByPoint(points);
  // The 11th user point closes the game at 11-0…
  assert.deepEqual(scores.get("p10"), { you: 11, them: 0 });
  // …and the next point starts the next game from zero.
  assert.deepEqual(scores.get("p11"), { you: 0, them: 1 });
});

test("runningScoreByPoint: a pinned end closes wherever it lands", () => {
  const points = build("UUTET");
  const scores = runningScoreByPoint(points);
  assert.deepEqual(scores.get("p2"), { you: 2, them: 1 });
  assert.deepEqual(scores.get("p3"), { you: 0, them: 1 });
});

test("runningScoreByPoint agrees with computeMatchScore's boundaries", () => {
  const points = build("UUUUUUUUUUU" + "TTTTTTTTTTT" + "UUU");
  const scores = runningScoreByPoint(points);
  const match = computeMatchScore(points);
  for (const [id, boundary] of match.boundaryAfter) {
    assert.deepEqual(scores.get(id), {
      you: boundary.you,
      them: boundary.them,
    });
  }
  const last = points[points.length - 1];
  assert.deepEqual(scores.get(last.id), match.current);
});
