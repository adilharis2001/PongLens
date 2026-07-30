import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PlacementCalibrationProposal } from "../../../lib/research/placementCalibration.ts";
import { effectivePlacementProposal } from "../../../lib/research/placementCalibration.ts";
import {
  describePlacementMark,
  eventInstruction,
  latestAnswerNotice,
  placementCompletionRequiresComparison,
  revealButtonLabel,
  tablePointToSvg,
} from "./placementCalibrationView.ts";

function proposal(
  patch: Partial<PlacementCalibrationProposal> = {},
): PlacementCalibrationProposal {
  return {
    schema_version: 1,
    event_id: "event-1",
    event_time_s: 1.25,
    event_description: "Serve second bounce",
    phase: "serve",
    shot_seq: 1,
    scored_server: "opponent",
    hitter_side: "far",
    receiver_side: "near",
    user_side: "near",
    predictions: {
      legacy_current: null,
      canonical_current: null,
      openai: null,
    },
    ...patch,
  };
}

test("serve instructions ask for the scored server's second bounce", () => {
  assert.equal(
    eventInstruction(proposal(), {
      userName: "You",
      opponentName: "Chris",
    }),
    "Chris's serve — mark the second bounce on your side",
  );
});

test("return and rally instructions name the observable post-contact bounce", () => {
  assert.equal(
    eventInstruction(
      proposal({
        phase: "return",
        shot_seq: 2,
        scored_server: "user",
        hitter_side: "far",
        receiver_side: "near",
        user_side: "near",
      }),
      { userName: "You", opponentName: "Chris" },
    ),
    "Chris's return — mark the first table bounce after contact on your side",
  );
  assert.equal(
    eventInstruction(
      proposal({
        phase: "rally",
        shot_seq: 5,
        scored_server: "user",
        hitter_side: "near",
        receiver_side: "far",
        user_side: "near",
      }),
      { userName: "You", opponentName: "Chris" },
    ),
    "Your shot 5 — mark the first table bounce after contact on Chris's side",
  );
});

test("a corrected opponent serve asks for the user's return on the opponent's side", () => {
  const corrected = effectivePlacementProposal(
    proposal({
      phase: "return",
      shot_seq: 2,
      scored_server: "user",
      hitter_side: "far",
      receiver_side: "near",
      user_side: "near",
    }),
    "opponent",
  );

  assert.equal(
    eventInstruction(corrected, {
      userName: "You",
      opponentName: "Faye",
    }),
    "Your return — mark the first table bounce after contact on Faye's side",
  );
});

test("corrected rally identity alternates from the corrected server", () => {
  const oddShot = effectivePlacementProposal(
    proposal({
      phase: "rally",
      shot_seq: 5,
      scored_server: "user",
      user_side: "near",
    }),
    "opponent",
  );
  const evenShot = effectivePlacementProposal(
    proposal({
      phase: "rally",
      shot_seq: 4,
      scored_server: "user",
      user_side: "near",
    }),
    "opponent",
  );

  assert.equal(oddShot.hitter_side, "far");
  assert.equal(oddShot.receiver_side, "near");
  assert.equal(evenShot.hitter_side, "near");
  assert.equal(evenShot.receiver_side, "far");
});

test("physical coordinates keep camera left on the left and near at the bottom", () => {
  assert.deepEqual(tablePointToSvg({ u: 0, v: 0 }), { x: 35, y: 325 });
  assert.deepEqual(tablePointToSvg({ u: 1.525, v: 2.74 }), {
    x: 215,
    y: 25,
  });
});

test("mark description uses the actual physical side and camera direction", () => {
  assert.equal(
    describePlacementMark(
      { u: 1.4, v: 0.2 },
      { nearName: "You", farName: "Chris" },
    ),
    "Marked on your side, deep camera-right",
  );
  assert.equal(
    describePlacementMark(
      { u: 0.1, v: 2.6 },
      { nearName: "Chris", farName: "You" },
    ),
    "Marked on your side, deep camera-left",
  );
});

test("review copy makes the latest saved answer authoritative", () => {
  assert.equal(revealButtonLabel(), "Save answer & show comparison");
  assert.match(latestAnswerNotice(), /latest saved answer/i);
  assert.doesNotMatch(latestAnswerNotice(), /blind/i);
});

test("comparison access no longer depends on a blind snapshot", () => {
  const route = readFileSync(
    new URL(
      "../../api/research/placement-comparison/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.doesNotMatch(route, /label\\.blind_snapshot/);
  assert.doesNotMatch(route, /blind answer/i);
});

test("corrected-server points can complete without stale comparison", () => {
  assert.equal(
    placementCompletionRequiresComparison(proposal(), null, "landed"),
    true,
  );
  assert.equal(
    placementCompletionRequiresComparison(
      proposal(),
      "user",
      "landed",
    ),
    false,
  );
  assert.equal(
    placementCompletionRequiresComparison(proposal(), null, "excluded"),
    false,
  );
});

test("reviewer UI exposes server correction and the API guards predictions", () => {
  const labeler = readFileSync(
    new URL("./PlacementCalibrationLabeler.tsx", import.meta.url),
    "utf8",
  );
  const route = readFileSync(
    new URL(
      "../../api/research/placement-comparison/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(labeler, /Change server/i);
  assert.match(labeler, /changePlacementServer/);
  assert.match(labeler, /server correction/i);
  assert.match(route, /placementPredictionsCompatible/);
  assert.match(route, /server_prediction_mismatch/);
});
