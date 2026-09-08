import type { MatchIssueKind, MatchIssueState, MatchIssueSubmission } from "../../../../lib/matchIssues/types.ts";

export interface FeedbackChoice {
  kind: MatchIssueKind;
  label: string;
  description: string;
}

/**
 * What the page offers. Remedies first — processing again, minutes back —
 * each only when the server says it applies to this match. A match with no
 * remedy left (the original no longer stored, nothing to refund) gets a
 * plain report instead, so there is always a way to say something went
 * wrong. Never "Looks good": the row this opens from says "Report a
 * problem", and on an old match the positive was the only thing on the
 * page, with nothing it could lead to. `hasOriginal` is only read to say
 * why a processed match has no remedy; null means not known.
 */
export function matchFeedbackPresentation(state: MatchIssueState, hasOriginal: boolean | null = null) {
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
      // Both are requests we review, and the description says what we do
      // when we accept one, so the two read as a pair.
      if (state.canReprocess) choices.push({ kind: "reprocess", label: "Request reprocessing", description: "We process the video again and review the new cut before it replaces this one." });
      if (state.canRefund && (state.refundableMinutes ?? 0) > 0) choices.push({ kind: "refund", label: `Request ${state.refundableMinutes} ${state.refundableMinutes === 1 ? "minute" : "minutes"} back`, description: "We return the minutes to your account and leave this match as it is." });
      if (choices.length === 0 && state.canProblem) choices.push({ kind: "problem", label: "Report a problem", description: "" });
    } else if (state.canProblem) {
      choices.push({ kind: "problem", label: "Report a problem", description: "" });
    }
  }
  const reportOnly = choices.length === 1 && choices[0].kind === "problem";
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
    placeholder: cut ? "Rallies that were missed, or cut at the wrong time." : "Tell us what went wrong.",
    action: reportOnly ? "Send report" : "Send request",
    // A report needs words (the server refuses an empty one); a remedy
    // request does not.
    messageRequired: reportOnly,
    // The one reason a processed match has no remedy the owner can do
    // nothing about, said plainly so the missing "Try processing again" is
    // not a mystery. "No longer stored", never "expired".
    noRemedyNote: cut && reportOnly && hasOriginal === false
      ? "The original video is no longer stored, so this match cannot be processed again." : null,
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
