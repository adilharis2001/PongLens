import assert from "node:assert/strict";
import test from "node:test";
import {
  automaticHighlightEnd,
  highlightManifestIsFresh,
  highlightPointsRevision,
} from "./endPolicy.ts";

test("a scoring tap is the authoritative automatic-highlight end", () => {
  assert.equal(
    automaticHighlightEnd({
      t0: 20,
      cut_t0: 10,
      scored_at_cut_s: 15.4,
      rally_end_cut_s: 17,
    }),
    15.6,
  );
});

test("an unscored highlight ends a quarter-second after detector evidence", () => {
  assert.equal(
    automaticHighlightEnd({
      t0: 20,
      cut_t0: 10,
      scored_at_cut_s: null,
      rally_end_cut_s: 17,
    }),
    17.25,
  );
  assert.equal(
    automaticHighlightEnd({
      t0: 20,
      cut_t0: 10,
      scored_at_cut_s: null,
      rally_end_cut_s: null,
      highlight_evidence: { observed_end_s: 27 },
    }),
    17.25,
  );
});

test("a stale scoring tap does not fall through to weaker detector evidence", () => {
  assert.equal(
    automaticHighlightEnd({
      t0: 20,
      cut_t0: 10,
      scored_at_cut_s: 9.99,
      rally_end_cut_s: 17,
    }),
    null,
  );
});

test("the full point revision matches the worker's canonical form", () => {
  assert.equal(
    highlightPointsRevision([
      {
        id: "a",
        idx: 1,
        t0: 20,
        t1: 28,
        cut_t0: 10,
        scored_at_cut_s: 16.2,
        rally_end_cut_s: 17,
        clip_path: "r2://bucket/a.mp4",
        deleted: false,
        edited: false,
        is_let: false,
        highlight_evidence: {
          v: 2,
          status: "ready",
          n_hits: 5,
          connected_crossings: 5,
          alternating_table_landings: 2,
          table_bounces: 2,
          observed_end_s: 27,
        },
      },
    ]),
    "b2fd791b181c72732060945086001cd8b2208a993b42edf7719fae5c6ddc4548",
  );
});

test("a tap on an unselected point makes the stored reel stale", () => {
  const points = [
    {
      id: "selected",
      idx: 1,
      t0: 20,
      t1: 28,
      cut_t0: 10,
      scored_at_cut_s: 15.4,
      rally_end_cut_s: 17,
      clip_path: "r2://bucket/selected.mp4",
      deleted: false,
      edited: false,
      is_let: false,
      highlight_evidence: {
        v: 2,
        status: "ready",
        n_hits: 5,
        connected_crossings: 5,
        alternating_table_landings: 2,
        table_bounces: 2,
        observed_end_s: 27,
      },
    },
    {
      id: "not-selected",
      idx: 2,
      t0: 40,
      t1: 48,
      cut_t0: 30,
      scored_at_cut_s: null,
      rally_end_cut_s: 37,
      clip_path: "r2://bucket/not-selected.mp4",
      deleted: false,
      edited: false,
      is_let: false,
      highlight_evidence: {
        v: 2,
        status: "ready",
        n_hits: 5,
        connected_crossings: 5,
        alternating_table_landings: 2,
        table_bounces: 2,
        observed_end_s: 47,
      },
    },
  ];
  const manifest = {
    points_revision: highlightPointsRevision(points),
    points: [{ point_id: "selected", cut_start_s: 10, cut_end_s: 15.6 }],
  };
  assert.equal(highlightManifestIsFresh(points, manifest), true);
  points[1].scored_at_cut_s = 35;
  assert.equal(highlightManifestIsFresh(points, manifest), false);
});
