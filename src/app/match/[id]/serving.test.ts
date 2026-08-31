import assert from "node:assert/strict";
import test from "node:test";

import type { Point } from "../../../lib/types.ts";
import { computeServing, firstServerGuess } from "./serving.ts";

/**
 * The rotation had no tests at all until the serve balls were found to be
 * flipping the wrong way. Every case below is one someone hit.
 *
 * The MISSING RALLY fixture at the bottom is shared with
 * ios/Tests/ServingTests.swift verbatim, because serving.ts and
 * Serving.swift are line-for-line ports and the only thing stopping them
 * drifting is that they answer the same fixture the same way.
 */

/** Minimal point rows: only what the rotation reads. */
function pt(
  idx: number,
  winner: "user" | "opponent" | null,
  override: "user" | "opponent" | null = null,
  isLet = false
): Point {
  return {
    id: `p${idx}`,
    idx,
    t0: idx,
    confirmed_winner: winner,
    is_let: isLet,
    server_override: override,
    game_end_override: null,
  } as unknown as Point;
}

/**
 * `seq` reads one char per point: U/T scored, `.` unscored, `L` skipped.
 * `overrides` pins a correction on a point by index.
 */
function build(
  seq: string,
  overrides: Record<number, "user" | "opponent"> = {}
): Point[] {
  return [...seq].map((c, i) =>
    pt(
      i,
      c === "U" ? "user" : c === "T" ? "opponent" : null,
      overrides[i] ?? null,
      c === "L"
    )
  );
}

/** The served-by sequence as a string, "U"/"T"/"?" per point. */
function servers(
  seq: string,
  first: "user" | "opponent" | null,
  overrides: Record<number, "user" | "opponent"> = {}
): string {
  const points = build(seq, overrides);
  const serving = computeServing(points, first);
  return points
    .map((p) => {
      const s = serving.get(p.id)?.server;
      return s === "user" ? "U" : s === "opponent" ? "T" : "?";
    })
    .join("");
}

test("two serves each, alternating", () => {
  assert.equal(servers("....................", "user"), "UUTTUUTTUUTTUUTTUUTT");
  assert.equal(servers("....................", "opponent"), "TTUUTTUUTTUUTTUUTTUU");
});

test("no first server means no answer at all", () => {
  assert.equal(servers("....", null), "????");
});

test("one serve each from 10-10", () => {
  // Alternating winners: 10-10 is reached entering point 20.
  const alt = "UTUTUTUTUTUTUTUTUTUT" + "UTUTUT";
  assert.equal(
    servers(alt, "user"),
    "UUTTUUTTUUTTUUTTUUTT" + "UTUTUT"
  );
});

test("deuce is judged on the confirmed score, so unscored points hold it", () => {
  const reached = "UTUTUTUTUTUTUTUTUTUT" + "......";
  assert.equal(servers(reached, "user"), "UUTTUUTTUUTTUUTTUUTT" + "UTUTUT");
});

test("a skipped point is served again and does not advance the rotation", () => {
  // Without the skip: U U T T. With one skipped at index 1, the server
  // repeats there and the block picks up where it left off.
  assert.equal(servers("....", "user"), "UUTT");
  assert.equal(servers(".L..", "user"), "UUUT");
});

test("the first server alternates at a game boundary", () => {
  // User takes game one 11-0; the opponent starts game two.
  const g1 = "UUUUUUUUUUU";
  assert.equal(servers(g1 + "....", "user"), "UUTTUUTTUUT" + "TTUU");
});

test("a correction that agrees with the walk changes nothing", () => {
  const plain = servers("....................", "user");
  // Point 5 already reads "user" under the plain rotation.
  assert.equal(servers("....................", "user", { 5: "user" }), plain);
});

test("a correction re-anchors every later point", () => {
  //                                    0123456789
  assert.equal(servers("..........", "user"), "UUTTUUTTUU");
  assert.equal(
    servers("..........", "user", { 4: "opponent" }),
    "UUTTTTUUTT"
  );
});

test("a correction starts a new two-serve block", () => {
  // The point of the change: correcting mid-block moves the block with
  // it, rather than relabelling one point and leaving the phase behind.
  // Point 5 corrected to "them" means them serving 5 AND 6.
  assert.equal(servers("..........", "user"), "UUTTUUTTUU");
  assert.equal(
    servers("..........", "user", { 5: "opponent" }),
    "UUTTUTTUUT"
  );
});

test("a correction clears nothing by itself — later ones still win", () => {
  // The walk anchors to the most recent override before each point. This
  // is why set_server_override (migration 100) clears the corrections
  // after the one being written: the walk alone cannot ignore them.
  assert.equal(
    servers("............", "user", { 4: "opponent", 8: "user" }),
    "UUTTTTUUUUTT"
  );
});

test("a correction carries across a game boundary", () => {
  const g1 = "UUUUUUUUUUU";
  const plain = servers(g1 + "....", "user");
  const fixed = servers(g1 + "....", "user", { 2: "user" });
  assert.equal(plain, "UUTTUUTTUUTTTUU");
  // Every point from the correction on is inverted, game two included.
  assert.equal(fixed, "UUUUTTUUTTUUUTT");
});

test("source names where the answer came from", () => {
  const points = build("....", { 2: "opponent" });
  const serving = computeServing(points, "user");
  assert.equal(serving.get("p0")?.source, "rotation");
  assert.equal(serving.get("p2")?.source, "override");
  const none = computeServing(build("...."), null);
  assert.equal(none.get("p0")?.source, "auto");
});

/**
 * THE MISSING RALLY — the fixture shared with iOS.
 *
 * Thirteen rallies were played. The cut dropped the sixth, so the app has
 * twelve cards and every card after the gap is on the wrong server — and
 * wrong on every OTHER card, which is what made it read as broken rather
 * than merely inverted.
 *
 * One correction on the first card after the gap has to fix all of it.
 * Before the block reset it took a correction on all seven.
 */
const MISSING_RALLY = {
  truth: "UUTTUTTUUTTU",
  withoutFix: "UUTTUUTTUUTT",
  cardAfterTheGap: 5,
};

test("one correction fixes a rally the cut missed", () => {
  const twelveCards = "............";
  assert.equal(servers(twelveCards, "user"), MISSING_RALLY.withoutFix);
  assert.equal(
    servers(twelveCards, "user", {
      [MISSING_RALLY.cardAfterTheGap]: "opponent",
    }),
    MISSING_RALLY.truth
  );
});

test("firstServerGuess reads the detector through user_side", () => {
  const near = [
    { server: "user" },
    { server: "user" },
  ] as unknown as Point[];
  assert.equal(firstServerGuess(near, "near"), "user");
  assert.equal(firstServerGuess(near, "far"), "opponent");
  assert.equal(firstServerGuess(near, null), null);
  assert.equal(firstServerGuess([{ server: null }] as unknown as Point[], "near"), null);
});
