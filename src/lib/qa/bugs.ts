/**
 * The bug vocabulary, in one place so a state name never leaks into copy
 * the way it would if each component wrote its own label. Mirrors the
 * check constraints in migration 104; the database is the boundary and
 * this is the translation.
 */

import type { TestArea } from "./testLibrary";

export type BugStatus =
  | "open"
  | "triaged"
  | "fixed"
  | "verified"
  | "closed"
  | "rejected"
  | "duplicate"
  | "deferred";

export type BugKind =
  | "functional"
  | "accuracy"
  | "visual"
  | "performance"
  | "copy";

export type BugSeverity = "blocker" | "major" | "minor";

/** qa_bugs.area is the library's areas plus a catch-all. */
export type BugArea = TestArea | "other";

export interface BugAttachment {
  key: string;
  kind: "image" | "video";
  w?: number;
  h?: number;
}

export interface Bug {
  id: string;
  reporter_id: string;
  title: string;
  steps: string;
  expected: string;
  actual: string;
  kind: BugKind;
  area: BugArea;
  severity: BugSeverity;
  status: BugStatus;
  device: string;
  browser: string;
  viewport: string;
  url: string;
  build_sha: string | null;
  match_id: string | null;
  point_id: string | null;
  order_id: string | null;
  job_id: string | null;
  video_seconds: number | null;
  billing_mode: "live" | "test" | null;
  case_id: string;
  attachments: BugAttachment[];
  duplicate_of: string | null;
  source: "portal" | "csv" | "feedback";
  resolution: string;
  created_at: string;
  updated_at: string;
  status_changed_at: string;
}

/**
 * Plain wording for each state, and who it is waiting on. "Waiting on"
 * is what makes this a loop rather than a suggestion box: `fixed` hands
 * the row back to the tester instead of ending the conversation.
 */
export const STATUS_META: Record<
  BugStatus,
  { label: string; waitingOn: "tester" | "owner" | null }
> = {
  open: { label: "Open", waitingOn: "owner" },
  triaged: { label: "Accepted", waitingOn: "owner" },
  fixed: { label: "Ready to verify", waitingOn: "tester" },
  verified: { label: "Verified", waitingOn: "owner" },
  closed: { label: "Closed", waitingOn: null },
  rejected: { label: "Not a bug", waitingOn: null },
  duplicate: { label: "Duplicate", waitingOn: null },
  deferred: { label: "Later", waitingOn: null },
};

export const OPEN_STATUSES: BugStatus[] = [
  "open",
  "triaged",
  "fixed",
  "verified",
];

export const TERMINAL_STATUSES: BugStatus[] = [
  "closed",
  "rejected",
  "duplicate",
  "deferred",
];

export const KIND_LABEL: Record<BugKind, string> = {
  functional: "Functional",
  // Kept separate from functional on purpose: this is evidence about the
  // vision pipeline, not something anyone fixes in a component.
  accuracy: "Accuracy",
  visual: "Visual",
  performance: "Performance",
  copy: "Copy",
};

export const SEVERITY_LABEL: Record<BugSeverity, string> = {
  blocker: "Blocker",
  major: "Major",
  minor: "Minor",
};

/** Worst first. The table's default order, and the CSV's. */
export const SEVERITY_RANK: Record<BugSeverity, number> = {
  blocker: 0,
  major: 1,
  minor: 2,
};

/**
 * Which statuses a given viewer may move a bug to. The database enforces
 * the same thing through two update policies; this decides what the UI
 * offers, so the tester is never shown a control that will fail.
 */
export function allowedStatuses(
  current: BugStatus,
  viewer: "tester" | "owner",
): BugStatus[] {
  if (viewer === "owner") {
    return Object.keys(STATUS_META) as BugStatus[];
  }
  // The tester confirms a fix or sends it back, and may withdraw their
  // own report. Everything else is the owner's call.
  if (current === "fixed") return ["verified", "open"];
  if (current === "open" || current === "triaged") return [current, "duplicate"];
  return [];
}

export function isOpen(status: BugStatus): boolean {
  return OPEN_STATUSES.includes(status);
}
