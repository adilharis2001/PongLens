"use client";

import { useState } from "react";

import { AutoTextarea } from "@/components/AutoTextarea";
import type { ReviewMessageRow } from "@/lib/reviews/types";

/**
 * The order's chat: yours on the right, theirs on the left, a composer
 * that is always there while the order is being worked. Either side can
 * write any number of messages; the turn-taking lives in the status, not
 * in the interface.
 */
export function ChatThread({
  orderId,
  messages,
  viewerId,
  otherName,
  canWrite,
  waitingLine,
  onSent,
}: {
  orderId: string;
  messages: ReviewMessageRow[];
  viewerId: string;
  otherName: string;
  canWrite: boolean;
  /** Shown under the thread when writing is closed (order done). */
  waitingLine?: string | null;
  onSent: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function send() {
    if (!body.trim() || busy) return;
    setBusy(true);
    setNote(null);
    const res = await fetch("/api/reviews/transition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orderId,
        action: "message",
        message: body.trim(),
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setNote("Could not send it. Try again.");
      return;
    }
    setBody("");
    onSent();
  }

  return (
    <div>
      {messages.length > 0 && (
        <div className="space-y-2">
          {messages.map((m) => {
            const mine = m.author_id === viewerId;
            return (
              <div
                key={m.id}
                className={`flex ${mine ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    mine
                      ? "rounded-br-md bg-cyan-glow/10 text-zinc-100"
                      : "rounded-bl-md border border-edge bg-surface text-zinc-200"
                  }`}
                >
                  <p className="whitespace-pre-line">{m.body}</p>
                  <p
                    className={`mt-1 text-[10px] leading-none ${
                      mine ? "text-right text-zinc-500" : "text-zinc-500"
                    }`}
                  >
                    {mine ? "You" : otherName} ·{" "}
                    {new Date(m.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canWrite ? (
        <div className="mt-3 flex items-end gap-2">
          <div className="flex min-h-[44px] flex-1 items-center rounded-3xl border border-edge bg-surface px-4 py-2 transition-colors focus-within:border-cyan-glow/50">
            <AutoTextarea
              variant="composer"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={1}
              maxLength={2000}
              placeholder={`Write to ${otherName}`}
              className="bg-transparent text-sm text-zinc-200 outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !body.trim()}
            aria-label="Send"
            className="glow-cta flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cyan-glow text-ink disabled:opacity-40"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 19V5m0 0-6 6m6-6 6 6"
              />
            </svg>
          </button>
        </div>
      ) : (
        waitingLine && (
          <p className="mt-3 text-sm text-zinc-500">{waitingLine}</p>
        )
      )}
      {note && <p className="mt-2 text-xs text-amber-400">{note}</p>}
    </div>
  );
}
