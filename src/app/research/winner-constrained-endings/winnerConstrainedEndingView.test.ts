import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPredictionWithheld,
  effectiveScoring,
  endingExplanation,
  effectiveServer,
  receiverForServer,
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
    "net_behavior_note",
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

test("a human correction replaces the imported server without changing the winner", () => {
  const scoring = parseWinnerConstrainedSource(safeSource).proposal.scoring;
  const server = effectiveServer(scoring, {
    server_review: "corrected",
    corrected_server: "user",
  });
  const receiver = receiverForServer(scoring, server);

  assert.equal(server.name, "Adil");
  assert.equal(server.side, "near");
  assert.equal(receiver.name, "Vaibhav");
  assert.equal(scoring.winner.name, "Adil");
});

test("unreviewed and unsure server values retain the imported value for display", () => {
  const scoring = parseWinnerConstrainedSource(safeSource).proposal.scoring;
  assert.equal(effectiveServer(scoring, null).name, "Vaibhav");
  assert.equal(
    effectiveServer(scoring, {
      server_review: "unsure",
      corrected_server: null,
    }).name,
    "Vaibhav",
  );
});

test("winner correction changes winner and loser while preserving reviewed server", () => {
  const scoring = parseWinnerConstrainedSource(safeSource).proposal.scoring;
  const reviewed = effectiveScoring(scoring, {
    server_review: "corrected",
    corrected_server: "user",
    winner_review: "corrected",
    corrected_winner: "opponent",
  });

  assert.equal(reviewed.server.name, "Adil");
  assert.equal(reviewed.winner.name, "Vaibhav");
  assert.equal(reviewed.loser.name, "Adil");
  assert.equal(
    endingExplanation("net", reviewed),
    "Adil's final shot hit the net.",
  );
  assert.equal(
    endingExplanation("clean_winner", reviewed),
    "Vaibhav hit a shot that Adil did not touch.",
  );
});
