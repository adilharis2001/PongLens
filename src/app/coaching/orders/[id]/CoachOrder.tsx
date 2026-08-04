"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
import { createClient } from "@/lib/supabase/client";
import { FindingEditor } from "./FindingEditor";

export interface WorkspacePoint {
  id: string;
  idx: number;
  confirmed_winner: "user" | "opponent" | null;
  starred: boolean;
  is_let: boolean;
  deleted: boolean;
}

interface MatchRow {
  id: string;
  opponent_name: string | null;
  venue: string | null;
  played_at: string | null;
  status: string;
}

/**
 * One order, coach view. Submitted orders are an accept/decline decision
 * with the student's brief in full; accepted orders open the workspace
 * (findings, write-up sections, attachments, deliver); delivered orders
 * read exactly what the student sees, plus follow-up replies.
 */
export function CoachOrder({
  detail,
  messages,
  docSections,
  findings,
  links,
  attachments,
  match,
  points,
  userId,
}: {
  detail: ReviewOrderDetail;
  messages: ReviewMessageRow[];
  docSections: ReviewSectionContent[] | null;
  findings: ReviewFindingRow[];
  links: { finding_id: string; point_id: string }[];
  attachments: ReviewAttachmentRow[];
  match: MatchRow | null;
  points: WorkspacePoint[];
  userId: string;
}) {
  const router = useRouter();
  const s = detail.status;

  const findingPoints: Record<string, { point_id: string; idx: number }[]> =
    {};
  const idxById = new Map(points.map((p) => [p.id, p.idx]));
  for (const l of links) {
    (findingPoints[l.finding_id] ??= []).push({
      point_id: l.point_id,
      idx: idxById.get(l.point_id) ?? 0,
    });
  }
  for (const list of Object.values(findingPoints)) {
    list.sort((a, b) => a.idx - b.idx);
  }

  const header = (
    <>
      <Link
        href="/coaching"
        className="text-xs font-medium text-zinc-500 hover:text-zinc-300"
      >
        ← Coaching
      </Link>
      <div className="mt-2 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {detail.student_name}
        </h1>
        <span className="shrink-0 text-sm tabular-nums text-zinc-400">
          {formatUsd(detail.coach_share_cents)}
          <span className="text-zinc-600"> of {formatUsd(detail.price_cents)}</span>
        </span>
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        {detail.offering_title}
        {detail.promised_by &&
          (s === "in_review" || s === "clarification") &&
          ` · promised by ${new Date(detail.promised_by).toLocaleDateString(
            undefined,
            { weekday: "short", month: "short", day: "numeric" },
          )}`}
      </p>
      {match && match.status === "ready" && (
        <p className="mt-2 text-sm text-zinc-500">
          <Link
            href={`/match/${match.id}`}
            className="text-zinc-400 hover:text-cyan-glow"
          >
            Open the full match
          </Link>{" "}
          for scores, placement and your notes.
        </p>
      )}
    </>
  );

  const brief = detail.intake_answers.length > 0 && (
    <div className="mt-6 rounded-2xl border border-edge bg-surface p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Their brief
      </h2>
      <dl className="mt-3 space-y-3">
        {detail.intake_answers
          .filter((a) => a.answer)
          .map((a) => (
            <div key={a.id}>
              <dt className="text-xs text-zinc-500">{a.label}</dt>
              <dd className="mt-0.5 whitespace-pre-line text-sm text-zinc-300">
                {a.answer}
              </dd>
            </div>
          ))}
      </dl>
    </div>
  );

  if (s === "awaiting_submission") {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        <p className="mt-6 text-sm text-zinc-400">
          They haven't sent a match yet. The order starts when they do.
        </p>
      </div>
    );
  }

  if (s === "submitted") {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        {brief}
        <AcceptDecline detail={detail} onDone={() => router.refresh()} />
      </div>
    );
  }

  if (s === "in_review" || s === "clarification") {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        {brief}
        <Workspace
          detail={detail}
          docSections={docSections}
          findings={findings}
          findingPoints={findingPoints}
          attachments={attachments}
          points={points}
          messages={messages}
          matchId={match?.id ?? null}
          onChanged={() => router.refresh()}
        />
      </div>
    );
  }

  if (s === "delivered" || s === "completed") {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        <p className="mt-4 text-sm text-zinc-400">
          {s === "delivered"
            ? "Delivered. It completes when they mark it done, or after a quiet week."
            : "Completed. Your payout is on the way."}
        </p>
        <div className="mt-8">
          <ReviewBody
            orderId={detail.id}
            sections={docSections ?? []}
            findings={findings}
            findingPoints={findingPoints}
            attachments={attachments}
          />
          <div className="mt-8">
            <FollowupThread
              orderId={detail.id}
              messages={messages}
              viewerId={userId}
              canAsk={s === "delivered"}
              askLabel="Reply"
              onSent={() => router.refresh()}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      {header}
      <p className="mt-6 text-sm text-zinc-400">
        {s === "declined"
          ? "You declined this order. They were refunded in full."
          : "This order was cancelled and refunded."}
      </p>
    </div>
  );
}

