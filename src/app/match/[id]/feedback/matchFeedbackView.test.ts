import assert from "node:assert/strict";
import test from "node:test";
import type { MatchIssueState, MatchIssueStatus } from "../../../../lib/matchIssues/types.ts";
import { matchFeedbackPresentation, submissionAttempt } from "./matchFeedbackView.ts";

const ready: MatchIssueState = {
  role: "owner", matchStatus: "ready", activeIssue: null, refundableMinutes: 11,
  canPositive: true, canProblem: true, canReprocess: true, canRefund: true, events: [],
};

test("failed matches show only a real automatic refund receipt, never a zero-balance inference", () => {
  const failed = { ...ready, matchStatus: "failed" as const, refundableMinutes: 0 };
  assert.equal(matchFeedbackPresentation(failed).automaticRefundMessage, null);
  const automaticRefund = { minutes: 11, receiptIds: ["9007199254740993"] };
  assert.equal(matchFeedbackPresentation({ ...failed, automaticRefund }).automaticRefundMessage,
    "11 processing minutes were returned automatically after processing failed.");
  assert.equal(matchFeedbackPresentation({ ...failed, automaticRefund }).trailing, "11 minutes returned");
  assert.equal(matchFeedbackPresentation(failed).trailing, "Report a problem");
  assert.equal(matchFeedbackPresentation({ ...failed, role: "coach", automaticRefund }).automaticRefundMessage, null);
  assert.equal(matchFeedbackPresentation({ ...failed, role: "coach", automaticRefund }).trailing, "Report a problem");
});
function withIssue(status: MatchIssueStatus): MatchIssueState {
  return { ...ready, refundableMinutes: 0, activeIssue: {
    id: "issue", matchId: "match", kind: "refund", status, message: "A rally is missing.",
    refundableMinutes: 11, playerNote: "The original is not usable.",
    createdAt: "2026-09-07T12:00:00Z", updatedAt: "2026-09-07T13:00:00Z",
  } };
}

test("ready owners get server-eligible choices and the exact spend amount", () => {
  const view = matchFeedbackPresentation(ready);
  assert.equal(view.trailing, "Report a problem");
  assert.deepEqual(view.choices.map(c => [c.kind, c.label]), [
    ["reprocess", "Try processing again"],
    ["refund", "Request 11 minutes back"],
  ]);
  assert.equal(view.fieldLabel, "What went wrong?");
  assert.equal(view.messageRequired, false);
  assert.equal(matchFeedbackPresentation(ready, false).noRemedyNote, null);
});

for (const matchStatus of ["uploaded", "processing", "failed"] as const) {
  test(`${matchStatus} owners report problems without cut-quality or economic choices`, () => {
    const view = matchFeedbackPresentation({ ...ready, matchStatus });
    assert.deepEqual(view.choices.map(c => c.kind), ["problem"]);
    assert.equal(view.fieldLabel, "What happened?");
    assert.equal(view.placeholder, "Tell us what went wrong.");
    assert.equal(view.messageRequired, true);
  });
}

test("coach never gets owner choices or financial copy even if eligibility flags are stale", () => {
  const view = matchFeedbackPresentation({ ...ready, role: "coach" });
  assert.equal(view.trailing, "Report a problem");
  assert.deepEqual(view.choices.map(c => c.kind), ["problem"]);
  assert.equal(view.messageRequired, true);
  const refunded = matchFeedbackPresentation({ ...withIssue("resolved_refunded"), role: "coach" });
  assert.doesNotMatch(refunded.message ?? "", /11/);
});

test("zero, absent or server-ineligible refunds never appear", () => {
  for (const refundableMinutes of [0, null]) {
    assert.equal(matchFeedbackPresentation({ ...ready, refundableMinutes }).choices.some(c => c.kind === "refund"), false);
  }
  const view = matchFeedbackPresentation({ ...ready, canRefund: false, canReprocess: false });
  assert.deepEqual(view.choices.map(c => c.kind), ["problem"]);
});

