"use client";

import { useEffect, useState } from "react";

import { PointReel } from "@/components/reviews/PointReel";
import { formatUsd } from "@/lib/reviews/money";
import type {
  ReviewAttachmentRow,
  ReviewFindingRow,
  ReviewMessageRow,
  ReviewSectionContent,
} from "@/lib/reviews/types";

/**
 * The delivered review, readable by both parties: the coach's write-up
 * sections, the findings with their cited points, attachments, and the
 * follow-up thread. Media is signed on demand through /api/review-media —
 * links are short-lived by design.
 */

async function signedUrl(body: Record<string, string>): Promise<string | null> {
  try {
    const res = await fetch("/api/review-media", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string };
    return data.url ?? null;
  } catch {
    return null;
  }
}

function FindingImage({
  findingId,
  fromIdx,
}: {
  findingId: string;
  /** Rank of the point the frame was drawn on (081), if known. */
  fromIdx: number | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    void signedUrl({ findingId, kind: "image" }).then(setUrl);
  }, [findingId]);
  if (!url) return null;
  return (
    <div className="mt-3">
      {/* Signed, short-lived R2 URL; next/image optimization would break it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Coach drawing"
        className="w-full rounded-xl border border-edge"
      />
      {fromIdx !== null && (
        <p className="mt-1.5 text-xs text-zinc-500">From point {fromIdx + 1}</p>
      )}
    </div>
  );
}

function FindingAudio({ findingId }: { findingId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  if (url) {
    return <audio controls autoPlay src={url} className="mt-3 w-full" />;
  }
  return (
    <button
      type="button"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        setUrl(await signedUrl({ findingId, kind: "audio" }));
        setLoading(false);
      }}
      className="mt-3 inline-flex items-center gap-2 rounded-full border border-edge bg-surface-2 px-4 py-2 text-xs font-medium text-zinc-300 hover:border-cyan-glow/40"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M8 5v14l11-7z" />
      </svg>
      {loading ? "Loading" : "Voice note"}
    </button>
  );
}

export function FindingCard({
  finding,
  points,
  orderId,
  matchId,
}: {
  finding: ReviewFindingRow;
  points: { point_id: string; idx: number }[];
  orderId: string;
  /** When set, each finding links into the full match viewer. */
  matchId?: string | null;
}) {
  return (
    <div className="rounded-2xl border border-edge bg-surface p-5">
      {finding.title && (
        <h3 className="text-sm font-semibold text-zinc-100">
          {finding.title}
        </h3>
      )}
      {finding.body && (
        <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-zinc-300">
          {finding.body}
        </p>
      )}
      {finding.audio_path && <FindingAudio findingId={finding.id} />}
      {finding.image_path && (
        <FindingImage
          findingId={finding.id}
          fromIdx={
            finding.image_point_id
              ? (points.find((p) => p.point_id === finding.image_point_id)
                  ?.idx ?? null)
              : null
          }
        />
      )}
      {points.length > 0 && (
        <PointReel orderId={orderId} points={points} matchId={matchId} />
      )}
    </div>
  );
}

export function AttachmentRow({
  attachment,
}: {
  attachment: ReviewAttachmentRow;
}) {
  const [busy, setBusy] = useState(false);
  const mb = attachment.size_bytes / (1024 * 1024);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const url = await signedUrl({ attachmentId: attachment.id });
        setBusy(false);
        if (url) window.location.href = url;
      }}
      className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-surface-2"
    >
      <span className="truncate text-sm font-medium text-zinc-200">
        {attachment.filename}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-zinc-500">
        {busy ? "…" : mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.ceil(mb * 1024)} KB`}
      </span>
    </button>
  );
}

export function ReviewBody({
  orderId,
  sections,
  findings,
  findingPoints,
  attachments,
  matchId,
}: {
  orderId: string;
  sections: ReviewSectionContent[];
  findings: ReviewFindingRow[];
  findingPoints: Record<string, { point_id: string; idx: number }[]>;
  attachments: ReviewAttachmentRow[];
  matchId?: string | null;
}) {
  const filled = sections.filter((s) => s.body.trim());
  return (
    <div className="space-y-8">
      {filled.map((s) => (
        <section key={s.key}>
          <h2 className="text-lg font-semibold tracking-tight">{s.label}</h2>
          <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-zinc-300">
            {s.body}
          </p>
        </section>
      ))}

      {findings.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold tracking-tight">
            Watch these points
          </h2>
          <div className="mt-3 space-y-4">
            {findings.map((f) => (
              <FindingCard
                key={f.id}
                finding={f}
                points={findingPoints[f.id] ?? []}
                orderId={orderId}
                matchId={matchId}
              />
            ))}
          </div>
        </section>
      )}

      {attachments.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold tracking-tight">Attachments</h2>
          <div className="mt-3 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
            {attachments.map((a) => (
              <AttachmentRow key={a.id} attachment={a} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function FollowupThread({
  orderId,
  messages,
  viewerId,
  canAsk,
  askLabel,
  onSent,
}: {
  orderId: string;
  messages: ReviewMessageRow[];
  viewerId: string;
  canAsk: boolean;
  askLabel: string;
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const followups = messages.filter((m) => m.kind === "followup");

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    const res = await fetch("/api/reviews/transition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orderId,
        action: "followup",
        message: text.trim(),
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setText("");
      onSent();
    }
  }

  if (followups.length === 0 && !canAsk) return null;
  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight">Follow-up</h2>
      {followups.length > 0 && (
        <div className="mt-3 space-y-3">
          {followups.map((m) => (
            <div
              key={m.id}
              className={`rounded-2xl border border-edge bg-surface p-4 text-sm leading-relaxed ${
                m.author_id === viewerId
                  ? "border-l-2 border-l-cyan-glow/60"
                  : "border-l-2 border-l-amber-400/60"
              }`}
            >
              <p className="whitespace-pre-line text-zinc-300">{m.body}</p>
            </div>
          ))}
        </div>
      )}
      {canAsk && (
        <div className="mt-3 flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            placeholder={askLabel}
            className="min-w-0 flex-1 rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-cyan-glow/50"
          />
          <button
            type="button"
            onClick={send}
            disabled={busy || !text.trim()}
            className="shrink-0 rounded-full bg-cyan-glow px-5 py-2 text-sm font-semibold text-ink disabled:opacity-50"
          >
            Send
          </button>
        </div>
      )}
    </section>
  );
}

export function priceLine(cents: number): string {
  return formatUsd(cents);
}
