import assert from "node:assert/strict";
import test from "node:test";
import {
  createServeDetectionLabel,
  frameStepTime,
  hydrateServeDetectionLabel,
  setActualServeContact,
  setNoObservableServe,
  upsertServeEvent,
  validateServeDetectionLabel,
} from "./serveDetection.ts";

test("a serve contact completes the required answer", () => {
  const label = setActualServeContact(createServeDetectionLabel(), 1.23456);

  assert.deepEqual(validateServeDetectionLabel(label), []);
  assert.equal(label.actual_serve_contact_s, 1.2346);
  assert.equal(label.no_observable_serve, null);
});

test("no observable serve clears the contact", () => {
  const initial = setActualServeContact(createServeDetectionLabel(), 1.2);
  const next = setNoObservableServe(initial, "bad_cut");

  assert.equal(next.actual_serve_contact_s, null);
  assert.equal(next.no_observable_serve, "bad_cut");
  assert.deepEqual(validateServeDetectionLabel(next), []);
});

test("an empty answer is incomplete", () => {
  assert.deepEqual(validateServeDetectionLabel(createServeDetectionLabel()), [
    "actual_serve",
  ]);
});

test("frame stepping clamps to clip bounds", () => {
  assert.equal(frameStepTime(0.02, -1, 30, 5), 0);
  assert.equal(frameStepTime(4.99, 1, 30, 5), 5);
  assert.equal(frameStepTime(1, 3, 30, 5), 1.1);
});

test("event upsert replaces the same event without duplicating it", () => {
  const initial = upsertServeEvent(createServeDetectionLabel(), {
    id: "detector-1",
    time_s: 1.2,
    event_type: "serve_first_bounce",
    origin: "proposal",
    hard_negative_reason: null,
  });
  const corrected = upsertServeEvent(initial, {
    id: "detector-1",
    time_s: 1.25,
    event_type: "serve_second_bounce",
    origin: "proposal",
    hard_negative_reason: null,
  });

  assert.equal(corrected.events.length, 1);
  assert.deepEqual(corrected.events[0], {
    id: "detector-1",
    time_s: 1.25,
    event_type: "serve_second_bounce",
    origin: "proposal",
    hard_negative_reason: null,
  });
});

test("hydration keeps valid stored answers and normalizes old timestamps", () => {
  const hydrated = hydrateServeDetectionLabel({
    schema_version: 1,
    actual_serve_contact_s: 1.23456,
    no_observable_serve: null,
    events: [],
    notes: "clear serve",
  });

  assert.equal(hydrated.actual_serve_contact_s, 1.2346);
  assert.equal(hydrated.notes, "clear serve");
});

test("hydration rejects unknown event taxonomy", () => {
  assert.throws(
    () =>
      hydrateServeDetectionLabel({
        schema_version: 1,
        actual_serve_contact_s: 1,
        no_observable_serve: null,
        events: [
          {
            id: "bad",
            time_s: 1,
            event_type: "spin_guess",
            origin: "manual",
            hard_negative_reason: null,
          },
        ],
        notes: "",
      }),
    /Unsupported serve event type/,
  );
});
