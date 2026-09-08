import type { MatchIssueKind, MatchIssueState, MatchIssueSubmission } from "../../../../lib/matchIssues/types.ts";

export interface FeedbackChoice {
  kind: MatchIssueKind;
  label: string;
  description: string;
}

export function matchFeedbackPresentation(state: MatchIssueState) {
  const owner = state.role === "owner";
  const cut = owner && state.matchStatus === "ready";
  const issue = state.activeIssue;
  const status = issue?.status;
  const minutes = issue?.refundableMinutes;
  const restored = status === "resolved_reprocessed" && state.events.some(event => event.kind === "restored");
  const automaticMinutes = owner && state.matchStatus === "failed" && state.automaticRefund && state.automaticRefund.receiptIds.length > 0 && state.automaticRefund.minutes > 0
    ? state.automaticRefund.minutes : null;
  const descriptions = {
    recorded: ["Feedback sent", "Thanks for the feedback."],
    pending: ["Under review", "We will notify you when this has been reviewed."],
    reprocess_queued: ["Reprocessing queued", "Your current match is still available."],
    reprocessing: ["Reprocessing", "Your current match is still available while the new version is prepared."],
    candidate_ready: ["New version ready", "We are reviewing the new result before it replaces anything."],
    resolved_reprocessed: restored
      ? ["Previous version restored", "The previous version is now active."]
      : ["Reprocessed", "The new version is now active. The previous version is still recoverable."],
    resolved_refunded: ["Minutes returned", owner && typeof minutes === "number"
      ? `${minutes} processing ${minutes === 1 ? "minute was" : "minutes were"} returned to your account.`
      : "The request has been reviewed."],
    declined: ["Request closed", issue?.playerNote || "The request has been reviewed."],
    execution_failed: ["Needs another review", "Reprocessing did not finish. Your current match has not changed."],
    cancelled: ["Cancelled", "No changes were made."],
  };
  const [statusLabel, message] = status ? descriptions[status] : [null, null];
  const choices: FeedbackChoice[] = [];
  if (!issue || status === "recorded" || status === "cancelled") {
    if (cut) {
      if (state.canPositive) choices.push({ kind: "positive", label: "Looks good", description: "The rallies and timing look right." });
      if (state.canReprocess) choices.push({ kind: "reprocess", label: "Try processing again", description: "Some rallies were missed or cut at the wrong time." });
      if (state.canRefund && (state.refundableMinutes ?? 0) > 0) choices.push({ kind: "refund", label: `Request ${state.refundableMinutes} ${state.refundableMinutes === 1 ? "minute" : "minutes"} back`, description: "I do not want this match processed again." });
    } else if (state.canProblem) {
      choices.push({ kind: "problem", label: owner ? "Report an issue" : "Report a cut problem", description: "" });
    }
  }
  return {
    // The row's label never changes, so a status appearing in the trailing
    // slot reads as one; with no request open, the slot is the door.
    trailing: status === "resolved_refunded" && owner && typeof minutes === "number"
      ? `${minutes} ${minutes === 1 ? "minute" : "minutes"} returned`
      : automaticMinutes !== null ? `${automaticMinutes} ${automaticMinutes === 1 ? "minute" : "minutes"} returned`
      : status === "reprocess_queued" ? "Reprocessing" : statusLabel ?? "Report a problem",
    choices, statusLabel, message,
    automaticRefundMessage: automaticMinutes !== null
      ? `${automaticMinutes} processing ${automaticMinutes === 1 ? "minute was" : "minutes were"} returned automatically after processing failed.`
      : null,
    fieldLabel: cut ? "What went wrong?" : "What happened?",
    placeholder: cut ? "Tell us what was missed or cut incorrectly." : "Tell us what went wrong.",
    messageRequired: !cut,
    canCancel: owner && status === "pending",
    poll: status === "pending" || status === "reprocess_queued" || status === "reprocessing" || status === "candidate_ready",
  };
}

/** A lost response must retry the same logical request, not create another. */
export function submissionAttempt(previous: MatchIssueSubmission | null, kind: MatchIssueKind, message: string, newKey: () => string): MatchIssueSubmission {
  const trimmed = message.trim();
  if (previous?.kind === kind && previous.message === trimmed) return previous;
  return { kind, message: trimmed, idempotencyKey: newKey() };
}
