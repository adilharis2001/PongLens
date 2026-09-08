"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { shouldRefreshActiveVersion } from "@/lib/matchIssues/activeVersion";
import { useCallback, useEffect, useRef, useState } from "react";
import { DictateButton } from "@/components/DictateButton";
import type { MatchIssue, MatchIssueKind, MatchIssueState, MatchIssueSubmission } from "@/lib/matchIssues/types";
import { TOOL_ROW_CLASS, ToolRowChevron } from "../ReelBar";
import { matchFeedbackPresentation, submissionAttempt } from "./matchFeedbackView";

/*
 * Private feedback about how a match was processed — Try processing again,
 * Request minutes back, or a plain report when neither applies — and the
 * review that follows.
 * The public Feedback board is a different thing at /feedback; the match
 * page offers both, one row each, so an idea or a bug never has to be
 * squeezed into a question about one match's cut.
 *
 * This page used to carry a second video player beside the choices, so
 * the cut, the Original button and the download appeared here and on the
 * match page one click apart. The video it asks about is on the match
 * page; this is one card.
 */

const pill = "inline-flex min-h-11 w-full items-center justify-center rounded-full border border-edge px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-50 sm:w-auto";
const primary = "glow-cta inline-flex min-h-11 w-full items-center justify-center rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink disabled:opacity-50 sm:w-auto";

function useMatchIssueState(matchId: string, initialState: MatchIssueState | null = null) {
  const [state, setState] = useState(initialState);
  const [loadError, setLoadError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const res = await fetch(`/api/match-issues/${matchId}`, { cache: "no-store", signal: controller.signal });
      const data = await res.json();
      if (!res.ok || !data.state) throw new Error("state unavailable");
      setState(data.state as MatchIssueState);
      setLoadError(null);
    } catch {
      if (!controller.signal.aborted) setLoadError("Could not check your request. You can try again.");
    }
  }, [matchId]);
  useEffect(() => {
    void refresh();
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      request.current?.abort();
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
  const poll = state ? matchFeedbackPresentation(state).poll : false;
  useEffect(() => {
    if (!poll) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 10000);
    return () => clearInterval(timer);
  }, [poll, refresh]);
  const saved = (issue: MatchIssue) => {
    request.current?.abort();
    setState(current => current ? { ...current, activeIssue: issue, events: [] } : current);
  };
  return { state, loadError, refresh, saved };
}

/** The Processing row in Tools, with a live trailing status even on a ready match. */
export function MatchFeedbackLink({ matchId, isOwner, matchStatus, activeVersionId }: {
  matchId: string; isOwner: boolean; matchStatus: MatchIssueState["matchStatus"]; activeVersionId?: string | null;
}) {
  const { state } = useMatchIssueState(matchId);
  const router = useRouter();
  useEffect(() => {
    if (shouldRefreshActiveVersion(activeVersionId, state?.activeProcessingVersionId)) router.refresh();
  }, [activeVersionId, state?.activeProcessingVersionId, router]);
  const view = matchFeedbackPresentation(state ?? {
    role: isOwner ? "owner" : "coach", matchStatus, activeIssue: null, events: [],
    refundableMinutes: null, canPositive: false, canProblem: false, canReprocess: false, canRefund: false,
  });
  return <Link href={`/match/${matchId}/feedback`} className={TOOL_ROW_CLASS}>
    <span className="text-sm font-semibold">Processing</span>
    <span className="flex min-w-0 shrink-0 items-center gap-2">
      <span className="text-xs text-zinc-500">{view.trailing}</span>
      <ToolRowChevron />
    </span>
  </Link>;
}

/**
 * The public Feedback board, one row under Processing. Ideas and bugs have
 * nothing to do with how one match was cut, but a match page is where most
 * of them occur to people, so the board opens with this match attached —
 * which is what the row in this slot always did before Processing took it.
 */
export function FeedbackBoardLink({ matchId }: { matchId: string }) {
  return <Link href={`/feedback?matchId=${matchId}`} className={TOOL_ROW_CLASS}>
    <span className="text-sm font-semibold">Feedback</span>
    <span className="flex min-w-0 shrink-0 items-center gap-2">
      <span className="text-xs text-zinc-500">Ideas and bugs</span>
      <ToolRowChevron />
    </span>
  </Link>;
}

