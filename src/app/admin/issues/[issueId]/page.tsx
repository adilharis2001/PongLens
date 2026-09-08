import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { requireAdmin } from "../../requireAdmin";
import type { UploadDetail } from "../../uploads/uploadView";
import { MatchIssueDetail } from "../MatchIssueDetail";
import type { AdminIssueDetail, IssueListRow } from "../issuesView";

export const metadata: Metadata = { title: "Match issue", robots: { index: false, follow: false } };
export default async function MatchIssuePage({ params }: { params: Promise<{ issueId: string }> }) {
  const { supabase, avatarUrl } = await requireAdmin();
  const { issueId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(issueId)) notFound();
  const { data, error } = await supabase.rpc("admin_match_issue_detail", { p_issue_id: issueId });
  if (error?.code === "P0002" || (!error && !data)) notFound();
  if (error) throw new Error("Could not load match issue.");
  const detail = data as AdminIssueDetail;
  const [upload, list] = await Promise.all([
    supabase.rpc("admin_upload_detail", { p_match_id: detail.issue.match_id }),
    supabase.rpc("admin_match_issue_list", { p_status: "" }),
  ]);
  const identity = (list.data as IssueListRow[] | null)?.find(row => row.id === issueId) ?? null;
  return <AppShell avatarUrl={avatarUrl}><MatchIssueDetail initialDetail={detail} upload={upload.error ? null : upload.data as UploadDetail | null} identity={identity} /></AppShell>;
}
