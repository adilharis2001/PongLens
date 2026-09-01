import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIO_IMPACT_KINDS,
  audioImpactKindForShortcut,
  audioImpactProgress,
  createAudioImpactLabel,
  hydrateAudioImpactLabel,
  insertManualAudioImpactEvent,
  isAudioImpactShortcutTarget,
  labelAudioImpactEvent,
  setAudioImpactSequenceComplete,
  validateAudioImpactLabel,
  type AudioImpactCandidate,
} from "./audioImpacts.ts";

function candidate(
  id: string,
  time_s: number,
  strength = 1,
): AudioImpactCandidate {
  return {
    id,
    time_s,
    detector_origins: ["high_frequency"],
    strength,
  };
}

test("new candidate events contain timing but never inherit a semantic class", () => {
  const label = createAudioImpactLabel([
    candidate("candidate-a", 0.5),
    candidate("candidate-b", 1.25),
  ]);

  assert.equal(label.schema_version, 1);
  assert.equal(label.sequence_complete, false);
  assert.deepEqual(
    label.events.map((event) => ({
      id: event.id,
      candidate_id: event.candidate_id,
      time_s: event.time_s,
      origin: event.origin,
      kind: event.kind,
    })),
    [
      {
        id: "candidate-a",
        candidate_id: "candidate-a",
        time_s: 0.5,
        origin: "proposal",
        kind: null,
      },
      {
        id: "candidate-b",
        candidate_id: "candidate-b",
        time_s: 1.25,
        origin: "proposal",
        kind: null,
      },
    ],
  );
});

test("hydration keeps valid answers but rejects unknown stored classes", () => {
  const label = hydrateAudioImpactLabel(
    {
      schema_version: 1,
      sequence_complete: true,
      events: [
        {
          id: "candidate-a",
          candidate_id: "candidate-a",
          time_s: 99,
          origin: "proposal",
          kind: "paddle",
        },
        {
          id: "candidate-b",
          candidate_id: "candidate-b",
          time_s: 2,
          origin: "proposal",
          kind: "laser",
        },
      ],
    },
    [candidate("candidate-a", 1), candidate("candidate-b", 2)],
  );

  assert.equal(label.events[0].kind, "paddle");
  assert.equal(label.events[0].time_s, 1);
  assert.equal(label.events[1].kind, null);
  assert.equal(label.sequence_complete, false);
});

test("every frozen sound and sequence confirmation are required", () => {
  const blank = createAudioImpactLabel([
    candidate("candidate-a", 1),
    candidate("candidate-b", 2),
  ]);
  const oneAnswered = labelAudioImpactEvent(blank, "candidate-a", "unsure");

  assert.deepEqual(validateAudioImpactLabel(oneAnswered), [
    "events.candidate-b.kind",
    "sequence_complete",
  ]);

  const allAnswered = labelAudioImpactEvent(
    oneAnswered,
    "candidate-b",
    "no_impact",
  );
  assert.deepEqual(validateAudioImpactLabel(allAnswered), [
    "sequence_complete",
  ]);
  assert.deepEqual(
    validateAudioImpactLabel(setAudioImpactSequenceComplete(allAnswered, true)),
    [],
  );
});

test("changing an answer is immutable and clears sequence confirmation", () => {
  const original = setAudioImpactSequenceComplete(
    labelAudioImpactEvent(
      createAudioImpactLabel([candidate("candidate-a", 1)]),
      "candidate-a",
      "table",
    ),
    true,
  );

  const changed = labelAudioImpactEvent(original, "candidate-a", "paddle");

  assert.equal(original.events[0].kind, "table");
  assert.equal(original.sequence_complete, true);
  assert.equal(changed.events[0].kind, "paddle");
  assert.equal(changed.sequence_complete, false);
});

test("manual insertion snaps to the strongest uncaptured onset within 50 ms", () => {
  const label = createAudioImpactLabel([candidate("frozen", 0.5)]);
  const inserted = insertManualAudioImpactEvent(label, 1, [
    candidate("weak", 0.97, 2),
    candidate("strong", 1.04, 7),
    candidate("far", 1.08, 20),
  ]);

  assert.equal(inserted.events.length, 2);
  assert.deepEqual(inserted.events[1], {
    id: "manual-1000-1",
    candidate_id: null,
    time_s: 1.04,
    unsnapped_time_s: 1,
    origin: "manual",
    kind: null,
  });
});

test("manual insertion uses the playhead and a stable suffix without a nearby onset", () => {
  const first = insertManualAudioImpactEvent(
    createAudioImpactLabel([]),
    1.23456,
    [candidate("far", 1.4, 10)],
  );
  const second = insertManualAudioImpactEvent(first, 1.23456, []);

  assert.equal(first.events[0].id, "manual-1235-1");
  assert.equal(first.events[0].time_s, 1.2346);
  assert.equal(second.events[1].id, "manual-1235-2");
});

test("progress counts sounds separately from submitted points", () => {
  const open = labelAudioImpactEvent(
    createAudioImpactLabel([candidate("a", 1), candidate("b", 2)]),
    "a",
    "shoe",
  );
  const complete = setAudioImpactSequenceComplete(
    labelAudioImpactEvent(
      createAudioImpactLabel([candidate("c", 1)]),
      "c",
      "floor",
    ),
    true,
  );

  assert.deepEqual(
    audioImpactProgress([
      { status: "in_progress", label: open },
      { status: "submitted", label: complete },
    ]),
    {
      labeled_sounds: 2,
      total_sounds: 3,
      completed_points: 1,
      total_points: 2,
    },
  );
});

test("the eleven one-key shortcuts map to distinct labels", () => {
  assert.deepEqual(AUDIO_IMPACT_KINDS, [
    "paddle",
    "table",
    "floor",
    "shoe",
    "shoe_squeak",
    "stomp",
    "net",
    "background",
    "other",
    "no_impact",
    "unsure",
  ]);
  assert.deepEqual(
    ["p", "T", "f", "H", "q", "S", "n", "B", "o", "X", "u"].map(
      audioImpactKindForShortcut,
    ),
    AUDIO_IMPACT_KINDS,
  );
  assert.equal(audioImpactKindForShortcut("z"), null);
});

test("shortcuts are ignored for editable and interactive targets", () => {
  for (const target of [
    { tagName: "INPUT" },
    { tagName: "textarea" },
    { tagName: "SELECT" },
    { tagName: "BUTTON" },
    { tagName: "DIV", isContentEditable: true },
    { tagName: "DIV", closest: () => ({}) },
  ]) {
    assert.equal(isAudioImpactShortcutTarget(target), true);
  }
  assert.equal(
    isAudioImpactShortcutTarget({
      tagName: "DIV",
      isContentEditable: false,
      closest: () => null,
    }),
    false,
  );
});
