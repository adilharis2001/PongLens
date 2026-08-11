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
import { createClient } from "@/lib/supabase/client";
import { ChatThread } from "@/components/reviews/ChatThread";
import { UpLink } from "@/components/UpLink";
import { AutoTextarea } from "@/components/AutoTextarea";

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
  // One page, one scroll: recent matches show outright, the rest expand
  // in place rather than scrolling inside a box.
  const [showAllMatches, setShowAllMatches] = useState(false);

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
        <div className="mt-3 space-y-2">
          {(showAllMatches ? candidates : candidates.slice(0, 6)).map((m) => (
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
          {!showAllMatches && candidates.length > 6 && (
            <button
              type="button"
              onClick={() => setShowAllMatches(true)}
              className="w-full rounded-xl border border-dashed border-edge px-4 py-3 text-sm text-zinc-400 transition-colors hover:border-cyan-glow/30"
            >
              Show all {candidates.length} matches
            </button>
          )}
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
              <AutoTextarea
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
  test = false,
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
  /** billing_mode = 'test' (092): a QA order, no real money behind it. */
  test?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

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

  async function respondSample(approve: boolean) {
    setBusy(true);
    const { createClient } = await import("@/lib/supabase/client");
    await createClient().rpc("respond_review_sample", {
      p_order_id: detail.id,
      p_approve: approve,
    });
    setBusy(false);
    router.refresh();
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
      <UpLink href="/orders" label="Your reviews" />
      <div className="mt-2 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {headline}
        </h1>
        <span className="shrink-0 text-sm tabular-nums text-zinc-500">
          {test && (
            <span className="mr-2 rounded-full border border-edge bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Test
            </span>
          )}
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

      {(clarifications.length > 0 ||
        s === "in_review" ||
        s === "clarification") && (
        <div className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Questions
          </h2>
          <div className="mt-3">
            <ChatThread
              orderId={detail.id}
              messages={clarifications}
              viewerId={userId}
              otherName={detail.coach_name}
              canWrite={s === "in_review" || s === "clarification"}
              onSent={() => router.refresh()}
            />
          </div>
        </div>
      )}

      {delivered && (
        <div className="mt-8">
          {detail.sample_consent === "requested" && (
            <div className="mb-8 rounded-2xl border border-cyan-glow/40 bg-surface p-5">
              <p className="text-sm text-zinc-200">
                {detail.coach_name} would like to show this review on their
                page as an example, with your match footage. Up to you.
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void respondSample(true)}
                  className="glow-cta rounded-full bg-cyan-glow px-5 py-2 text-xs font-semibold text-ink disabled:opacity-60"
                >
                  Share it
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void respondSample(false)}
                  className="rounded-full border border-edge px-5 py-2 text-xs font-medium text-zinc-400"
                >
                  No thanks
                </button>
              </div>
            </div>
          )}
          <ReviewBody
            orderId={detail.id}
            sections={docSections}
            findings={findings}
            findingPoints={findingPoints}
            attachments={attachments}
            matchId={match?.status === "ready" ? match.id : null}
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

      {s === "completed" && (
        <TestimonialCard detail={detail} onChanged={() => router.refresh()} />
      )}

      {s === "completed" && detail.coach_handle && (
        <div className="mt-8 text-center">
          <Link
            href={`/coach/${detail.coach_handle}`}
            className="inline-block rounded-full border border-cyan-glow/40 px-6 py-2.5 text-sm font-medium text-cyan-glow transition-colors hover:bg-cyan-glow/10"
          >
            Book another review
          </Link>
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
                  className="rounded-full border border-amber-400/50 px-4 py-2 text-sm font-medium text-amber-400 hover:bg-amber-400/10"
                >
                  {busy ? "Cancelling" : "Yes, cancel it"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmCancel(false)}
                  className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-400"
                >
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmCancel(true)}
              className="rounded-full border border-edge px-5 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:border-amber-400/40 hover:text-amber-400"
            >
              Cancel this order
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * After completion: the student's own words about the review. Sending is
 * the consent; editing later un-features the quote so the coach approves
 * the new words (leave_review_testimonial handles both).
 */
function TestimonialCard({
  detail,
  onChanged,
}: {
  detail: ReviewOrderDetail;
  onChanged: () => void;
}) {
  const [body, setBody] = useState(detail.testimonial ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const sent = detail.testimonial !== null;
  const dirty = body.trim() !== (detail.testimonial ?? "");

  async function send() {
    if (!body.trim() || busy) return;
    setBusy(true);
    setNote(null);
    const { error } = await createClient().rpc("leave_review_testimonial", {
      p_order_id: detail.id,
      p_body: body.trim(),
    });
    setBusy(false);
    if (error) {
      setNote("Could not send it. Try again.");
      return;
    }
    onChanged();
  }

  return (
    <div className="mt-8 rounded-2xl border border-edge bg-surface p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {sent ? "Your note" : `A note for ${detail.coach_name}`}
      </h2>
      <AutoTextarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="What did you get out of it?"
        className="mt-3 w-full rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm leading-relaxed text-zinc-100 outline-none focus:border-cyan-glow/50"
      />
      {(!sent || dirty) && body.trim() && (
        <button
          type="button"
          onClick={send}
          disabled={busy}
          className="mt-3 rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
        >
          {busy ? "Sending" : sent ? "Update" : "Send"}
        </button>
      )}
      <p className="mt-3 text-xs text-zinc-500">
        {sent && !dirty
          ? "Sent. They may show it on their page with your first name."
          : `May appear on ${detail.coach_name}'s page with your first name.`}
      </p>
      {note && <p className="mt-2 text-xs text-amber-400">{note}</p>}
    </div>
  );
}
