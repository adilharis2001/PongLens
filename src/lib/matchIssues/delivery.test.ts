import assert from "node:assert/strict";
import test from "node:test";

import {
  deliverPendingMatchIssueEmails,
  type MatchIssueEmailDependencies,
} from "./email.ts";

const submission = {
  delivery: {
    id: "delivery-1",
    issueId: "issue-1",
    eventId: "event-1",
    template: "submission" as const,
    recipientEmail: "support@ponglens.com",
  },
  issue: {
    matchId: "match-1",
    reporterId: "reporter-1",
    ownerId: "owner-1",
    reporterRole: "owner" as const,
    kind: "reprocess" as const,
    message: "The last rally is missing.",
    refundableMinutes: 0,
    status: "pending" as const,
  },
  event: { kind: "submitted", playerNote: "", metadata: {} },
  reporter: { name: "Maya", email: "maya@example.com" },
  owner: { name: "Maya", email: "maya@example.com" },
};

function dependencies(
  overrides: Partial<MatchIssueEmailDependencies> = {},
): MatchIssueEmailDependencies {
  return {
    async list() {
      return [submission.delivery];
    },
    async load() {
      return submission;
    },
    async claim(_id, payload) { return payload; },
    async send() {
      return { state: "sent", providerEmailId: "provider-test" };
    },
    async finish() {},
    reportError() {},
    ...overrides,
  };
}

test("submission delivery uses a stable provider idempotency key", async () => {
  let sent: { to: string; idempotencyKey: string; subject: string } | null = null;
  let finished = "";
  await deliverPendingMatchIssueEmails(
    dependencies({
      async send(input) {
        sent = {
          to: input.to,
          idempotencyKey: input.idempotencyKey,
          subject: input.message.subject,
        };
        return { state: "sent", providerEmailId: "provider-test" };
      },
      async finish(_id, state) {
        finished = state;
      },
    }),
  );
  assert.deepEqual(sent, {
    to: "support@ponglens.com",
    idempotencyKey: "match-issue-delivery-1",
    subject: "Match reprocessing requested",
  });
  assert.equal(finished, "accepted");
});

test("the optional issue filter reaches the durable queue reader", async () => {
  let filtered: string | undefined;
  await deliverPendingMatchIssueEmails(
    dependencies({
      async list(issueId) {
        filtered = issueId;
        return [];
      },
    }),
    "issue-1",
  );
  assert.equal(filtered, "issue-1");
});

test("suppression is terminal while provider failure remains retryable", async () => {
  for (const [sendState, deliveryState] of [
    ["suppressed", "suppressed"],
    ["failed", "failed"],
  ] as const) {
    let finished = "";
    await deliverPendingMatchIssueEmails(
      dependencies({
        async send() {
          return { state: sendState };
        },
        async finish(_id, state) {
          finished = state;
        },
      }),
    );
    assert.equal(finished, deliveryState);
  }
});

test("resolution email uses the event amount and player explanation", async () => {
  let text = "";
  await deliverPendingMatchIssueEmails(
    dependencies({
      async load() {
        return {
          ...submission,
          delivery: {
            ...submission.delivery,
            id: "delivery-2",
            template: "resolution",
            recipientEmail: "maya@example.com",
          },
          issue: {
            ...submission.issue,
            kind: "refund",
            status: "resolved_refunded",
            refundableMinutes: 11,
          },
          event: {
            kind: "refunded",
            playerNote: "We returned the processing time.",
            metadata: { minutes: 11 },
          },
        };
      },
      async send(input) {
        text = JSON.stringify(input.message);
        return { state: "sent", providerEmailId: "provider-test" };
      },
    }),
  );
  assert.match(text, /11 processing minutes/);
  assert.match(text, /We returned the processing time/);
});

test("missing queue context is recorded as a retryable failure", async () => {
  let state = "";
  let error = "";
  await deliverPendingMatchIssueEmails(
    dependencies({
      async load() {
        return null;
      },
      async finish(_id, next, detail) {
        state = next;
        error = detail ?? "";
      },
    }),
  );
  assert.equal(state, "failed");
  assert.match(error, /context/i);
});

test("delayed resolution delivery follows its immutable event even after later decisions", async () => {
  for (const [kind, status, subject] of [
    ["execution_failed", "resolved_reprocessed", "We could not prepare a new cut"],
    ["restored", "resolved_reprocessed", "Your previous match version was restored"],
    ["refunded", "declined", "Your processing minutes were returned"],
    ["published", "execution_failed", "A new cut is ready"],
  ] as const) {
    let actual = "";
    await deliverPendingMatchIssueEmails(dependencies({
      async load() {
        return { ...submission, delivery: { ...submission.delivery, template: "resolution" },
          issue: { ...submission.issue, status },
          event: { kind, playerNote: "Saved explanation.", metadata: { minutes: 11 } } };
      },
      async send(input) { actual = input.message.subject; return { state: "sent", providerEmailId: "provider-test" }; },
    }));
    assert.equal(actual, subject, kind);
  }
});

test("intermediate candidate events never send an owner resolution email", async () => {
  for (const kind of ["reprocess_queued", "reprocessing", "candidate_ready"]) {
    let sends = 0;
    let state = "";
    await deliverPendingMatchIssueEmails(dependencies({
      async load() { return { ...submission,
        delivery: { ...submission.delivery, template: "resolution" },
        event: { kind, playerNote: "Still under review.", metadata: {} } }; },
      async send() { sends++; return { state: "sent", providerEmailId: "provider-test" }; },
      async finish(_id, next) { state = next; },
    }));
    assert.equal(sends, 0, kind);
    assert.equal(state, "suppressed");
  }
});

test("a claimed delivery preserves its payload and does not downgrade accepted mail when bookkeeping fails", async () => {
  const finishes: unknown[][] = [];
  let payload = "";
  const frozen = '{"to":["support@ponglens.com"],"subject":"Original saved subject"}';
  await deliverPendingMatchIssueEmails(dependencies({
    async claim(id, candidate) {
      assert.equal(id, "delivery-1");
      assert.match(candidate, /match_issue_delivery_id/);
      return frozen;
    },
    async send(input) { payload = input.preparedPayload!; return { state: "sent", providerEmailId: "provider-accepted" }; },
    async finish(...args) { finishes.push(args); throw new Error("database unavailable"); },
  }));
  assert.equal(payload, frozen);
  assert.deepEqual(finishes, [["delivery-1", "accepted", undefined, "provider-accepted"]]);
});

test("another sender's claim or an already accepted receipt prevents a second provider call", async () => {
  let sends = 0;
  await deliverPendingMatchIssueEmails(dependencies({
    async claim() { return null; },
    async send() { sends++; return { state: "sent", providerEmailId: "must-not-send" }; },
  }));
  assert.equal(sends, 0);
});

test("a malformed refund event cannot invent an amount or block another queued delivery", async () => {
  const states: string[] = [];
  const sent: string[] = [];
  await deliverPendingMatchIssueEmails(dependencies({
    async list() { return [{ ...submission.delivery, id: "bad-event" }, submission.delivery]; },
    async load(delivery) {
      return delivery.id === "bad-event" ? { ...submission, delivery: { ...delivery, template: "resolution" },
        event: { kind: "refunded", playerNote: "", metadata: {} } } : submission;
    },
    async send(input) { sent.push(input.idempotencyKey); return { state: "sent", providerEmailId: "other-provider" }; },
    async finish(id, state) { states.push(`${id}:${state}`); },
  }));
  assert.deepEqual(sent, ["match-issue-delivery-1"]);
  assert.deepEqual(states, ["bad-event:failed", "delivery-1:accepted"]);
});
