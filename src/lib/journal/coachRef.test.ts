import assert from "node:assert/strict";
import test from "node:test";
import { coachRefUpdate } from "./coachRef.ts";

const COACH = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-09-04T12:00:00.000Z";
const now = () => NOW;

test("no coach means no grant", () => {
  assert.deepEqual(
    coachRefUpdate({ coachRefId: null, shareWithCoach: true, now }),
    { coach_ref_id: null, shared_with_coach_at: null },
  );
  // Junk in the body is "no coach", never a half-written row.
  assert.deepEqual(
    coachRefUpdate({ coachRefId: "not-a-uuid", shareWithCoach: true, now }),
    { coach_ref_id: null, shared_with_coach_at: null },
  );
});

test("sharing takes an explicit true, not a truthy value", () => {
  for (const value of [undefined, null, false, "true", 1, {}]) {
    assert.equal(
      coachRefUpdate({ coachRefId: COACH, shareWithCoach: value, now })
        .shared_with_coach_at,
      null,
      `${JSON.stringify(value)} must not count as consent`,
    );
  }
  assert.equal(
    coachRefUpdate({ coachRefId: COACH, shareWithCoach: true, now })
      .shared_with_coach_at,
    NOW,
  );
});

test("editing an entry already shared keeps the date it was shared", () => {
  // Otherwise fixing a typo would bounce it to the top of the coach's
  // list, and the column would stop meaning "when they got it".
  const earlier = "2026-09-01T08:30:00.000Z";
  assert.equal(
    coachRefUpdate({
      coachRefId: COACH,
      shareWithCoach: true,
      currentRefId: COACH,
      currentSharedAt: earlier,
      now,
    }).shared_with_coach_at,
    earlier,
  );
});

test("moving a shared entry to a different coach is a new share", () => {
  assert.equal(
    coachRefUpdate({
      coachRefId: OTHER,
      shareWithCoach: true,
      currentRefId: COACH,
      currentSharedAt: "2026-09-01T08:30:00.000Z",
      now,
    }).shared_with_coach_at,
    NOW,
  );
});

test("unsharing clears the date, and moving to nobody clears both", () => {
  assert.deepEqual(
    coachRefUpdate({
      coachRefId: COACH,
      shareWithCoach: false,
      currentRefId: COACH,
      currentSharedAt: "2026-09-01T08:30:00.000Z",
      now,
    }),
    { coach_ref_id: COACH, shared_with_coach_at: null },
  );
  assert.deepEqual(
    coachRefUpdate({
      coachRefId: "",
      shareWithCoach: false,
      currentRefId: COACH,
      currentSharedAt: "2026-09-01T08:30:00.000Z",
      now,
    }),
    { coach_ref_id: null, shared_with_coach_at: null },
  );
});
