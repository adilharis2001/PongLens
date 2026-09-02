import assert from "node:assert/strict";
import test from "node:test";
import {
  activityLine,
  buildQueues,
  isStuck,
  queueFor,
  queueReason,
  touchLine,
  type OutreachRow,
} from "./outreachView.ts";

const NOW = new Date("2026-09-02T18:00:00Z");

function row(over: Partial<OutreachRow> = {}): OutreachRow {
  return {
    user_id: "u1",
    email: "player@example.org",
    name: "Player",
    signed_up: "2026-09-01T10:00:00Z",
    last_seen: "2026-09-01T10:00:00Z",
    matches: 0,
    matches_scored: 0,
    matches_failed: 0,
    last_upload_at: null,
    points: 0,
    notes: 0,
    journal_entries: 0,
    share_links: 0,
    is_coach: false,
    status: "new",
    follow_up_on: null,
    hidden: false,
    last_outreach_at: null,
    last_feedback_at: null,
    touches: 0,
    ...over,
  };
}

test("a fresh signup lands in the to-contact queue", () => {
  assert.equal(queueFor(row(), NOW), "to_contact");
});

test("hidden and closed users never queue", () => {
  assert.equal(queueFor(row({ hidden: true }), NOW), null);
  assert.equal(
    queueFor(row({ status: "closed", follow_up_on: "2026-08-01" }), NOW),
    null
  );
});

test("a due or overdue follow-up outranks everything else", () => {
  const due = row({
    status: "contacted",
    follow_up_on: "2026-09-02",
    matches_failed: 1,
  });
  assert.equal(queueFor(due, NOW), "due");
  assert.equal(queueFor(row({ ...due, follow_up_on: "2026-08-20" }), NOW), "due");
  // A future reminder is not due yet; the stuck signal takes over.
  assert.equal(
    queueFor(row({ ...due, follow_up_on: "2026-09-09" }), NOW),
    "stuck"
  );
});

// The person who uploaded and has nothing to show for it is the most
// valuable call. A failed upload counts, and so do matches sitting there
// with no points scored on any of them.
test("stuck beats merely new", () => {
  assert.ok(isStuck(row({ matches_failed: 1 })));
  assert.ok(isStuck(row({ matches: 2, points: 0 })));
  assert.ok(!isStuck(row({ matches: 2, points: 40 })));
  assert.equal(queueFor(row({ matches: 1, points: 0 }), NOW), "stuck");
});

test("quiet applies only after contact, and only past two weeks", () => {
  const old = {
    signed_up: "2026-08-01T10:00:00Z",
    last_seen: "2026-08-05T10:00:00Z",
  };
  assert.equal(queueFor(row({ ...old, status: "in_touch" }), NOW), "quiet");
  assert.equal(queueFor(row({ ...old, status: "contacted" }), NOW), "quiet");
  // Never contacted stays in to-contact however old the signup.
  assert.equal(queueFor(row({ ...old, status: "new" }), NOW), "to_contact");
  // Recent activity keeps an in-touch user out of every queue.
  assert.equal(
    queueFor(
      row({ ...old, status: "in_touch", last_upload_at: "2026-08-30T10:00:00Z" }),
      NOW
    ),
    null
  );
});

test("queues sort by urgency: oldest follow-up first, newest signup first", () => {
  const queues = buildQueues(
    [
      row({ user_id: "a", status: "contacted", follow_up_on: "2026-09-01" }),
      row({ user_id: "b", status: "contacted", follow_up_on: "2026-08-25" }),
      row({ user_id: "c", signed_up: "2026-08-20T00:00:00Z", last_seen: null }),
      row({ user_id: "d", signed_up: "2026-09-01T00:00:00Z" }),
    ],
    NOW
  );
  assert.deepEqual(
    queues.due.map((r) => r.user_id),
    ["b", "a"]
  );
  assert.deepEqual(
    queues.to_contact.map((r) => r.user_id),
    ["d", "c"]
  );
});

test("queue reasons say why in plain words", () => {
  assert.equal(
    queueReason(row({ matches_failed: 2 }), "stuck"),
    "2 uploads failed"
  );
  assert.equal(
    queueReason(row({ matches: 1, points: 0 }), "stuck"),
    "1 match uploaded, no points scored"
  );
  assert.match(queueReason(row(), "to_contact"), /^Signed up /);
});

test("the roster lines skip zeros and mention the coach side", () => {
  assert.equal(activityLine(row({ matches: 2, points: 31 })), "2 matches · 31 points");
  assert.equal(
    activityLine(row({ matches: 1, is_coach: true })),
    "1 match · coach side"
  );
});

test("the touch line prefers the most recent direction", () => {
  assert.equal(touchLine(row()), "Never contacted");
  assert.match(
    touchLine(row({ last_outreach_at: "2026-09-01T10:00:00Z" })),
    /^Reached out /
  );
  assert.match(
    touchLine(
      row({
        last_outreach_at: "2026-09-01T10:00:00Z",
        last_feedback_at: "2026-09-02T10:00:00Z",
      })
    ),
    /^They replied /
  );
});
