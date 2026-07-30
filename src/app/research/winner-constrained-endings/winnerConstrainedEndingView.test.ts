import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPredictionWithheld,
  endingExplanation,
  parseWinnerConstrainedSource,
} from "./winnerConstrainedEndingView.ts";

const safeSource = {
  id: "source-id",
  source_point_idx: 11,
  match_label: "Vaibhav",
  duration_s: 12.5,
  proposal: {
    schema_version: 1,
    match: { label: "Vaibhav", venue: "PingPod" },
    scoring: {
      server: { player: "opponent", name: "Vaibhav", side: "far" },
      winner: { player: "user", name: "Adil", side: "near" },
    },
    detected_serve_boundary: { available: true },
    automatic_prediction_withheld: true,
    video: { duration_s: 12.5, fps: 30, frame_count: 375 },
  },
};

test("browser source exposes scoring context but no automatic ending", () => {
  const parsed = parseWinnerConstrainedSource(safeSource);
  assert.equal(parsed.proposal.scoring.server.name, "Vaibhav");
  assert.equal(parsed.proposal.scoring.winner.name, "Adil");
  assert.equal(parsed.proposal.detected_serve_boundary.available, true);
  assert.doesNotThrow(() => assertPredictionWithheld(parsed));
});

test("prediction-like evidence is recursively rejected", () => {
  for (const leakedKey of [
    "prediction",
    "evidence",
    "alternatives",
    "confidence",
  ]) {
    assert.throws(
      () =>
        parseWinnerConstrainedSource({
          ...safeSource,
          proposal: {
            ...safeSource.proposal,
            nested: { [leakedKey]: "net" },
          },
        }),
      /withheld/i,
    );
  }
});

test("player-facing error explanation names the confirmed loser", () => {
  assert.equal(
    endingExplanation("net", safeSource.proposal.scoring),
    "Vaibhav's final shot hit the net.",
  );
  assert.equal(
    endingExplanation("clean_winner", safeSource.proposal.scoring),
    "Adil hit a shot that Vaibhav did not touch.",
  );
});
