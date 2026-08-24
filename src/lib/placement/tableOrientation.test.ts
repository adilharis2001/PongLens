import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  TABLE_LENGTH_M,
  TABLE_WIDTH_M,
  normalizePlacementCoordinates,
} from "./placementAggregate.ts";

/**
 * Is the ball drawn on the side of the table it actually landed on?
 *
 * Every placement map PongLens drew before 2026-08-23 was mirrored left to
 * right, on every match, and the unit test covering the transform passed
 * throughout. It asserted `normalize(0.1, "near")` returns 1.425 — which is
 * a restatement of the code, true whichever way round the code is. A test
 * like that cannot fail for the one reason the function exists.
 *
 * So this one never mentions a coordinate. It reads real bounces that carry
 * BOTH their pixel position and their table coordinate, works out from the
 * PICTURE which side of the table each one is on, and checks the app agrees.
 * Two matches, two camera placements, both user sides.
 *
 * The worker's convention, which this pins:
 *
 *   u = 0 is corner A, the near end and the camera's left. v = 0 is the
 *   near end line. (`table_coordinates.table_homography` maps the
 *   canonicalised quad A,B,C,D onto (0,0), (W,0), (W,L), (0,L).)
 *
 * Camera-left at the near end is the NEAR player's left, because the near
 * end is by construction the one lower in the frame, so that player faces
 * away from the camera. The same sideline is therefore the FAR player's
 * right.
 */

interface Fixture {
  matches: {
    id: string;
    camera: string;
    corners: Record<string, [number, number]>;
    bounces: { u: number; v: number; x: number; y: number }[];
  }[];
}

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/table-orientation.json", import.meta.url),
    "utf8",
  ),
) as Fixture;

type Point = [number, number];
const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** Which side of the a→b line a point falls on, as a sign. */
function sideOf(x: number, y: number, a: Point, b: Point): number {
  return Math.sign((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]));
}

for (const match of fixture.matches) {
  const A = match.corners.A_near_1;
  const B = match.corners.B_near_2;
  const C = match.corners.C_far_2;
  const D = match.corners.D_far_1;
  const nearMid = mid(A, B);
  const farMid = mid(C, D);

  test(`${match.id}: the near end really is the one nearer the camera`, () => {
    // The precondition the whole derivation rests on. If a camera is ever
    // placed beyond the far end this fails loudly, instead of every map in
    // the app quietly mirroring again.
    const nearY = (A[1] + B[1]) / 2;
    const farY = (C[1] + D[1]) / 2;
    assert.ok(
      nearY > farY,
      `near end line should sit lower in the frame (near y=${nearY}, far y=${farY})`,
    );
  });

  test(`${match.id}: u = 0 is the A sideline`, () => {
    // Pins the worker's half of the contract. If the homography's
    // destination quad is ever reordered, this is where it shows up.
    const sideOfA = sideOf(A[0], A[1], nearMid, farMid);
    const low = match.bounces.filter((b) => b.u < TABLE_WIDTH_M / 2);
    const high = match.bounces.filter((b) => b.u > TABLE_WIDTH_M / 2);
    assert.ok(low.length > 10 && high.length > 10, "fixture covers both halves");
    for (const b of low) {
      assert.equal(
        sideOf(b.x, b.y, nearMid, farMid),
        sideOfA,
        `u=${b.u} should be on A's side of the table`,
      );
    }
    for (const b of high) {
      assert.equal(
        sideOf(b.x, b.y, nearMid, farMid),
        -sideOfA,
        `u=${b.u} should be on B's side of the table`,
      );
    }
  });

  for (const bottom of ["near", "far"] as const) {
    test(`${match.id}: with the ${bottom} player at the bottom, every bounce is drawn on the side it landed`, () => {
      const sideOfA = sideOf(A[0], A[1], nearMid, farMid);
      let checked = 0;
      for (const b of match.bounces) {
        // From the picture: is this bounce on the A sideline or the B one?
        const onASide = sideOf(b.x, b.y, nearMid, farMid) === sideOfA;
        // A is the near player's LEFT, so it is the far player's RIGHT.
        const onBottomPlayersLeft = bottom === "near" ? onASide : !onASide;

        // From the app: the map draws u = 0 at its left edge.
        const drawn = normalizePlacementCoordinates(b.u, b.v, bottom);
        const drawnLeft = drawn.u < TABLE_WIDTH_M / 2;

        assert.equal(
          drawnLeft,
          onBottomPlayersLeft,
          `bounce (u=${b.u}, v=${b.v}) at pixel (${b.x}, ${b.y}) landed on the `
            + `${bottom} player's ${onBottomPlayersLeft ? "left" : "right"} but is `
            + `drawn on the ${drawnLeft ? "left" : "right"}`,
        );
        checked += 1;
      }
      assert.ok(checked >= 60, `checked ${checked} bounces`);
    });

    test(`${match.id}: with the ${bottom} player at the bottom, their own end is at the bottom`, () => {
      // Depth was never wrong, and this keeps it that way while u moves.
      const ownEnd = bottom === "near" ? 0.2 : TABLE_LENGTH_M - 0.2;
      const theirEnd = bottom === "near" ? TABLE_LENGTH_M - 0.2 : 0.2;
      const own = normalizePlacementCoordinates(TABLE_WIDTH_M / 2, ownEnd, bottom);
      const theirs = normalizePlacementCoordinates(TABLE_WIDTH_M / 2, theirEnd, bottom);
      assert.ok(own.v < TABLE_LENGTH_M / 2, "the bottom player's end normalizes low");
      assert.ok(theirs.v > TABLE_LENGTH_M / 2, "the other end normalizes high");
    });
  }
}
