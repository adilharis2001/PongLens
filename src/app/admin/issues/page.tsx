import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { requireAdmin } from "../requireAdmin";
import { MatchIssuesSection } from "./MatchIssuesSection";
import { withMatchIdentity, type AdminIssueDetail, type IssueListRow } from "./issuesView";

export const metadata: Metadata = { title: "Match issues", robots: { index: false, follow: false } };
export default async function MatchIssuesPage() {
  const { supabase, avatarUrl } = await requireAdmin();
  const { data, error } = await supabase.rpc("admin_match_issue_list", { p_status: "" });
  const rows = await withMatchIdentity((data as IssueListRow[] | null) ?? [], async issueId => {
    const result = await supabase.rpc("admin_match_issue_detail", { p_issue_id: issueId });
    return result.error ? null : (result.data as AdminIssueDetail | null)?.match ?? null;
  });
  return <AppShell avatarUrl={avatarUrl}><MatchIssuesSection initialRows={rows} initialError={Boolean(error)} /></AppShell>;
}
