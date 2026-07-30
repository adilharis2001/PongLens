import assert from "node:assert/strict";
import test from "node:test";
import type { PlacementCalibrationProposal } from "../../../lib/research/placementCalibration.ts";
import {
  describePlacementMark,
  eventInstruction,
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
