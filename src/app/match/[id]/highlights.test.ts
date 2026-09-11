import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  highlightLifecycleView,
  highlightPointIdAt,
  highlightRequestSheetIsVisible,
  parseHighlightResponse,
  type HighlightAsset,
} from "./highlights.ts";

const asset: HighlightAsset = {
  status: "ready",
  url: "https://media.example/highlights.mp4",
  durationS: 12.7,
  manifest: {
    v: 2,
    rule: "quality-first-v2",
    max_seconds: 150,
    points_revision: "abc",
    duration_s: 12.7,
    points: [
      {
        point_id: "p1",
        cut_start_s: 10,
        cut_end_s: 17,
        output_start_s: 0,
        output_end_s: 7,
        n_hits: 8,
        connected_crossings: 7,
        table_bounces: 4,
        alternating_table_landings: 5,
      },
      {
        point_id: "p2",
        cut_start_s: 30,
        cut_end_s: 36,
        output_start_s: 6.7,
        output_end_s: 12.7,
        n_hits: 6,
        connected_crossings: 5,
        table_bounces: 3,
        alternating_table_landings: 4,
      },
    ],
  },
};

test("decodes only a complete continuous ready asset", () => {
  assert.deepEqual(parseHighlightResponse(asset), asset);
  assert.equal(parseHighlightResponse({ status: "ready" }).status, "failed");
});

test("passes through non-playable server states", () => {
  for (const status of [
    "rendering",
    "needs_generation",
    "needs_update",
    "updating",
    "empty",
    "unavailable",
    "failed",
  ] as const) {
    assert.deepEqual(parseHighlightResponse({ status }), { status });
  }
});

test("decodes score coverage only for the score-gated state", () => {
  const gated = {
    status: "needs_scoring",
    scoredPoints: 7,
    scorablePoints: 10,
    requiredPoints: 8,
    requiredPercent: 75,
    eligible: false,
  };
  assert.deepEqual(parseHighlightResponse(gated), gated);
  assert.equal(
    parseHighlightResponse({ status: "needs_scoring", scoredPoints: 7 }).status,
    "failed",
  );
});

test("below 75 percent uses the existing sheet for one scoring action", () => {
  assert.deepEqual(
    highlightLifecycleView({
      status: "needs_scoring",
      scoredPoints: 7,
      scorablePoints: 10,
      requiredPoints: 8,
      requiredPercent: 75,
    }),
    {
      rowSummary: "7 of 10 scored",
      sheetTitle: "Score more of this match",
      body: "Score at least 75% of the points before generating highlights. You've scored 7 of 10.",
      actionLabel: "Score the Match",
      actionKind: "score",
      shouldPoll: false,
    },
  );
});

test("stale highlights ask before spending compute", () => {
  assert.deepEqual(highlightLifecycleView({ status: "needs_generation" }), {
    rowSummary: "Generate",
    sheetTitle: "Generate highlights?",
    body: "Highlights haven't been generated for this match. You can generate them from Tools.",
    actionLabel: "Generate highlights",
    shouldPoll: false,
  });
  assert.deepEqual(highlightLifecycleView({ status: "needs_update" }), {
    rowSummary: "Update needed",
    sheetTitle: "Update highlights",
    body: "This match changed after these highlights were prepared. Update them to use your latest rally edits.",
    actionLabel: "Update highlights",
    shouldPoll: false,
  });
  assert.deepEqual(highlightLifecycleView({ status: "updating" }), {
    rowSummary: "Updating rally clips",
    sheetTitle: "Highlights",
    body: "Your rally clips are still updating. You can update highlights when they’re ready.",
    actionLabel: null,
    shouldPoll: true,
  });
  assert.equal(
    highlightLifecycleView({ status: "rendering" }).rowSummary,
    "Preparing highlights",
  );
});

test("the request sheet stops owning page scroll once highlights become ready", () => {
  assert.equal(
    highlightRequestSheetIsVisible(true, { status: "rendering" }),
    true,
  );
  assert.equal(highlightRequestSheetIsVisible(true, asset), false);
  assert.equal(
    highlightRequestSheetIsVisible(false, { status: "needs_update" }),
    false,
  );
});

test("maps an overlap to the incoming rally", () => {
  assert.equal(highlightPointIdAt(asset.manifest, 0), "p1");
  assert.equal(highlightPointIdAt(asset.manifest, 6.69), "p1");
  assert.equal(highlightPointIdAt(asset.manifest, 6.7), "p2");
  assert.equal(highlightPointIdAt(asset.manifest, 12.7), "p2");
});

test("web presentation has one row and no tape-seek implementation", () => {
  const row = readFileSync(new URL("./HighlightsRow.tsx", import.meta.url), "utf8");
  const state = readFileSync(new URL("./highlights.ts", import.meta.url), "utf8");
  const player = readFileSync(new URL("./Player.tsx", import.meta.url), "utf8");
  const matchView = readFileSync(new URL("./MatchView.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(row, /Short highlight|Long highlight|pickHighlights/);
  assert.match(state, /No highlight rallies/);
  assert.match(state, /Preparing highlights/);
  assert.match(state, /Highlights unavailable/);
  assert.doesNotMatch(player, /highlightSpans|tapeMove\(tape/);
  assert.match(player, /highlightAsset\.url/);
  assert.match(player, /target\.output_start_s/);
  assert.match(player, /if \(highlightAssetRef\.current\) return null;/);
  assert.match(row, /onScore/);
  assert.match(row, /min-h-11 w-full/);
  assert.match(matchView, /onScore=\{\(\) => playerRef\.current\?\.openScore\(\)\}/);
});
