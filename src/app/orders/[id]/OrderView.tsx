"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  FollowupThread,
  ReviewBody,
} from "@/components/reviews/ReviewReader";
import { formatUsd } from "@/lib/reviews/money";
import type {
  ReviewAttachmentRow,
  ReviewFindingRow,
  ReviewMessageRow,
  ReviewOrderDetail,
  ReviewSectionContent,
} from "@/lib/reviews/types";
import { isOverdueCancellable } from "@/lib/reviews/types";

/**
 * One screen that always answers: what state, what happens next, what the
 * coach promised. From delivery on it becomes the review itself.
 */

interface CandidateMatch {
  id: string;
  opponent_name: string | null;
  venue: string | null;
  played_at: string | null;
  status: string;
  match_type: string | null;
}

function matchLabel(m: {
  opponent_name?: string | null;
  played_at?: string | null;
  venue?: string | null;
}): string {
  const parts: string[] = [];
  if (m.opponent_name) parts.push(`vs ${m.opponent_name}`);
  if (m.played_at) {
    parts.push(
      new Date(m.played_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
    );
  }
  if (m.venue) parts.push(m.venue);
  return parts.join(" · ") || "Match";
}

function SubmitWizard({
  detail,
  candidates,
  onDone,
}: {
  detail: ReviewOrderDetail;
  candidates: CandidateMatch[];
  onDone: () => void;
}) {
  const [matchId, setMatchId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const required = detail.intake_questions.filter((q) => !q.optional);
  const ready =
    matchId !== null &&
    required.every((q) => (answers[q.id] ?? "").trim().length > 0);

  async function submit() {
    if (!ready || busy || !matchId) return;
    setBusy(true);
    setNote(null);
    const res = await fetch("/api/reviews/transition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orderId: detail.id,
        action: "submit",
        matchId,
        answers: detail.intake_questions.map((q) => ({
          id: q.id,
          label: q.label,
          answer: (answers[q.id] ?? "").trim(),
        })),
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setNote("Could not send it. Try again.");
      return;
    }
    onDone();
  }

  return (
    <div className="mt-6 rounded-2xl border border-edge bg-surface p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Which match?
      </h2>
      {candidates.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-400">
          No matches yet.{" "}
          <Link href="/upload" className="text-cyan-glow hover:underline">
            Upload one
          </Link>{" "}
          and come back — this page will be waiting.
        </p>
      ) : (
        <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
          {candidates.map((m) => (
            <label
              key={m.id}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm transition-colors ${
                matchId === m.id
                  ? "border-cyan-glow/60 bg-surface-2"
                  : "border-edge bg-surface-2/50 hover:border-cyan-glow/30"
              }`}
            >
              <span className="min-w-0 truncate text-zinc-200">
                {matchLabel(m)}
                {m.status === "processing" && (
                  <span className="ml-2 text-xs text-zinc-500">
                    still processing
                  </span>
                )}
              </span>
              <input
                type="radio"
                name="match"
                checked={matchId === m.id}
                onChange={() => setMatchId(m.id)}
                className="h-4 w-4 accent-cyan-400"
              />
            </label>
          ))}
        </div>
      )}
      {candidates.length > 0 && (
        <p className="mt-2 text-xs text-zinc-500">
          Or{" "}
          <Link href="/upload" className="text-zinc-400 hover:text-cyan-glow">
            upload a new match
          </Link>
          . A still-processing match sends itself when it is ready.
        </p>
      )}

      {detail.intake_questions.length > 0 && (
        <div className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            From {detail.coach_name}
          </h2>
          {detail.intake_questions.map((q) => (
            <div key={q.id} className="mt-4">
              <label className="block text-sm text-zinc-300">
                {q.label}
                {q.optional && (
                  <span className="ml-1 text-xs text-zinc-500">optional</span>
                )}
              </label>
              <textarea
                value={answers[q.id] ?? ""}
                onChange={(e) =>
                  setAnswers({ ...answers, [q.id]: e.target.value })
                }
                rows={2}
                maxLength={1000}
                className="mt-2 w-full rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-cyan-glow/50"
              />
            </div>
          ))}
        </div>
      )}

      {note && <p className="mt-3 text-xs text-amber-400">{note}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={!ready || busy}
        className="glow-cta mt-6 w-full rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink disabled:opacity-50"
      >
        {busy ? "Sending" : `Send to ${detail.coach_name}`}
      </button>
    </div>
  );
}

function Timeline({ detail }: { detail: ReviewOrderDetail }) {
  const events: Array<{ at: string | null; label: string }> = [
    { at: detail.paid_at ?? detail.created_at, label: "Ordered" },
    { at: detail.submitted_at, label: "Match sent" },
    { at: detail.accepted_at, label: `${detail.coach_name} started` },
    { at: detail.delivered_at, label: "Review delivered" },
    { at: detail.completed_at, label: "Done" },
    { at: detail.cancelled_at, label: "Cancelled" },
  ].filter((e) => e.at);
  return (
    <ol className="mt-6 space-y-2">
      {events.map((e) => (
        <li key={e.label} className="flex items-center gap-3 text-xs">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-cyan-glow/60"
          />
          <span className="text-zinc-400">{e.label}</span>
          <span className="text-zinc-600">
            {new Date(e.at!).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function OrderView({
  detail,
  messages,
  docSections,
  findings,
  findingPoints,
  attachments,
  candidateMatches,
  match,
  userId,
}: {
  detail: ReviewOrderDetail;
  messages: ReviewMessageRow[];
  docSections: ReviewSectionContent[];
  findings: ReviewFindingRow[];
  findingPoints: Record<string, { point_id: string; idx: number }[]>;
  attachments: ReviewAttachmentRow[];
  candidateMatches: CandidateMatch[];
  match: {
    id: string;
    opponent_name: string | null;
    venue: string | null;
    played_at: string | null;
    status: string;
  } | null;
  userId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reply, setReply] = useState("");

  const s = detail.status;
  const delivered = s === "delivered" || s === "completed";
  const canCancel =
    s === "awaiting_submission" ||
    s === "submitted" ||
    isOverdueCancellable(s, detail.promised_by);

  const clarifications = messages.filter((m) => m.kind === "clarification");
  const followupsUsed = messages.filter(
    (m) => m.kind === "followup" && m.author_id === userId,
  ).length;
  const followupsLeft = Math.max(0, detail.followup_rounds - followupsUsed);

  async function transition(action: string, message?: string) {
    setBusy(true);
    await fetch("/api/reviews/transition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: detail.id, action, message }),
    }).catch(() => {});
    setBusy(false);
    router.refresh();
  }

  async function sendReply() {
    if (!reply.trim() || busy) return;
    setBusy(true);
    const res = await fetch("/api/reviews/transition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orderId: detail.id,
        action: "reply",
        message: reply.trim(),
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setReply("");
      router.refresh();
    }
  }

  const headline =
    s === "awaiting_submission"
      ? "Pick your match"
      : s === "submitted"
        ? `Sent to ${detail.coach_name}`
        : s === "in_review"
          ? `${detail.coach_name} is on it`
          : s === "clarification"
            ? `${detail.coach_name} has a question`
            : s === "delivered"
              ? "Your review is ready"
              : s === "completed"
                ? "Your review"
                : s === "declined"
                  ? `${detail.coach_name} declined this one`
                  : "Cancelled";

  const nextLine =
    s === "submitted"
      ? "You can cancel any time before they start."
      : s === "in_review" && detail.promised_by
        ? `Promised by ${new Date(detail.promised_by).toLocaleDateString(
            undefined,
            { weekday: "long", month: "short", day: "numeric" },
          )}.`
        : s === "declined" || s === "cancelled"
          ? "Your refund goes back to the card you paid with."
          : s === "delivered" && followupsLeft > 0
            ? `${
                followupsLeft === 1
                  ? "One follow-up question"
                  : `${followupsLeft} follow-up questions`
              } included if anything is unclear.`
            : null;

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/orders"
        className="text-xs font-medium text-zinc-500 hover:text-zinc-300"
      >
        ← Your reviews
      </Link>
      <div className="mt-2 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {headline}
        </h1>
        <span className="shrink-0 text-sm tabular-nums text-zinc-500">
          {formatUsd(detail.price_cents)}
        </span>
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        {detail.offering_title} · {detail.coach_name}
      </p>
      {nextLine && <p className="mt-3 text-sm text-zinc-400">{nextLine}</p>}
      {detail.decline_message && s === "declined" && (
        <p className="mt-3 rounded-xl border border-edge bg-surface p-4 text-sm text-zinc-300">
          “{detail.decline_message}”
        </p>
      )}

      {match && (
        <p className="mt-3 text-sm text-zinc-500">
          {matchLabel(match)}
          {match.status === "ready" && (
            <>
              {" · "}
              <Link
                href={`/match/${match.id}`}
                className="text-zinc-400 hover:text-cyan-glow"
              >
                open the match
              </Link>
            </>
          )}
        </p>
      )}

      {s === "awaiting_submission" && (
        <SubmitWizard
          detail={detail}
          candidates={candidateMatches}
          onDone={() => router.refresh()}
        />
      )}

      {clarifications.length > 0 && (
        <div className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Questions from {detail.coach_name}
          </h2>
          <div className="mt-3 space-y-3">
            {clarifications.map((m) => (
              <div
                key={m.id}
                className={`rounded-2xl border border-edge bg-surface p-4 text-sm leading-relaxed ${
                  m.author_id === userId
                    ? "border-l-2 border-l-cyan-glow/60"
                    : "border-l-2 border-l-amber-400/60"
                }`}
              >
                <p className="whitespace-pre-line text-zinc-300">{m.body}</p>
              </div>
            ))}
          </div>
          {s === "clarification" && (
            <div className="mt-3 flex gap-2">
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                maxLength={2000}
                placeholder="Your answer"
                className="min-w-0 flex-1 rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-cyan-glow/50"
              />
              <button
                type="button"
                onClick={sendReply}
                disabled={busy || !reply.trim()}
                className="shrink-0 rounded-full bg-cyan-glow px-5 py-2 text-sm font-semibold text-ink disabled:opacity-50"
              >
                Send
              </button>
            </div>
          )}
        </div>
      )}

      {delivered && (
        <div className="mt-8">
          <ReviewBody
            orderId={detail.id}
            sections={docSections}
            findings={findings}
            findingPoints={findingPoints}
            attachments={attachments}
          />
          <div className="mt-8">
            <FollowupThread
              orderId={detail.id}
              messages={messages}
              viewerId={userId}
              canAsk={s === "delivered" && followupsLeft > 0}
              askLabel="Ask your follow-up"
              onSent={() => router.refresh()}
            />
          </div>
          {s === "delivered" && (
            <div className="mt-8 rounded-2xl border border-edge bg-surface p-5">
              <button
                type="button"
                onClick={() => transition("complete")}
                disabled={busy}
                className="glow-cta w-full rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink disabled:opacity-60"
              >
                Mark as done
              </button>
              <p className="mt-3 text-center text-xs text-zinc-500">
                Completes on its own after a week either way.
              </p>
            </div>
          )}
        </div>
      )}

      {!delivered && <Timeline detail={detail} />}

      {canCancel && s !== "awaiting_payment" && (
        <div className="mt-10">
          {confirmCancel ? (
            <div className="rounded-2xl border border-edge bg-surface p-4">
              <p className="text-sm text-zinc-300">
                Cancel this order? You get a full refund.
              </p>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => transition("cancel")}
                  disabled={busy}
                  className="rounded-full border border-amber-400/50 px-4 py-2 text-xs font-medium text-amber-400 hover:bg-amber-400/10"
                >
                  {busy ? "Cancelling" : "Yes, cancel it"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmCancel(false)}
                  className="rounded-full border border-edge px-4 py-2 text-xs font-medium text-zinc-400"
                >
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmCancel(true)}
              className="text-xs text-zinc-500 hover:text-amber-400"
            >
              Cancel this order
            </button>
          )}
        </div>
      )}
    </div>
  );
}
