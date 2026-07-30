import assert from "node:assert/strict";
import test from "node:test";
import {
  addFollowupNetContact,
  completeServeFollowup,
  createServeDetectionLabel,
  frameStepTime,
  hydrateServeDetectionLabel,
  removeFollowupNetContact,
  setActualServeContact,
  setContactWindowBoundary,
  setFollowupAnchor,
  setNoObservableServe,
  upsertServeEvent,
  validateServeDetectionLabel,
  validateServeFollowup,
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

test("hydrating a version-one answer adds an empty follow-up without losing truth", () => {
  const hydrated = hydrateServeDetectionLabel({
    schema_version: 1,
    actual_serve_contact_s: 1.25,
    no_observable_serve: null,
    events: [],
    notes: "original answer",
  });

  assert.equal(hydrated.schema_version, 2);
  assert.equal(hydrated.actual_serve_contact_s, 1.25);
  assert.equal(hydrated.notes, "original answer");
  assert.deepEqual(hydrated.followup, {
    first_bounce: { status: "unmarked", time_s: null },
    second_bounce: { status: "unmarked", time_s: null },
    receiver_contact: { status: "unmarked", time_s: null },
    contact_window: { start_s: null, end_s: null },
    net_contacts_s: [],
    submitted_at: null,
  });
});

test("follow-up anchors normalize exact times and expose remaining requirements", () => {
  const firstBounce = setFollowupAnchor(
    createServeDetectionLabel(),
    "first_bounce",
    "exact",
    1.23456,
  );
  const secondBounce = setFollowupAnchor(
    firstBounce,
    "second_bounce",
    "not_visible",
  );

  assert.deepEqual(secondBounce.followup.first_bounce, {
    status: "exact",
    time_s: 1.2346,
  });
  assert.deepEqual(validateServeFollowup(secondBounce), [
    "receiver_contact",
  ]);
});

test("only later anchors may be marked as not occurring", () => {
  assert.throws(
    () =>
      setFollowupAnchor(
        createServeDetectionLabel(),
        "first_bounce",
        "does_not_occur",
      ),
    /First bounce cannot be marked as not occurring/,
  );

  const label = setFollowupAnchor(
    createServeDetectionLabel(),
    "receiver_contact",
    "does_not_occur",
  );
  assert.deepEqual(label.followup.receiver_contact, {
    status: "does_not_occur",
    time_s: null,
  });
});

test("contact window requires both chronological boundaries", () => {
  const startOnly = setContactWindowBoundary(
    createServeDetectionLabel(),
    "start_s",
    1.2,
  );
  assert.deepEqual(validateServeFollowup(startOnly), [
    "first_bounce",
    "second_bounce",
    "receiver_contact",
    "contact_window",
  ]);

  const reversed = setContactWindowBoundary(startOnly, "end_s", 1.1);
  assert.equal(
    validateServeFollowup(reversed).filter(
      (item) => item === "contact_window",
    ).length,
    1,
  );

  const valid = setContactWindowBoundary(reversed, "end_s", 1.4);
  assert.equal(validateServeFollowup(valid).includes("contact_window"), false);
});

test("optional net contacts are normalized, sorted, and removable", () => {
  const first = addFollowupNetContact(createServeDetectionLabel(), 2.34567);
  const second = addFollowupNetContact(first, 1.2);
  const duplicate = addFollowupNetContact(second, 1.2);

  assert.deepEqual(duplicate.followup.net_contacts_s, [1.2, 2.3457]);
  assert.deepEqual(
    removeFollowupNetContact(duplicate, 1.2).followup.net_contacts_s,
    [2.3457],
  );
});

test("completing follow-up requires all anchors and records the supplied time", () => {
  let label = createServeDetectionLabel();
  label = setFollowupAnchor(label, "first_bounce", "exact", 1.2);
  label = setFollowupAnchor(label, "second_bounce", "exact", 1.6);
  label = setFollowupAnchor(
    label,
    "receiver_contact",
    "does_not_occur",
  );

  const completed = completeServeFollowup(
    label,
    "2026-07-30T12:00:00.000Z",
  );
  assert.equal(
    completed.followup.submitted_at,
    "2026-07-30T12:00:00.000Z",
  );
  assert.throws(
    () =>
      completeServeFollowup(
        createServeDetectionLabel(),
        "2026-07-30T12:00:00.000Z",
      ),
    /Follow-up label is incomplete/,
  );
});
