import type { EmailMessage } from "./message.ts";
import type { MatchIssueKind } from "../matchIssues/types.ts";

type SubmissionInput = {
  issueId: string;
  matchId: string;
  reporterName: string;
  reporterEmail: string;
  reporterRole: "owner" | "coach";
  kind: Exclude<MatchIssueKind, "positive">;
  message: string;
  adminUrl: string;
};

const SUBMISSION_COPY = {
  problem: {
    subject: "Match problem reported",
    heading: "A match problem needs review",
  },
  reprocess: {
    subject: "Match reprocessing requested",
    heading: "A player requested another processing pass",
  },
  refund: {
    subject: "Processing minutes requested",
    heading: "A player requested their processing minutes back",
  },
} as const;

export function matchIssueSubmissionEmail(input: SubmissionInput): EmailMessage {
  const copy = SUBMISSION_COPY[input.kind];
  return {
    templateId: "ops.match-issue-submission",
    templateVersion: 1,
    category: "ops",
    audience: "admin",
    subject: copy.subject,
    preheader: `${input.reporterName} submitted a private match report.`,
    eyebrow: "Match issue",
    heading: copy.heading,
    blocks: [
      {
        type: "details",
        rows: [
          {
            label: input.reporterRole === "owner" ? "Player" : "Coach",
            value: `${input.reporterName} (${input.reporterEmail})`,
          },
          { label: "Match", value: input.matchId },
          { label: "Request", value: copy.subject },
        ],
      },
      ...(input.message
        ? ([{ type: "diagnostic", text: input.message }] as const)
        : []),
    ],
    action: { label: "Review issue", url: input.adminUrl },
    reason: "PongLens sent this because a private match issue needs review.",
    support: true,
  };
}

export type MatchIssueResolutionEmailKind =
  | "refund"
  | "reprocessed"
  | "restored"
  | "kept_current"
  | "declined"
  | "execution_failed";

type ResolutionInput = {
  kind: MatchIssueResolutionEmailKind;
  minutes: number;
  playerNote: string;
  matchUrl: string;
};

const RESOLUTION_COPY: Record<
  MatchIssueResolutionEmailKind,
  { subject: string; heading: string; summary: string }
> = {
  refund: {
    subject: "Your processing minutes were returned",
    heading: "Your processing minutes are back",
    summary: "Your match and everything added to it are still available.",
  },
  reprocessed: {
    subject: "A new cut is ready",
    heading: "Your new match cut is ready",
    summary: "The reviewed cut was published to your match.",
  },
  restored: {
    subject: "Your previous match version was restored",
    heading: "Your previous match version was restored",
    summary: "The previous version was restored with the work added to it.",
  },
  kept_current: {
    subject: "We kept your current cut",
    heading: "We reviewed your processing request",
    summary: "We kept the version you were using when this request was reviewed.",
  },
  declined: {
    subject: "Your request was reviewed",
    heading: "We reviewed your match request",
    summary: "The review did not change your match.",
  },
  execution_failed: {
    subject: "We could not prepare a new cut",
    heading: "We could not finish the new processing pass",
    summary: "That processing attempt did not change your match.",
  },
};

export function matchIssueResolutionEmail(input: ResolutionInput): EmailMessage {
  const copy = RESOLUTION_COPY[input.kind];
  return {
    templateId: "match.issue-resolution",
    templateVersion: 1,
    category: "match",
    audience: "player",
    subject: copy.subject,
    preheader: copy.summary,
    eyebrow: "Match issue",
    heading: copy.heading,
    blocks: [
      ...(input.kind === "refund"
        ? ([
            {
              type: "paragraph",
              text: `${input.minutes} processing minutes were added back to your account.`,
            },
          ] as const)
        : []),
      { type: "paragraph", text: input.playerNote },
      { type: "paragraph", text: copy.summary },
    ],
    action: { label: "Open match", url: input.matchUrl },
    reason: "PongLens sent this because you asked us to review a match cut.",
    support: true,
  };
}
