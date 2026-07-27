import assert from "node:assert/strict";
import test from "node:test";

import {
  EVENT_SHORTCUTS,
  buildPilotAssignmentOrder,
  createHumanEventLabel,
  hydrateHumanLabel,
  isResearchMediaKey,
  requiredPointFields,
  reviewDotText,
  unresolvedEventFields,
} from "./labeling.ts";

test("event shortcuts preserve the fast labeler keyboard vocabulary", () => {
  assert.deepEqual(EVENT_SHORTCUTS, {
    p: "paddle",
    t: "table",
    n: "net",
    f: "floor",
    b: "body_catch",
    v: "voice",
    o: "other",
    u: "unsure",
  });
});

test("new event labels never inherit a detector semantic prediction", () => {
  const label = createHumanEventLabel({
    eventId: "audio-1",
    timeS: 1.234,
    origin: "audio",
    proposalType: "paddle",
  });

  assert.equal(label.event_id, "audio-1");
  assert.equal(label.time_s, 1.234);
  assert.equal(label.origin, "audio");
  assert.equal(label.event_type, null);
  assert.equal(label.proposal_confirmed, null);
});

test("point completion accepts explicit unsure but rejects missing answers", () => {
  const complete = {
    server: "unsure",
    winner: "unsure",
    point_validity: "rally",
    serve_contact_s: "not_visible",
    decisive_c_s: 4.2,
    review_end_s: 4.8,
    last_hitter: "unsure",
    responsible_player: "unsure",
    ending_type: "unsure",
    final_ball_result: "unknown",
    return_contact_after_final_bounce: "unsure",
    point_confidence: "unsure",
  };
  assert.deepEqual(requiredPointFields(complete), []);
  assert.deepEqual(requiredPointFields({ ...complete, winner: null }), ["winner"]);
});

test("reviewed dots include both a visible saved letter and status text", () => {
  assert.deepEqual(reviewDotText("table"), {
    letter: "T",
    title: "Reviewed as Table",
  });
  assert.deepEqual(reviewDotText(null), {
    letter: "",
    title: "Not reviewed",
  });
});

test("pilot assignment order creates 20 ordinary and 10 hidden repeats", () => {
  const sourceIds = Array.from({ length: 20 }, (_, index) => `source-${index + 1}`);
  const assignments = buildPilotAssignmentOrder(sourceIds, "pilot-v1");

  assert.equal(assignments.length, 30);
  assert.equal(new Set(assignments.map((item) => item.sourceId)).size, 20);
  assert.equal(assignments.filter((item) => item.isRepeat).length, 10);
  assert.deepEqual(
    [...new Set(assignments.map((item) => item.sequence))],
    Array.from({ length: 30 }, (_, index) => index + 1),
  );
  for (const sourceId of sourceIds.slice(0, 10)) {
    assert.equal(
      assignments.filter((item) => item.sourceId === sourceId).length,
      2,
    );
  }
});

test("hydration creates blank human event answers without proposal leakage", () => {
  const label = hydrateHumanLabel(
    {
      markers: [
        {
          id: "marker-1",
          time_s: 1.4,
          origin: "both",
          audio_id: "audio-1",
          visual_id: "visual-1",
        },
      ],
    },
    null,
  );

  assert.equal(label.events.length, 1);
  assert.equal(label.events[0].event_type, null);
  assert.equal(label.point.winner, null);
  assert.equal(label.notes, "");
});

test("event completion requires explicit detail and accepts unsure", () => {
  const event = createHumanEventLabel({
    eventId: "marker-1",
    timeS: 1.4,
    origin: "audio",
  });
  assert.ok(unresolvedEventFields(event).includes("event_type"));
  assert.deepEqual(
    unresolvedEventFields({
      ...event,
      event_type: "unsure",
      belongs_to_visible_point: "unsure",
      phase: "rally",
      audibility: "unsure",
      visual_support: "absent",
      player_side: "unsure",
      confidence: "unsure",
      proposal_confirmed: "corrected",
    }),
    [],
  );
});

test("research media keys cannot escape the permanent pilot prefix", () => {
  assert.equal(
    isResearchMediaKey(
      "research/fused-labeling/v1/sources/12345678-1234-1234-1234-123456789abc.mp4",
    ),
    true,
  );
  assert.equal(isResearchMediaKey("results/another-user/private.mp4"), false);
  assert.equal(isResearchMediaKey("research/fused-labeling/../../secret"), false);
});
