"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AdminHeader } from "../AdminHeader";
import { whenLabel } from "../uploads/uploadView";
import { issueRows, withMatchIdentity, OUTCOME_LABELS, STATUS_LABELS, type AdminIssueDetail, type IssueBucket, type IssueOutcome, type IssueListRow } from "./issuesView";

export function MatchIssuesSection({ initialRows, initialError }: { initialRows: IssueListRow[]; initialError: boolean }) {
  const [rows, setRows] = useState(initialRows);
  const [bucket, setBucket] = useState<IssueBucket>("pending");
  const [outcome, setOutcome] = useState<IssueOutcome>("all");
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error: loadError } = await supabase.rpc("admin_match_issue_list", { p_status: "" });
      setError(Boolean(loadError));
      if (!loadError) setRows(await withMatchIdentity((data as IssueListRow[] | null) ?? [], async issueId => {
        const result = await supabase.rpc("admin_match_issue_detail", { p_issue_id: issueId });
        return result.error ? null : (result.data as AdminIssueDetail | null)?.match ?? null;
      }));
    } catch { setError(true); } finally { setBusy(false); }
  }
  const shown = issueRows(rows, bucket, outcome);
  const chip = (selected: boolean) => `rounded-full border px-4 py-2 text-sm transition-colors ${selected ? "border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow" : "border-edge text-zinc-400 hover:text-white"}`;
  return <>
    <AdminHeader title="Match issues" />
    <div aria-label="Request status" className="mt-6 flex flex-wrap gap-2">
      {(["pending", "reprocessing", "resolved"] as const).map(value => <button key={value} type="button" aria-pressed={bucket === value} onClick={() => setBucket(value)} className={chip(bucket === value)}>{value === "pending" ? "Pending" : value === "reprocessing" ? "Reprocessing" : "Resolved"} ({issueRows(rows, value, "all").length})</button>)}
    </div>
    <div aria-label="Requested outcome" className="mt-3 flex flex-wrap gap-2">
      {(["all", "problem", "reprocess", "refund"] as const).map(value => <button key={value} type="button" aria-pressed={outcome === value} onClick={() => setOutcome(value)} className={chip(outcome === value)}>{OUTCOME_LABELS[value]}</button>)}
    </div>
    {error && <p role="alert" className="mt-4 text-sm text-red-400">Could not load match issues. Try again.</p>}
    <ul className="mt-5 space-y-3">
      {shown.map(row => <li key={row.id}><Link href={`/admin/issues/${row.id}`} className="block rounded-2xl border border-edge bg-surface p-4 transition-colors hover:border-cyan-glow/40">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-zinc-100">{OUTCOME_LABELS[row.kind]}</span><span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-zinc-400">{STATUS_LABELS[row.status]}</span></div>
        <p className="mt-2 break-words text-sm text-zinc-300">{row.owner_email ?? row.owner_id}</p>
        <p className="mt-1 break-words text-sm text-zinc-300">{row.match_title || `Match ${row.match_id.slice(0, 8)}`}{row.match_played_at ? ` · ${whenLabel(row.match_played_at)}` : ""}</p>
        <p className="mt-1 text-xs text-zinc-500">Requested {whenLabel(row.created_at)}{row.reporter_role === "coach" ? " · Reported by coach" : ""}</p>
        {row.message && <p className="mt-3 line-clamp-2 whitespace-pre-wrap break-words text-sm text-zinc-400">{row.message}</p>}
        <p className="mt-2 text-sm text-zinc-400">{row.refundable_minutes} refundable processing minute{row.refundable_minutes === 1 ? "" : "s"} recorded</p>
      </Link></li>)}
    </ul>
    {!error && shown.length === 0 && <p className="mt-5 text-sm text-zinc-500">No matching requests.</p>}
    <button type="button" onClick={() => void refresh()} disabled={busy} className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-edge px-4 py-2.5 text-sm text-zinc-300 disabled:opacity-50 sm:w-auto">{busy ? "Refreshing…" : "Refresh"}</button>
  </>;
}