test("a processed match with no remedy left takes a plain report, and says why when the original is gone", () => {
  const none = { ...ready, canRefund: false, canReprocess: false };
  const gone = matchFeedbackPresentation(none, false);
  assert.deepEqual(gone.choices.map(c => c.kind), ["problem"]);
  assert.equal(gone.messageRequired, true);
  assert.equal(gone.fieldLabel, "What went wrong?");
  assert.equal(gone.noRemedyNote, "The original video is no longer stored, so this match cannot be processed again.");
  assert.equal(matchFeedbackPresentation(none, true).noRemedyNote, null);
  assert.equal(matchFeedbackPresentation(none).noRemedyNote, null);
  assert.equal(matchFeedbackPresentation({ ...none, canProblem: false }).choices.length, 0);
});

for (const [status, title, message, trailing, poll] of [
  ["pending", "Under review", "We will notify you when this has been reviewed.", "Under review", true],
  ["reprocess_queued", "Reprocessing queued", "Your current match is still available.", "Reprocessing", true],
  ["reprocessing", "Reprocessing", "Your current match is still available while the new version is prepared.", "Reprocessing", true],
  ["candidate_ready", "New version ready", "We are reviewing the new result before it replaces anything.", "New version ready", true],
  ["resolved_reprocessed", "Reprocessed", "The new version is now active. The previous version is still recoverable.", "Reprocessed", false],
  ["resolved_refunded", "Minutes returned", "11 processing minutes were returned to your account.", "11 minutes returned", false],
  ["declined", "Request closed", "The original is not usable.", "Request closed", false],
  ["execution_failed", "Needs another review", "Reprocessing did not finish. Your current match has not changed.", "Needs another review", false],
  ["cancelled", "Cancelled", "No changes were made.", "Cancelled", false],
] as const) {
  test(`${status} presents the saved lifecycle, not job or current balance guesses`, () => {
    const view = matchFeedbackPresentation(withIssue(status));
    assert.equal(view.statusLabel, title);
    assert.equal(view.message, message);
    assert.equal(view.trailing, trailing);
    assert.equal(view.poll, poll);
    assert.equal(view.canCancel, status === "pending");
    if (status !== "cancelled") assert.equal(view.choices.length, 0);
  });
}

test("positive acknowledgement does not prevent reporting a later problem", () => {
  const state = { ...withIssue("recorded"), refundableMinutes: 11 };
  state.activeIssue!.kind = "positive";
  const view = matchFeedbackPresentation(state);
  assert.equal(view.trailing, "Feedback sent");
  assert.equal(view.message, "Thanks for the feedback.");
  assert.equal(view.choices.some(c => c.kind === "refund"), true);
});

test("restored history describes the previous active version without offering another remedy", () => {
  const state = withIssue("resolved_reprocessed");
  state.events = [{ id: "restore-event", issueId: "issue", kind: "restored", playerNote: "Restored the original cut.", createdAt: "2026-09-07T14:00:00Z" }];
  const view = matchFeedbackPresentation(state);
  assert.equal(view.statusLabel, "Previous version restored");
  assert.equal(view.message, "The previous version is now active.");
  assert.equal(view.trailing, "Previous version restored");
  assert.equal(view.choices.length, 0);
});

test("retry preserves its idempotency key, but changed content starts a new attempt", () => {
  const first = submissionAttempt(null, "refund", " missed serve ", () => "first");
  assert.deepEqual(first, { kind: "refund", message: "missed serve", idempotencyKey: "first" });
  assert.equal(submissionAttempt(first, "refund", "missed serve", () => "second"), first);
  assert.equal(submissionAttempt(first, "reprocess", "missed serve", () => "second").idempotencyKey, "second");
  assert.equal(submissionAttempt(first, "refund", "another issue", () => "third").idempotencyKey, "third");
});
