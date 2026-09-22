import assert from "node:assert/strict";
import test from "node:test";
import type { Point } from "../../../lib/types.ts";
import {
  canonical,
  manifestSeconds,
  storyNames,
  walkManifestPoints,
} from "./manifest.ts";

/**
 * The walk both the match exports and the starred selection build from.
 * It moved out of /api/reel on 2026-09-22 so the selection could not grow
 * a second copy; these cases pin what it returned there.
 */

function pt(over: Partial<Point>): Point {
  return {
    id: "p",
    match_id: "m",
    idx: 0,
    t0: 0,
    t1: 5,
    cut_t0: 0,
    clip_path: "r2://ponglens-media/points/u/m/p.mp4",
    starred: false,
    deleted: false,
    edited: false,
    is_let: false,
    confirmed_winner: null,
    game_end_override: null,
    game_winner_override: null,
    tight_start: false,
    tight_end: false,
    scored_at_cut_s: null,
    rally_end_cut_s: null,
    ...over,
  } as unknown as Point;
}

const pad = { pre: 1, post: 1 };
const ends = { tapEnd: false };

test("each included rally carries the score entering it, over every point", () => {
  const ordered = [
    pt({ id: "a", idx: 0, t0: 0, t1: 5, cut_t0: 0, confirmed_winner: "user" }),
    pt({ id: "b", idx: 1, t0: 10, t1: 14, cut_t0: 7, confirmed_winner: "opponent", starred: true }),
    pt({ id: "c", idx: 2, t0: 20, t1: 22, cut_t0: 12, is_let: true, confirmed_winner: "user" }),
    pt({ id: "d", idx: 3, t0: 30, t1: 36, cut_t0: 16, starred: true }),
    pt({ id: "e", idx: 4, t0: 40, t1: 44, cut_t0: 25, starred: true, clip_path: null }),
  ];
  const { points, hasScore } = walkManifestPoints(
    ordered,
    (p) => p.starred,
    pad,
    ends,
  );
  assert.equal(hasScore, true);
  // A clipless point never lands, whatever the predicate says.
  assert.deepEqual(points.map((p) => p.point_id), ["b", "d"]);
  assert.deepEqual(
    points.map((p) => [p.score_you, p.score_them]),
    [[1, 0], [1, 1]], // the let scored nothing
  );
  // cut_t0 plus the rally and both pads.
  assert.deepEqual([points[0].seg_start, points[0].seg_end], [7, 13]);
  assert.equal(manifestSeconds(points), 6 + 8);
});

test("a game boundary moves into games_detail and the games count", () => {
  const ordered = Array.from({ length: 12 }, (_, i) =>
    pt({
      id: `g${i}`,
      idx: i,
      t0: i * 10,
      t1: i * 10 + 4,
      cut_t0: i * 6,
      confirmed_winner: i < 11 ? "user" : "opponent",
      starred: i === 11,
    }),
  );
  const { points } = walkManifestPoints(ordered, (p) => p.starred, pad, ends);
  assert.equal(points.length, 1);
  assert.equal(points[0].games_you, 1);
  assert.deepEqual(points[0].games_detail, [[11, 0]]);
  assert.deepEqual([points[0].score_you, points[0].score_them], [0, 0]);
});

test("fixed bounds replace the computed window", () => {
  const { points } = walkManifestPoints(
    [pt({ id: "a" })],
    () => true,
    pad,
    ends,
    new Map([["a", { cut_start_s: 1.234, cut_end_s: 4.567 }]]),
  );
  assert.deepEqual([points[0].seg_start, points[0].seg_end], [1.23, 4.57]);
});

test("names: the owner's tagged side, then the account, then Player", () => {
  const base = {
    player_near_name: "Adil",
    player_far_name: "Jordan",
    opponent_name: "Jordan K",
    user_side: "near",
  };
  assert.deepEqual(storyNames(base, {}), { you: "Adil", them: "Jordan" });
  assert.deepEqual(storyNames({ ...base, user_side: "far" }, {}), {
    you: "Jordan",
    them: "Adil",
  });
  assert.deepEqual(
    storyNames(
      { ...base, player_near_name: null, player_far_name: null },
      { full_name: "Adil Haris" },
    ),
    { you: "Adil", them: "Jordan K" },
  );
  assert.deepEqual(
    storyNames(
      { player_near_name: null, player_far_name: null, opponent_name: null, user_side: null },
      undefined,
    ),
    { you: "Player", them: "Opponent" },
  );
});

test("a jsonb round trip still compares equal", () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 3, c: 4 }] }), canonical({ a: [2, { c: 4, d: 3 }], b: 1 }));
});
