import type { MatchIssueKind, MatchIssueStatus } from "../../../lib/matchIssues/types.ts";

export type IssueBucket = "pending" | "reprocessing" | "resolved";
export type IssueOutcome = "all" | "problem" | "reprocess" | "refund";
export interface IssueListRow {
  id: string;
  match_id: string;
  source_job_id: string;
  reporter_id: string;
  owner_id: string;
  reporter_role: "owner" | "coach";
  reporter_email: string | null;
  owner_email: string | null;
  kind: MatchIssueKind;
  status: MatchIssueStatus;
  message: string;
  refundable_minutes: number;
  created_at: string;
  updated_at: string;
  match_title?: string | null;
  match_played_at?: string | null;
}
export interface AdminIssueDetail {
  issue: Omit<IssueListRow, "reporter_email" | "owner_email"> & {
    player_note: string;
    internal_note: string;
    decided_at: string | null;
    source_version_id?: string | null;
    replacement_version_id?: string | null;
    replacement_job_id?: string | null;
  };
  match: {
    id: string; status: string; ownerId: string; jobId: string | null;
    cutPath: string | null; rawPath: string | null; matchJsonPath: string | null;
    opponentName: string | null; playedAt: string | null;
  };
  events: { id: string; kind: string; player_note: string; internal_note: string; created_at: string }[];
  versions?: ProcessingVersion[];
  sourceAvailable?: boolean;
  sourceJob?: { id: string; status: string; updatedAt: string; funding: string | null; chargedMinutes: number | null } | null;
}
export interface ProcessingVersion {
  id: string;
  status: "candidate" | "ready" | "active" | "superseded" | "failed";
  created_at: string;
  completed_at?: string | null;
  cut_path?: string | null;
  release_id: string | null;
  settings: { strictness?: string; placement?: boolean };
  totals?: { points: number; retained_duration_s: number | null };
  effects?: Record<string, number>;
}
export function versionFacts(version: ProcessingVersion) {
  const seconds = version.totals?.retained_duration_s;
  const retained = seconds == null ? "Not recorded" : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  return { points: version.totals ? String(version.totals.points) : "Not recorded", retained,
    release: version.release_id || "Not recorded", strictness: version.settings.strictness || "Not recorded",
    placement: version.settings.placement == null ? "Not recorded" : version.settings.placement ? "Requested" : "Not requested" };
}
export function restoreVersion(issue: { source_version_id?: string | null; replacement_version_id?: string | null; status: string }, versions: ProcessingVersion[]) {
  if (issue.status !== "resolved_reprocessed" || !versions.some(v => v.id === issue.replacement_version_id && v.status === "active")) return null;
  return versions.find(v => v.id === issue.source_version_id && v.status === "superseded") ?? null;
}
export type DecisionAction = { id: "reprocess" | "refund" | "publish" | "keep" | "close" | "restore"; label: string; primary: boolean; enabled: boolean; requiresPlayerNote: boolean };
export function decisionActions(issue: Pick<IssueListRow,"kind" | "status" | "refundable_minutes">, sourceAvailable: boolean, versionReady: boolean, canRestore = true): DecisionAction[] {
  const action = (id: DecisionAction["id"], label: string, primary=false, enabled=true): DecisionAction => ({id,label,primary,enabled,requiresPlayerNote:id!=="reprocess"});
  const refund = action("refund",refundPresentation(issue).label);
  if (issue.status === "resolved_reprocessed") return canRestore ? [action("restore","Restore previous version")] : [];
  if (issue.status === "candidate_ready") return [action("publish","Publish new version",true,versionReady),action("keep","Keep current version",false,versionReady),...(issue.refundable_minutes>0 ? [refund] : [])];
  if (!["pending","execution_failed"].includes(issue.status)) return [];
  if (issue.kind === "problem") return [action("close","Close request",true)];
  if (!["refund","reprocess"].includes(issue.kind)) return [];
  const reprocess = action("reprocess","Start reprocessing",issue.kind==="reprocess",sourceAvailable);
  const choices = issue.kind === "refund" ? [{...refund,primary:true,enabled:issue.refundable_minutes>0},reprocess] : [reprocess,...(issue.refundable_minutes>0 ? [refund] : [])];
  return [...choices,action("close","Close request")];
}
export const OUTCOME_LABELS = { all: "All outcomes", problem: "Report an issue", reprocess: "Reprocess", refund: "Return minutes", positive: "Looks good" };
export const STATUS_LABELS: Record<MatchIssueStatus, string> = {
  recorded: "Recorded", pending: "Pending", reprocess_queued: "Queued", reprocessing: "Reprocessing",
  candidate_ready: "Ready for review", execution_failed: "Reprocessing failed", resolved_refunded: "Minutes returned",
  resolved_reprocessed: "Reprocessed", declined: "Closed", cancelled: "Cancelled",
};
export function issueBucket(status: string): IssueBucket | null {
  if (["pending", "execution_failed"].includes(status)) return "pending";
  if (["reprocess_queued", "reprocessing", "candidate_ready"].includes(status)) return "reprocessing";
  if (["resolved_refunded", "resolved_reprocessed", "declined", "cancelled"].includes(status)) return "resolved";
  return null;
}
export function issueRows(rows: IssueListRow[], bucket: IssueBucket, outcome: IssueOutcome): IssueListRow[] {
  return rows.filter(row => issueBucket(row.status) === bucket && (outcome === "all" || row.kind === outcome))
    .sort((a, b) => bucket === "pending" ? a.created_at.localeCompare(b.created_at) : b.updated_at.localeCompare(a.updated_at));
}
/** The list RPC lacks match identity. Reuse its authorized detail RPC, once
 * per match, until the list contract carries these fields itself. */
export async function withMatchIdentity(rows: IssueListRow[], load: (issueId: string) => Promise<{ opponentName: string | null; playedAt: string | null } | null>): Promise<IssueListRow[]> {
  const identities = new Map<string, Awaited<ReturnType<typeof load>>>();
  const firstByMatch = new Map<string, IssueListRow>();
  for (const row of rows) if (!firstByMatch.has(row.match_id) && issueBucket(row.status)) firstByMatch.set(row.match_id, row);
  const unique = [...firstByMatch.values()];
  // Bound RPC fan-out; one unavailable identity does not hide the queue.
  for (let offset = 0; offset < unique.length; offset += 8) {
    await Promise.all(unique.slice(offset, offset + 8).map(async row => {
      try { identities.set(row.match_id, await load(row.id)); }
      catch { identities.set(row.match_id, null); }
    }));
  }
  return rows.map(row => {
    const match = identities.get(row.match_id);
    return match ? { ...row, match_title: match.opponentName, match_played_at: match.playedAt } : row;
  });
}
export function refundPresentation(issue: Pick<IssueListRow, "kind" | "status" | "refundable_minutes">) {
  const minutes = issue.refundable_minutes;
  const label = `Return ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const message = issue.status === "resolved_refunded"
    ? `${minutes} processing minute${minutes === 1 ? "" : "s"} returned.`
    : minutes <= 0 ? "No processing minutes are available to return." : null;
  return { label, enabled: issue.kind === "refund" && issue.status === "pending" && minutes > 0, message };
}
