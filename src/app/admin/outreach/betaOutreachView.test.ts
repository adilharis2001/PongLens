import assert from "node:assert/strict";
import test from "node:test";
import * as view from "./betaOutreachView.ts";
import {
  unifyOutreach,
  unifiedQueueFor,
  feedbackLabel,
  invitationLabel,
  effectiveInvitationState,
} from "./betaOutreachView.ts";

test("Needs attention filtering includes overdue schedules and near-deadline unknown requests", () => {
  const fixtures = [
    {
      ...beta,
      id: "overdue",
      delivery_state: "scheduled",
      scheduled_at: "2026-09-05T11:59:00Z",
    },
    {
      ...beta,
      id: "near",
      delivery_state: "unknown",
      scheduled_at: "2026-09-05T12:30:00Z",
    },
    {
      ...beta,
      id: "later",
      delivery_state: "scheduled",
      scheduled_at: "2026-09-06T11:00:00Z",
    },
    {
      ...beta,
      id: "delivered",
      delivery_state: "delivered",
      scheduled_at: "2026-09-04T11:00:00Z",
    },
  ];
  assert.deepEqual(
    fixtures
      .filter((row) => effectiveInvitationState(row, now) === "needs_attention")
      .map((row) => row.id),
    ["overdue", "near"],
  );
  assert.deepEqual(
    fixtures.map((row) => invitationLabel(row, now)),
    ["Needs attention", "Needs attention", "Scheduled", "Delivered"],
  );
});
import type { OutreachRow, PersonRow, TouchRow } from "./outreachView.ts";

const account = {
  user_id: "u1",
  email: " PLAYER@club.org ",
  name: "Player",
  signed_up: "2026-09-05",
  last_seen: null,
  matches: 0,
  matches_scored: 0,
  matches_failed: 0,
  last_upload_at: null,
  points: 0,
  notes: 0,
  journal_entries: 0,
  share_links: 0,
  is_coach: false,
  kind: "real",
  status: "new",
  follow_up_on: null,
  hidden: false,
  last_outreach_at: null,
  last_feedback_at: null,
  touches: 0,
} satisfies OutreachRow;
const beta = {
  id: "b1",
  email: "player@club.org",
  created_at: "2026-09-01",
  role: "player" as const,
  interests: ["iphone_recording"],
  feedback_choice: "opted_in" as const,
  feedback_channels: ["audio_call"],
  scheduled_at: "2026-09-02T12:00:00Z",
  delivery_state: "scheduled",
  delivery_error_code: null,
  early_send_requested_at: null,
  status: "in_touch" as const,
  follow_up_on: "2026-09-03",
};
const manual = {
  id: "p1",
  email: "player@club.org",
  name: "Manual name",
  status: "contacted",
  follow_up_on: "2026-09-02",
  created_by: "Admin",
  created_at: "2026-08-20",
  last_outreach_at: null,
  last_feedback_at: null,
  touches: 0,
} satisfies PersonRow;
const now = new Date("2026-09-05T12:00:00Z");

test("provider test mailboxes stay out of Real even without an account", () => {
  assert.equal(typeof view.outreachKind, "function");
  const rows = unifyOutreach([], [], [beta, { ...beta, id: "test", email: "delivered+beta-test@resend.dev" }, { ...beta, id: "real", email: "test@real-club.org" }], []);
  assert.deepEqual(rows.map(view.outreachKind), ["real", "test", "real"]);
  const [linked] = unifyOutreach([{ ...account, email: "delivered+beta-test@resend.dev" }], [], [{ ...beta, email: "delivered+beta-test@resend.dev" }], []);
  assert.equal(view.outreachKind(linked), "test");
});

test("pending invitations include hidden Team applicants but exclude test mailboxes by default", () => {
  assert.equal(typeof view.pendingOutreachInvitations, "function");
  const rows = unifyOutreach([{ ...account, hidden: true, kind: "team" }], [], [beta, { ...beta, id: "test", email: "delivered+beta-test@resend.dev" }, { ...beta, id: "done", email: "done@club.org", delivery_state: "delivered" }], []);
  assert.deepEqual(view.pendingOutreachInvitations(rows, "real").map(r => r.beta?.id), ["b1"]);
  assert.deepEqual(view.pendingOutreachInvitations(rows, "test").map(r => r.beta?.id), ["test"]);
  assert.equal(view.pendingOutreachInvitations(rows, "all").length, 2);
  assert.equal(rows[0].account?.hidden, true);
  assert.equal(unifiedQueueFor(rows[0], now), null);
});