const eventLabels: Record<string, string> = {
  submitted: "Request sent", cancelled: "Cancelled", reprocess_queued: "Reprocessing queued",
  reprocessing: "Reprocessing", candidate_ready: "New version ready", execution_failed: "Needs another review",
  refunded: "Minutes returned", published: "New version published", kept_current: "Current version kept",
  restored: "Previous version restored", declined: "Request closed",
};

export function MatchFeedback({ matchId, initialState, isOwner, matchStatus, title, detail, thumbnail, hasOriginal }: {
  matchId: string; initialState: MatchIssueState | null; isOwner: boolean;
  matchStatus: MatchIssueState["matchStatus"]; title: string; detail: string; thumbnail: string | null; hasOriginal: boolean;
}) {
  const { state, loadError, refresh, saved } = useMatchIssueState(matchId, initialState);
  const fallback: MatchIssueState = { role: isOwner ? "owner" : "coach", matchStatus,
    activeIssue: null, events: [], refundableMinutes: null,
    canPositive: false, canProblem: false, canReprocess: false, canRefund: false };
  const view = matchFeedbackPresentation(state ?? fallback, hasOriginal);
  const [choice, setChoice] = useState<MatchIssueKind | null>(null);
  const selected = choice ?? (view.choices.length === 1 && view.choices[0].kind === "problem" ? "problem" : null);
  const selectedChoice = view.choices.find(c => c.kind === selected);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const attempt = useRef<MatchIssueSubmission | null>(null);
  const [dictating, setDictating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const issue = state?.activeIssue;

  const submit = async () => {
    if (busyRef.current || !selectedChoice || dictating || (view.messageRequired && !message.trim())) return;
    busyRef.current = true; setBusy(true); setError(null); setConfirmation(null);
    attempt.current = submissionAttempt(attempt.current, selectedChoice.kind, selectedChoice.kind === "positive" ? "" : message, () => crypto.randomUUID());
    try {
      const res = await fetch(`/api/match-issues/${matchId}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(attempt.current),
      });
      const data = await res.json();
      if (!res.ok || !data.issue) {
        setError(res.status === 409 ? "This match has changed. Check the current request and try again." : "Could not send your request. Try again.");
        await refresh();
        return;
      }
      saved(data.issue);
      setConfirmation(selectedChoice.kind === "positive" ? "Thanks for the feedback."
        : selectedChoice.kind === "problem" ? "Report sent. We will notify you when it has been reviewed."
        : "Request sent. We will notify you when it has been reviewed.");
      attempt.current = null;
      setChoice(null); setMessage("");
      await refresh();
    } catch { setError("Could not send your request. Check your connection and try again."); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const cancel = async () => {
    if (busyRef.current || !view.canCancel || !issue) return;
    busyRef.current = true; setBusy(true); setError(null); setConfirmation(null);
    try {
      const res = await fetch(`/api/match-issues/${matchId}`, {
        method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ issueId: issue.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.issue) setError("Could not cancel this request. It may already have been reviewed.");
      else saved(data.issue);
      await refresh();
    } catch { setError("Could not cancel your request. Check your connection and try again."); }
    finally { busyRef.current = false; setBusy(false); }
  };

  return <>
    <h1 className="mt-5 text-2xl font-bold tracking-tight sm:text-3xl">Processing</h1>
    <header className="my-5 flex min-w-0 items-center gap-3">
      {thumbnail && <div className="h-12 w-20 shrink-0 overflow-hidden rounded-lg bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumbnail} alt="" className="h-full w-full object-cover" />
      </div>}
      <div className="min-w-0"><p className="break-words text-sm font-semibold text-zinc-100">{title}</p><p className="mt-1 text-xs text-zinc-500">{detail}</p></div>
    </header>
    <div className="rounded-2xl border border-edge bg-surface p-5 sm:p-6">
      {view.automaticRefundMessage && <p role="status" className="mb-4 text-sm text-zinc-300">{view.automaticRefundMessage}</p>}
      {confirmation && <p role="status" className="mb-4 text-sm text-zinc-300">{confirmation}</p>}
      {!state && !loadError && <p role="status" className="text-sm text-zinc-400">Loading…</p>}
      {issue && <div className="space-y-3">
        {view.statusLabel && <p className="text-sm font-semibold text-zinc-100">{view.statusLabel}</p>}
        {view.message && view.message !== confirmation && <p className="text-sm text-zinc-300">{view.message}</p>}
        {issue.message && <p className="whitespace-pre-wrap break-words text-sm text-zinc-400">{issue.message}</p>}
        {issue.playerNote && issue.playerNote !== view.message && <p className="whitespace-pre-wrap break-words text-sm text-zinc-300">{issue.playerNote}</p>}
        {view.canCancel && <button type="button" disabled={busy} onClick={() => void cancel()} className={pill}>Cancel request</button>}
      </div>}
      {view.choices.length > 0 && <form className={issue ? "mt-5 space-y-4" : "space-y-4"} onSubmit={e => { e.preventDefault(); void submit(); }}>
        {/* A coach, or an owner whose match is not ready, has one thing
            to say and no choice to make: the note is the whole form. */}
        {view.choices[0].kind !== "problem" && <fieldset disabled={busy || dictating} className="space-y-2">
          <legend className="sr-only">Processing</legend>
          {view.choices.map(c => {
            const on = selected === c.kind;
            // The app's choose-one row: a rounded field, lit in the accent
            // with a check when chosen. The radio itself is for the
            // keyboard and the screen reader; the row is the control.
            return <label key={c.kind} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors focus-within:border-cyan-glow ${
              on ? "border-cyan-glow/70 bg-cyan-glow/10" : "border-edge bg-ink/40 hover:border-zinc-600"
            }`}>
              <input type="radio" name="outcome" value={c.kind} checked={on} onChange={() => { setChoice(c.kind); setConfirmation(null); }} className="sr-only" />
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-semibold ${on ? "text-cyan-glow" : "text-zinc-100"}`}>{c.label}</span>
                <span className="mt-0.5 block text-xs text-zinc-500">{c.description}</span>
              </span>
              {on && <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 text-cyan-glow" fill="currentColor" aria-hidden="true">
                <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.7 7.7-5.4 5.4a1 1 0 0 1-1.4 0l-2.6-2.6a1 1 0 1 1 1.4-1.4l1.9 1.9 4.7-4.7a1 1 0 1 1 1.4 1.4Z" />
              </svg>}
            </label>;
          })}
        </fieldset>}
        {view.noRemedyNote && <p className="text-sm text-zinc-300">{view.noRemedyNote}</p>}
        {selected && selected !== "positive" && <>
          <label className="block text-sm text-zinc-300">
            {view.fieldLabel}{!view.messageRequired && " (optional)"}
            <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder={view.placeholder} maxLength={1000} rows={3} required={view.messageRequired} disabled={busy}
              className="mt-2 block w-full rounded-xl border border-edge bg-ink p-3 text-sm text-zinc-100 focus:border-cyan-glow focus:outline-none" />
          </label>
          <DictateButton label="Dictate your message" onBusyChange={setDictating} onError={setError} onTranscript={text => setMessage(current => `${current}${current ? " " : ""}${text}`.slice(0, 1000))} />
        </>}
        <button disabled={busy || dictating || !selectedChoice || (view.messageRequired && !message.trim())} className={primary}>{busy ? "Sending…" : "Send"}</button>
      </form>}
      {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
      {loadError && <div className="mt-3 space-y-3"><p role="alert" className="text-sm text-red-400">{loadError}</p><button type="button" onClick={() => void refresh()} disabled={busy} className={pill}>Try again</button></div>}
      {(state?.events?.length ?? 0) > 0 && <div className="mt-5 border-t border-edge pt-4">
        <h2 className="text-sm font-semibold text-zinc-200">History</h2>
        <ol className="mt-3 space-y-3">{state!.events.map(event => <li key={event.id} className="text-sm">
          <p className="text-zinc-300">{eventLabels[event.kind] ?? "Request updated"}</p>
          {event.playerNote && <p className="mt-1 whitespace-pre-wrap break-words text-zinc-400">{event.playerNote}</p>}
          <time dateTime={event.createdAt} className="mt-1 block text-xs text-zinc-500">{new Date(event.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</time>
        </li>)}</ol>
      </div>}
    </div>
  </>;
}
