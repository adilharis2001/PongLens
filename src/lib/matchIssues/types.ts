export type MatchIssueKind = "positive" | "problem" | "reprocess" | "refund";

export type MatchIssueStatus =
  | "recorded"
  | "pending"
  | "reprocess_queued"
  | "reprocessing"
  | "candidate_ready"
  | "resolved_reprocessed"
  | "resolved_refunded"
  | "declined"
  | "execution_failed"
  | "cancelled";

export type MatchIssueResolution = "reprocess" | "refund" | "none";

export interface MatchIssue {
  id: string;
  matchId: string;
  kind: MatchIssueKind;
  status: MatchIssueStatus;
  message: string;
  resolution?: MatchIssueResolution;
  playerNote?: string;
  refundableMinutes?: number;
  createdAt: string;
  updatedAt: string;
}

export interface MatchIssueState {
  activeProcessingVersionId?: string | null;
  /** Receipt IDs are exact decimal strings from Postgres bigint, never UUIDs or JSON numbers. */
  automaticRefund?: { minutes: number; receiptIds: string[] } | null;
  role: "owner" | "coach";
  matchStatus: "uploaded" | "processing" | "ready" | "failed";
  activeIssue: MatchIssue | null;
  refundableMinutes: number | null;
  canPositive: boolean;
  canProblem: boolean;
  canReprocess: boolean;
  canRefund: boolean;
  events: Pick<MatchIssueEvent, "id" | "issueId" | "kind" | "playerNote" | "createdAt">[];
}

export interface MatchIssueEvent {
  id: string;
  issueId: string;
  kind:
    | "submitted"
    | "cancelled"
    | "reprocess_queued"
    | "reprocessing"
    | "candidate_ready"
    | "execution_failed"
    | "refunded"
    | "published"
    | "kept_current"
    | "restored"
    | "declined";
  playerNote: string;
  internalNote?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface MatchIssueSubmission {
  kind: MatchIssueKind;
  message: string;
  idempotencyKey: string;
}
