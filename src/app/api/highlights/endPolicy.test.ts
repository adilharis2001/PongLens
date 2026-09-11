import assert from "node:assert/strict";
import test from "node:test";
import {
  automaticHighlightEvidenceRefreshNeeded,
  automaticHighlightReadDecision,
  automaticHighlightRequestDecision,
  automaticHighlightEnd,
  highlightManifestIsFresh,
  highlightPointsRevision,
  supportsScoredHighlights,
} from "./endPolicy.ts";

test("only scored match types can request new highlights", () => {
  assert.equal(supportsScoredHighlights("match"), true);
  assert.equal(supportsScoredHighlights("tournament"), true);
  assert.equal(supportsScoredHighlights("practice"), false);
  assert.equal(supportsScoredHighlights("drills"), false);
});

test("only missing version-2 evidence asks the worker to remeasure rallies", () => {
  const base = {
    id: "point",
    idx: 1,
    t0: 1,
    t1: 2,
    clip_path: "r2://media/point.mp4",
    deleted: false,
    edited: false,
    confirmed_winner: "user",
  };
  assert.equal(
    automaticHighlightEvidenceRefreshNeeded([
      { ...base, highlight_evidence: null },
    ]),
    true,
  );
  assert.equal(
    automaticHighlightEvidenceRefreshNeeded([
      { ...base, highlight_evidence: { v: 2, status: "ready" } },
    ]),
    false,
  );
  assert.equal(
    automaticHighlightEvidenceRefreshNeeded([
      { ...base, deleted: true, highlight_evidence: null },
    ]),
    false,
  );
  assert.equal(
    automaticHighlightEvidenceRefreshNeeded([
      { ...base, is_let: true, clip_path: "r2://media/let.mp4", highlight_evidence: null },
    ]),
    false,
  );
  assert.equal(
    automaticHighlightEvidenceRefreshNeeded([
      { ...base, clip_path: null, highlight_evidence: null },
    ]),
    false,
  );
  assert.equal(
    automaticHighlightEvidenceRefreshNeeded([
      { ...base, confirmed_winner: null, highlight_evidence: null },
    ]),
    false,
  );
});

test("score coverage gates missing, empty, failed, and stale reels", () => {
  for (const [hasReel, reelStatus, manifestFresh] of [
    [false, null, false],
    [true, "empty", true],
    [true, "failed", true],
    [true, "ready", false],
  ] as const) {
    assert.deepEqual(
      automaticHighlightReadDecision({
        hasReel,
        reelStatus,
        manifestFresh,
        pointsUpdating: false,
        scoreEligible: false,
      }),
      { status: "needs_scoring" },
    );
  }
});

test("in-flight and current legacy reels take priority over the score gate", () => {
  assert.deepEqual(
    automaticHighlightReadDecision({
      hasReel: true,
      reelStatus: "rendering",
      manifestFresh: false,
      pointsUpdating: false,
      scoreEligible: false,
    }),
    { status: "rendering" },
  );
  assert.deepEqual(
    automaticHighlightReadDecision({
      hasReel: true,
      reelStatus: "ready",
      manifestFresh: true,
      pointsUpdating: false,
      scoreEligible: false,
    }),
    { status: "ready" },
  );
  assert.equal(
    automaticHighlightRequestDecision({
      hasReel: false,
      reelStatus: null,
      manifestFresh: false,
      pointsUpdating: false,
      scoreEligible: false,
    }),
    "score_required",
  );
});

test("a ready match without a reel waits for an explicit request", () => {
  assert.deepEqual(
    automaticHighlightReadDecision({
      hasReel: false,
      reelStatus: null,
      manifestFresh: false,
      pointsUpdating: false,
    }),
    { status: "needs_generation" },
  );
  assert.deepEqual(
    automaticHighlightReadDecision({
      hasReel: true,
      reelStatus: "ready",
      manifestFresh: false,
      pointsUpdating: false,
    }),
    { status: "needs_update" },
  );
});

test("edited rally clips settle before an explicit highlight update", () => {
  assert.deepEqual(
    automaticHighlightReadDecision({
      hasReel: true,
      reelStatus: "ready",
      manifestFresh: false,
      pointsUpdating: true,
    }),
    { status: "updating" },
  );
  assert.deepEqual(
    automaticHighlightReadDecision({
      hasReel: false,
      reelStatus: null,
      manifestFresh: false,
      pointsUpdating: true,
    }),
    { status: "updating" },
  );
});

test("a missing reel can be explicitly requested once rally clips are settled", () => {
  assert.equal(
    automaticHighlightRequestDecision({
      hasReel: false,
      reelStatus: null,
      manifestFresh: false,
      pointsUpdating: false,
    }),
    "enqueue",
  );
  assert.equal(
    automaticHighlightRequestDecision({
      hasReel: false,
      reelStatus: null,
      manifestFresh: false,
      pointsUpdating: true,
    }),
    "clips_updating",
  );
});

test("ready and in-flight reel states do not enqueue again", () => {
  for (const [reelStatus, status] of [
    ["ready", "ready"],
    ["queued", "rendering"],
    ["rendering", "rendering"],
  ] as const) {
    assert.deepEqual(
      automaticHighlightReadDecision({
        hasReel: true,
        reelStatus,
        manifestFresh: true,
        pointsUpdating: false,
      }),
      { status },
    );
  }
});

test("eligible empty and failed legacy reels can be explicitly generated again", () => {
  for (const reelStatus of ["empty", "failed"] as const) {
    assert.deepEqual(
      automaticHighlightReadDecision({
        hasReel: true,
        reelStatus,
        manifestFresh: true,
        pointsUpdating: false,
        scoreEligible: true,
      }),
      { status: "needs_generation" },
    );
    assert.equal(
      automaticHighlightRequestDecision({
        hasReel: true,
        reelStatus,
        manifestFresh: true,
        pointsUpdating: false,
        scoreEligible: true,
      }),
      "enqueue",
    );
  }
});

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

test("a scored-only manifest becomes stale when a rally is unscored, not when its winner changes", () => {
  const points = [{
    id: "selected", idx: 1, t0: 20, t1: 28, cut_t0: 10,
    scored_at_cut_s: 15.4, rally_end_cut_s: 17,
    clip_path: "r2://bucket/selected.mp4", deleted: false, edited: false,
    is_let: false, confirmed_winner: "user" as string | null,
    highlight_evidence: { v: 2, status: "ready", n_hits: 5,
      connected_crossings: 5, alternating_table_landings: 2,
      table_bounces: 2, observed_end_s: 27 },
  }];
  const manifest = {
    scored_only: true,
    points_revision: highlightPointsRevision(points, true),
    points: [{ point_id: "selected", cut_start_s: 10, cut_end_s: 15.6 }],
  };
  assert.equal(highlightManifestIsFresh(points, manifest), true);
  points[0].confirmed_winner = "opponent";
  assert.equal(highlightManifestIsFresh(points, manifest), true);
  points[0].confirmed_winner = null;
  assert.equal(highlightManifestIsFresh(points, manifest), false);
});
