"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AdminHeader } from "../AdminHeader";
import { UploadProcessingFacts } from "../uploads/UploadProcessingSummary";
import { whenLabel, type UploadDetail } from "../uploads/uploadView";
import { OUTCOME_LABELS, STATUS_LABELS, refundPresentation, decisionActions, restoreVersion, type DecisionAction, type AdminIssueDetail, type IssueListRow } from "./issuesView";
import { CandidateComparison } from "./CandidateComparison";

const secondary = "inline-flex min-h-11 w-full items-center justify-center rounded-full border border-edge px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-50 sm:w-auto";
const primary = "glow-cta inline-flex min-h-11 w-full items-center justify-center rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink disabled:opacity-50 sm:w-auto";
const field = "mt-2 block w-full rounded-xl border border-edge bg-ink p-3 text-sm text-zinc-100 focus:border-cyan-glow focus:outline-none";

export function MatchIssueDetail({ initialDetail, upload, identity }: { initialDetail: AdminIssueDetail; upload: UploadDetail | null; identity: IssueListRow | null }) {
  const [detail, setDetail] = useState(initialDetail);
  const [savedUpload, setSavedUpload] = useState(upload);
  const diagnosticVersion = useRef(initialDetail.versions?.find(version=>version.status==="active")?.id);
  const source = initialDetail.versions?.find(version=>version.id===initialDetail.issue.source_version_id);
  const [strictness, setStrictness] = useState(source?.settings.strictness || "normal");
  const [placement, setPlacement] = useState(source?.settings.placement ?? false);
  const [playerNote, setPlayerNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const issue = detail.issue;
  const refund = refundPresentation(issue);
  const versions = detail.versions ?? [];
  const current = versions.find(version=>version.status==="active") ?? null;
  const candidate = versions.find(version=>version.id===issue.replacement_version_id && version.id!==current?.id) ?? null;
  const previous = restoreVersion(issue,versions);
  const sourceAvailable = detail.sourceAvailable ?? false;
  const actions = decisionActions(issue,sourceAvailable,candidate?.status==="ready",!!previous);

  async function acceptSaved(saved: AdminIssueDetail) {
    setDetail(saved); setUncertain(false);
    // The deep diagnostic summary is active-version scoped too. Do not keep
    // showing the old cards or score totals after publish/restore.
    const activeId = saved.versions?.find(version=>version.status==="active")?.id;
    if (activeId !== diagnosticVersion.current) setSavedUpload(null);
    diagnosticVersion.current = activeId;
    try {
      const {data,error:loadError}=await createClient().rpc("admin_upload_detail",{p_match_id:saved.issue.match_id});
      if (!loadError && data) setSavedUpload(data as UploadDetail);
    } catch { /* The saved decision remains confirmed when diagnostics fail. */ }
  }

  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      const { data, error: loadError } = await createClient().rpc("admin_match_issue_detail", { p_issue_id: issue.id });
      if (loadError || !data) throw new Error("load failed");
      await acceptSaved(data as AdminIssueDetail);
    } catch { setError("Could not load the saved request. Try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function decide(action: DecisionAction) {
    if (inFlight.current || !action.enabled || uncertain || (action.requiresPlayerNote && !playerNote.trim())) return;
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/admin/match-issues/${issue.id}/${action.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action.id==="reprocess" ? {options:{strictness,placement},internalNote} : action.id==="restore" ? {playerNote} : { playerNote, internalNote }),
      });
      const result = await response.json();
      if (result.detail && (response.ok || response.status === 409)) {
        // Replace the whole decision, including event history. Never add credit locally.
        await acceptSaved(result.detail as AdminIssueDetail);
        setNotice(response.status === 409 ? "The action could not be applied. The saved request is shown." : "Request saved.");
        setPlayerNote(""); setInternalNote("");
        return;
      }
      if (response.status === 400) { setError("Check the processing settings and decision notes. Player explanations can have up to 1,000 characters and internal notes up to 4,000 characters."); return; }
      if (response.status === 401 || response.status === 403) { setError("Your admin session could not be verified. Sign in again."); setUncertain(true); return; }
      throw new Error("response unavailable");
    } catch { setUncertain(true); setError("Could not confirm the result. Refresh the saved request before trying again."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <>
    <AdminHeader title="Match issue" backHref="/admin/issues" />
    <section className="mt-6 rounded-2xl border border-edge bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold text-zinc-100">{detail.match.opponentName || "Match"}</h2><span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-zinc-400">{STATUS_LABELS[issue.status]}</span></div>
      {detail.match.playedAt && <p className="mt-1 text-sm text-zinc-500">{whenLabel(detail.match.playedAt)}</p>}
      <dl className="mt-4 space-y-3 text-sm">
        <div><dt className="text-zinc-500">Owner</dt><dd className="break-words text-zinc-300">{identity?.owner_email ?? upload?.owner?.email ?? issue.owner_id}</dd></div>
        <div><dt className="text-zinc-500">Reported by</dt><dd className="break-words text-zinc-300">{identity?.reporter_email ?? issue.reporter_id} · {issue.reporter_role === "coach" ? "Coach" : "Owner"}</dd></div>
        <div><dt className="text-zinc-500">Requested outcome</dt><dd className="text-zinc-300">{OUTCOME_LABELS[issue.kind]}</dd></div>
        <div><dt className="text-zinc-500">Submitted</dt><dd className="text-zinc-300">{whenLabel(issue.created_at)}</dd></div>
      </dl>
      {issue.message && <p className="mt-4 whitespace-pre-wrap break-words text-sm text-zinc-300">{issue.message}</p>}
      <p className="mt-4 break-all text-xs text-zinc-500">Source job: {issue.source_job_id}</p>
      {detail.sourceJob && <><p className="mt-2 text-sm text-zinc-400">{detail.sourceJob.status} · {detail.sourceJob.funding || "Funding not recorded"} · {detail.sourceJob.chargedMinutes != null ? `${detail.sourceJob.chargedMinutes} minutes charged` : "Charge not recorded"}</p><p className="mt-2 text-sm text-zinc-400">Source job last updated: {whenLabel(detail.sourceJob.updatedAt)}</p></>}
      <p className="mt-2 text-sm text-zinc-400">{issue.refundable_minutes} refundable processing minute{issue.refundable_minutes === 1 ? "" : "s"} recorded for this request.</p>
    </section>

    <section className="mt-6">
      <h2 className="text-lg font-semibold text-zinc-100">Processing</h2>
      {savedUpload && <dl className="mt-3 grid gap-3 sm:grid-cols-3"><UploadProcessingFacts totals={savedUpload.totals} /></dl>}
      <div className="mt-3 rounded-2xl border border-edge bg-surface p-5">
        {!savedUpload && <p className="text-sm text-zinc-400">Could not load the upload summary.</p>}
        <CandidateComparison matchId={issue.match_id} current={current} candidate={candidate} sourceAvailable={sourceAvailable} />
        {!sourceAvailable && <p className="mt-3 text-sm text-zinc-500">The original video is no longer stored.</p>}
        <Link href={`/admin/uploads/${issue.match_id}`} className={`${secondary} mt-4`}>Open upload diagnosis</Link>
      </div>
    </section>

    <section className="mt-6 rounded-2xl border border-edge bg-surface p-5">
      <h2 className="text-lg font-semibold text-zinc-100">Decision</h2>
      {refund.message && <p role="status" className="mt-3 text-sm text-zinc-300">{refund.message}</p>}
      {previous && <p className="mt-3 text-sm text-zinc-400">Restore the version created {whenLabel(previous.created_at)}. Release: {previous.release_id || "Not recorded"}.</p>}
      {actions.length>0 && <div className="mt-4 space-y-3">
        {actions.some(action=>action.id==="reprocess") && <>
          <label className="block text-sm text-zinc-300">Strictness<select className={field} value={strictness} disabled={busy} onChange={event=>setStrictness(event.target.value)}><option value="tight">Tight</option><option value="normal">Normal</option><option value="loose">Loose</option></select></label>
          <label className="flex min-h-11 items-center gap-3 text-sm text-zinc-300"><input type="checkbox" checked={placement} disabled={busy} onChange={event=>setPlacement(event.target.checked)} />Include placement</label>
        </>}
        <label className="block text-sm text-zinc-300">Player-visible explanation<textarea value={playerNote} onChange={event => setPlayerNote(event.target.value)} maxLength={1000} rows={3} disabled={busy} className={field} /></label>
        {!previous && <label className="block text-sm text-zinc-300">Internal notes (optional)<textarea value={internalNote} onChange={event => setInternalNote(event.target.value)} maxLength={4000} rows={3} disabled={busy} className={field} /></label>}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">{actions.map(action=><button type="button" key={action.id} disabled={busy || uncertain || !action.enabled || (action.requiresPlayerNote && !playerNote.trim())} onClick={()=>void decide(action)} className={action.primary ? primary : secondary}>{action.label}</button>)}</div>
      </div>}
      {issue.player_note && <div className="mt-4"><h3 className="text-sm text-zinc-500">Player-visible explanation</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-300">{issue.player_note}</p></div>}
      {issue.internal_note && <div className="mt-4"><h3 className="text-sm text-zinc-500">Internal notes</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-300">{issue.internal_note}</p></div>}
      {notice && <p role="status" className="mt-3 text-sm text-zinc-300">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void refresh()} className={`${secondary} mt-4`}>{busy ? "Loading…" : "Refresh saved request"}</button>
    </section>
    {detail.events.length > 0 && <section className="mt-6 rounded-2xl border border-edge bg-surface p-5">
      <h2 className="text-lg font-semibold text-zinc-100">History</h2>
      <ol className="mt-4 space-y-4">{detail.events.map(event => <li key={event.id}>
        <p className="text-sm text-zinc-300">{STATUS_LABELS[event.kind as keyof typeof STATUS_LABELS] ?? event.kind.replaceAll("_", " ")} · <span className="text-zinc-500">{whenLabel(event.created_at)}</span></p>
        {event.player_note && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-400">Player-visible: {event.player_note}</p>}
        {event.internal_note && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-500">Internal: {event.internal_note}</p>}
      </li>)}</ol>
    </section>}
  </>;
}
