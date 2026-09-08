import assert from "node:assert/strict";
import test from "node:test";
import * as shareData from "./shareData.ts";
import type { ResolvedSharePoint } from "./shareData.ts";

const point = (id: string, cutT0: number): ResolvedSharePoint => ({
  id,
  idx: 0,
  t0: 0,
  t1: 8,
  cut_t0: cutT0,
  clip_path: null,
  starred: false,
  is_let: false,
  confirmed_winner: null,
  game_end_override: null,
  game_winner_override: null,
  server: null,
  server_override: null,
  placement_flagged: false,
});

test("a public highlight link names the reel and its players", () => {
  assert.equal(
    shareData.highlightContextLine("Adil vs Jordan"),
    "Highlights · Adil vs Jordan",
  );
  assert.equal(shareData.highlightContextLine(null), "Highlights");
});

test("highlight playback uses output time and keeps full-match score indexes", () => {
  const points = [point("p1", 14), point("p2", 42), point("p3", 88)];
  const result = shareData.buildSharePlaybackTimeline(
    "highlights",
    points,
    [
      { point_id: "p2", output_start_s: 0, output_end_s: 8 },
      { point_id: "p3", output_start_s: 7.7, output_end_s: 18 },
    ],
  );
  assert.deepEqual(result, [
    { at: 0, end: 8, pointId: "p2", pointIndex: 1 },
    { at: 7.7, end: 18, pointId: "p3", pointIndex: 2 },
  ]);
});

test("whole-match playback stays on the cut clock", () => {
  const result = shareData.buildSharePlaybackTimeline(
    "match",
    [point("p1", 14), point("p2", 42)],
    [{ point_id: "p2", output_start_s: 0, output_end_s: 8 }],
  );
  assert.deepEqual(result, [
    { at: 14, end: null, pointId: "p1", pointIndex: 0 },
    { at: 42, end: null, pointId: "p2", pointIndex: 1 },
  ]);
});

test("unknown, malformed, and reversed highlight segments cannot move the score", () => {
  const result = shareData.buildSharePlaybackTimeline(
    "highlights",
    [point("p1", 14), point("p2", 42)],
    [
      { point_id: "missing", output_start_s: 0, output_end_s: 8 },
      { point_id: "p1", output_start_s: Number.NaN, output_end_s: 8 },
      { point_id: "p2", output_start_s: 9, output_end_s: 8 },
    ],
  );
  assert.deepEqual(result, []);
});

test("highlight timeline is sorted by output time", () => {
  const result = shareData.buildSharePlaybackTimeline(
    "highlights",
    [point("p1", 14), point("p2", 42)],
    [
      { point_id: "p2", output_start_s: 7.7, output_end_s: 18 },
      { point_id: "p1", output_start_s: 0, output_end_s: 8 },
    ],
  );
  assert.deepEqual(result.map((entry) => entry.pointId), ["p1", "p2"]);
});