function AcceptDecline({
  detail,
  onDone,
}: {
  detail: ReviewOrderDetail;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [message, setMessage] = useState("");

  async function accept() {
    setBusy(true);
    const res = await fetch("/api/reviews/transition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: detail.id, action: "accept" }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) onDone();
  }

  async function decline() {
    setBusy(true);
    await fetch("/api/reviews/transition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orderId: detail.id,
        action: "decline",
        message: message.trim(),
      }),
    }).catch(() => {});
    setBusy(false);
    onDone();
  }

  return (
    <div className="mt-6 rounded-2xl border border-edge bg-surface p-5">
      <p className="text-sm text-zinc-300">
        Accepting starts your {detail.turnaround_days}-day turnaround.
      </p>
      <button
        type="button"
        onClick={accept}
        disabled={busy}
        className="glow-cta mt-4 w-full rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink disabled:opacity-60"
      >
        {busy ? "One moment" : "Accept and start"}
      </button>
      {declining ? (
        <div className="mt-4">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="A short note to them. They get a full refund."
            className="w-full rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-cyan-glow/50"
          />
          <button
            type="button"
            onClick={decline}
            disabled={busy}
            className="mt-2 rounded-full border border-amber-400/50 px-4 py-2 text-xs font-medium text-amber-400 hover:bg-amber-400/10"
          >
            Decline and refund
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setDeclining(true)}
          className="mt-3 w-full text-center text-xs text-zinc-500 hover:text-amber-400"
        >
          Decline this order
        </button>
      )}
    </div>
  );
}

