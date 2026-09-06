import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  highlightPointIdAt,
  parseHighlightResponse,
  type HighlightAsset,
} from "./highlights.ts";

const asset: HighlightAsset = {
  status: "ready",
  url: "https://media.example/highlights.mp4",
  durationS: 12.7,
  manifest: {
    v: 1,
    rule: "quality-first-v1",
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
      },
    ],
  },
};

test("decodes only a complete continuous ready asset", () => {
  assert.deepEqual(parseHighlightResponse(asset), asset);
  assert.equal(parseHighlightResponse({ status: "ready" }).status, "failed");
});

test("passes through non-playable server states", () => {
  for (const status of ["rendering", "empty", "unavailable", "failed"] as const) {
    assert.deepEqual(parseHighlightResponse({ status }), { status });
  }
});

test("maps an overlap to the incoming rally", () => {
  assert.equal(highlightPointIdAt(asset.manifest, 0), "p1");
  assert.equal(highlightPointIdAt(asset.manifest, 6.69), "p1");
  assert.equal(highlightPointIdAt(asset.manifest, 6.7), "p2");
  assert.equal(highlightPointIdAt(asset.manifest, 12.7), "p2");
});

test("web presentation has one row and no tape-seek implementation", () => {
  const row = readFileSync(new URL("./HighlightsRow.tsx", import.meta.url), "utf8");
  const player = readFileSync(new URL("./Player.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(row, /Short highlight|Long highlight|pickHighlights/);
  assert.match(row, /No highlight rallies/);
  assert.match(row, /Preparing highlights/);
  assert.match(row, /Highlights unavailable/);
  assert.doesNotMatch(player, /highlightSpans|tapeMove\(tape/);
  assert.match(player, /highlightAsset\.url/);
  assert.match(player, /target\.output_start_s/);
  assert.match(player, /if \(highlightAssetRef\.current\) return null;/);
});