test("normalized account/manual/beta identity retains literal histories and earliest reminder", () => {
  const touches = [
    {
      id: "t1",
      user_id: "u1",
      person_id: null,
      beta_request_id: null,
      kind: "note",
      channel: null,
      body: "Original account note",
      author: "Adil",
      at: "2026-09-02",
    },
    {
      id: "t2",
      user_id: null,
      person_id: null,
      beta_request_id: "b1",
      kind: "feedback",
      channel: "audio_call",
      body: "Original beta feedback",
      author: "Anton",
      at: "2026-09-01",
    },
  ] as TouchRow[];
  const rows = unifyOutreach([account], [manual], [beta], touches);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Player");
  assert.equal(rows[0].status, "contacted");
  assert.equal(rows[0].follow_up_on, "2026-09-02");
  assert.deepEqual(rows[0].touches, touches);
  assert.equal(unifiedQueueFor(rows[0], now), "due");
});
test("beta state carries forward to a new account without making a second person", () => {
  const rows = unifyOutreach([account], [], [beta], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "in_touch");
  assert.equal(rows[0].follow_up_on, "2026-09-03");
});
test("declined and unanswered applicants never enter feedback queues, including linked accounts", () => {
  for (const choice of ["declined", "unanswered"] as const) {
    for (const users of [[], [account]]) {
      const rows = unifyOutreach(
        users,
        [],
        [{ ...beta, status: "new", feedback_choice: choice }],
        [],
      );
      assert.equal(rows.length, 1);
      assert.equal(unifiedQueueFor(rows[0], now), null);
    }
  }
  assert.equal(
    feedbackLabel({ ...beta, feedback_choice: "unanswered" }),
    "Not provided",
  );
  assert.equal(
    feedbackLabel({ ...beta, feedback_choice: "declined" }),
    "No feedback contact requested",
  );
});
test("declined account keeps operational upload failure separate from feedback contact", () => {
  const [row] = unifyOutreach(
    [{ ...account, matches_failed: 1 }],
    [],
    [{ ...beta, feedback_choice: "declined" }],
    [],
  );
  assert.equal(unifiedQueueFor(row, now), "stuck");
});
test("ambiguous manual duplicates remain separate and cannot acquire beta consent", () => {
  const rows = unifyOutreach(
    [account],
    [manual, { ...manual, id: "p2" }],
    [beta],
    [],
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r) => r.key),
    ["user:u1", "person:p1", "person:p2"],
  );
  assert.equal(rows.filter((r) => r.beta).length, 1);
  assert.equal(rows[1].ambiguous, true);
});
test("invitation labels distinguish provider acceptance, dispatch, and attention", () => {
  assert.equal(invitationLabel(beta, now), "Needs attention");
  assert.equal(
    invitationLabel(
      { ...beta, scheduled_at: "2026-09-06", delivery_state: "scheduled" },
      now,
    ),
    "Scheduled",
  );
  assert.equal(
    invitationLabel(
      {
        ...beta,
        delivery_state: "sending",
        early_send_requested_at: "2026-09-05",
      },
      now,
    ),
    "Needs attention",
  );
  assert.equal(
    invitationLabel({ ...beta, delivery_state: "delivered" }, now),
    "Delivered",
  );
});
test("manual entries without email remain separate", () => {
  const rows = unifyOutreach(
    [],
    [
      { ...manual, email: null },
      { ...manual, id: "p2", email: "  " },
    ],
    [],
    [],
  );
  assert.deepEqual(
    rows.map((r) => r.key),
    ["person:p1", "person:p2"],
  );
});
test("beta-only detail and unchanged history remain after the linked account disappears", () => {
  const history = [
    {
      id: "t1",
      user_id: null,
      person_id: null,
      beta_request_id: "b1",
      kind: "note",
      channel: null,
      body: "Saved before removal",
      author: "Adil",
      at: "2026-09-02",
    },
  ] as TouchRow[];
  const [row] = unifyOutreach([], [], [beta], history);
  assert.equal(row.key, "beta:b1");
  assert.equal(row.status, "in_touch");
  assert.deepEqual(row.touches, history);
});