function Workspace({
  detail,
  docSections,
  findings,
  findingPoints,
  attachments,
  points,
  messages,
  matchId,
  onChanged,
}: {
  detail: ReviewOrderDetail;
  docSections: ReviewSectionContent[] | null;
  findings: ReviewFindingRow[];
  findingPoints: Record<string, { point_id: string; idx: number }[]>;
  attachments: ReviewAttachmentRow[];
  points: WorkspacePoint[];
  messages: ReviewMessageRow[];
  matchId: string | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmDeliver, setConfirmDeliver] = useState(false);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const clarifications = messages.filter((m) => m.kind === "clarification");

  const sectionDefs = detail.review_sections;
  const initialSections: ReviewSectionContent[] = sectionDefs.map((def) => {
    const existing = (docSections ?? []).find((x) => x.key === def.key);
    return { key: def.key, label: def.label, body: existing?.body ?? "" };
  });
  const [sections, setSections] = useState(initialSections);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );

  // Autosave the write-up two seconds after the last keystroke.
  function editSection(key: string, body: string) {
    const next = sections.map((x) => (x.key === key ? { ...x, body } : x));
    setSections(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveState("saving");
      await createClient().rpc("save_review_document", {
        p_order_id: detail.id,
        p_sections: next,
      });
      setSaveState("saved");
    }, 2000);
  }
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const canDeliver =
    findings.length > 0 || sections.some((x) => x.body.trim());

  async function deliver() {
    setBusy(true);
    // Flush the draft first so delivery snapshots the latest words.
    await createClient().rpc("save_review_document", {
      p_order_id: detail.id,
      p_sections: sections,
    });
    const res = await fetch("/api/reviews/transition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: detail.id, action: "deliver" }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) onChanged();
  }

  async function ask() {
    if (!question.trim()) return;
    setBusy(true);
    const res = await fetch("/api/reviews/transition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orderId: detail.id,
        action: "clarify",
        message: question.trim(),
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setQuestion("");
      setAsking(false);
      onChanged();
    }
  }

  return (
    <>
      {clarifications.length > 0 && (
        <div className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Questions
          </h2>
          <div className="mt-3 space-y-3">
            {clarifications.map((m) => (
              <div
                key={m.id}
                className={`rounded-2xl border border-edge bg-surface p-4 text-sm ${
                  m.author_id === detail.coach_id
                    ? "border-l-2 border-l-amber-400/60"
                    : "border-l-2 border-l-cyan-glow/60"
                }`}
              >
                <p className="whitespace-pre-line text-zinc-300">{m.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {detail.status === "clarification" && (
        <p className="mt-3 text-sm text-zinc-400">
          Waiting on their answer. You can keep working meanwhile.
        </p>
      )}
      {detail.status === "in_review" &&
        (asking ? (
          <div className="mt-4 rounded-2xl border border-edge bg-surface p-4">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="What do you need from them?"
              className="w-full rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-cyan-glow/50"
            />
            <div className="mt-2 flex gap-3">
              <button
                type="button"
                onClick={ask}
                disabled={busy || !question.trim()}
                className="rounded-full bg-cyan-glow px-4 py-2 text-xs font-semibold text-ink disabled:opacity-50"
              >
                Ask
              </button>
              <button
                type="button"
                onClick={() => setAsking(false)}
                className="rounded-full border border-edge px-4 py-2 text-xs font-medium text-zinc-400"
              >
                Never mind
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="mt-4 text-xs text-zinc-500 hover:text-cyan-glow"
          >
            Ask the student something
          </button>
        ))}

      <div className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight">The points</h2>
        <FindingEditor
          orderId={detail.id}
          matchId={matchId}
          points={points}
          findings={findings}
          findingPoints={findingPoints}
          onChanged={onChanged}
        />
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight">
          Your write-up
          {saveState === "saving" && (
            <span className="ml-2 text-xs font-normal text-zinc-500">
              saving
            </span>
          )}
          {saveState === "saved" && (
            <span className="ml-2 text-xs font-normal text-zinc-500">
              saved
            </span>
          )}
        </h2>
        <div className="mt-3 space-y-5">
          {sections.map((sec) => (
            <div key={sec.key}>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {sec.label}
              </label>
              <textarea
                value={sec.body}
                onChange={(e) => editSection(sec.key, e.target.value)}
                rows={4}
                className="mt-2 w-full rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm leading-relaxed text-zinc-100 outline-none focus:border-cyan-glow/50"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight">Attachments</h2>
        <AttachmentManager
          orderId={detail.id}
          attachments={attachments}
          onChanged={onChanged}
        />
      </div>

      <div className="mt-10 rounded-2xl border border-edge bg-surface p-5">
        {confirmDeliver ? (
          <>
            <p className="text-sm text-zinc-300">
              Deliver this review to {detail.student_name}? It locks when it
              ships.
            </p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={deliver}
                disabled={busy}
                className="glow-cta flex-1 rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink disabled:opacity-60"
              >
                {busy ? "Delivering" : "Deliver"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeliver(false)}
                className="rounded-full border border-edge px-5 py-3 text-sm font-medium text-zinc-400"
              >
                Not yet
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDeliver(true)}
            disabled={!canDeliver}
            className="glow-cta w-full rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink disabled:opacity-50"
          >
            Deliver the review
          </button>
        )}
        {!canDeliver && (
          <p className="mt-3 text-center text-xs text-zinc-500">
            Add a point or write a section first.
          </p>
        )}
      </div>
    </>
  );
}

function AttachmentManager({
  orderId,
  attachments,
  onChanged,
}: {
  orderId: string;
  attachments: ReviewAttachmentRow[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setNote(null);
    try {
      const createRes = await fetch("/api/review-attachment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          orderId,
          filename: file.name,
          contentType: file.type,
          size: file.size,
        }),
      });
      const created = (await createRes.json()) as {
        url?: string;
        key?: string;
        code?: string;
      };
      if (!createRes.ok || !created.url || !created.key) {
        setNote(
          created.code === "unsupported_type"
            ? "That file type isn't supported."
            : created.code === "too_large"
              ? "Files are limited to 50 MB."
              : "Could not upload. Try again.",
        );
        return;
      }
      const put = await fetch(created.url, { method: "PUT", body: file });
      if (!put.ok) {
        setNote("Could not upload. Try again.");
        return;
      }
      const doneRes = await fetch("/api/review-attachment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          orderId,
          key: created.key,
          filename: file.name,
          contentType: file.type,
        }),
      });
      if (!doneRes.ok) {
        setNote("Could not upload. Try again.");
        return;
      }
      onChanged();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(id: string) {
    await createClient().from("review_attachments").delete().eq("id", id);
    onChanged();
  }

  return (
    <div className="mt-3">
      {attachments.length > 0 && (
        <div className="mb-3 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-3 px-5 py-3.5"
            >
              <span className="truncate text-sm text-zinc-200">
                {a.filename}
              </span>
              <button
                type="button"
                onClick={() => remove(a.id)}
                className="shrink-0 text-xs text-zinc-500 hover:text-amber-400"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.mp4,.mov,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="rounded-full border border-edge bg-surface px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-glow/40 disabled:opacity-60"
      >
        {busy ? "Uploading" : "Add a file"}
      </button>
      <span className="ml-3 text-xs text-zinc-600">
        A practice plan, a drill sheet, anything up to 50 MB.
      </span>
      {note && <p className="mt-2 text-xs text-amber-400">{note}</p>}
    </div>
  );
}
