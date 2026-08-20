"use client";

/**
 * The conversation on one bug, with its status trail running through it.
 *
 * Loaded when the row is expanded rather than with the table: eighteen
 * bugs' worth of messages is a page nobody reads, and the thread only
 * matters once someone has opened the thing it belongs to.
 *
 * Writing goes through post_bug_message rather than an insert, because
 * the RPC is what rings the other person's bell. A message nobody is told
 * about is the problem this whole feature exists to fix, so there is
 * deliberately no path that writes one.
 */

import { useCallback, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import type { Bug } from "@/lib/qa/bugs";
import {
  WHO_LABEL,
  inOrder,
  statusLine,
  whoWrote,
  type BugMessage,
} from "@/lib/qa/thread";

function stamp(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function BugThread({
  bug,
  viewerId,
}: {
  bug: Bug;
  viewerId: string;
}) {
  const [messages, setMessages] = useState<BugMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error: readError } = await supabase
      .from("qa_bug_messages")
      .select("*")
      .eq("bug_id", bug.id);
    if (readError) {
      setError("Could not load the conversation. Reload the page.");
      return;
    }
    setMessages(inOrder((data ?? []) as BugMessage[]));
  }, [bug.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("post_bug_message", {
      p_bug_id: bug.id,
      p_body: body,
    });
    if (rpcError) {
      // Naming the cause matters more here than anywhere else on this
      // page: the whole point of the box is that someone is waiting for
      // what you typed, so "it didn't send" has to be unmistakable.
      setError(
        rpcError.code === "42501"
          ? "Your session has expired. Reload the page and your text will still be here."
          : `Could not send that: ${rpcError.message}`,
      );
      setSending(false);
      return;
    }
    setDraft("");
    setSending(false);
    await load();
  }, [bug.id, draft, sending, load]);

  return (
    <div className="mt-1 flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Conversation
      </h3>

      {messages === null ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {messages.map((m) => {
            const who = whoWrote(m, viewerId, bug.reporter_id);
            if (m.kind === "status") {
              return (
                <li
                  key={m.id}
                  className="flex flex-wrap items-baseline gap-x-2 text-xs text-zinc-500"
                >
                  {/* A rule rather than a bubble: the trail is the spine of
                      the thread, and giving it the same weight as a comment
                      makes eight status changes shout over one sentence. */}
                  <span aria-hidden className="h-px w-4 bg-edge" />
                  <span className="text-zinc-400">{statusLine(m)}</span>
                  {who !== "system" && <span>by {WHO_LABEL[who]}</span>}
                  <span>{stamp(m.created_at)}</span>
                </li>
              );
            }
            const mine = who === "you";
            return (
              <li
                key={m.id}
                className={`rounded-xl border px-4 py-3 ${
                  mine
                    ? "border-cyan-glow/25 bg-cyan-glow/5"
                    : "border-edge bg-surface-2/40"
                }`}
              >
                <p className="mb-1 flex items-baseline gap-2 text-[11px] text-zinc-500">
                  <span className="font-semibold text-zinc-300">
                    {WHO_LABEL[who]}
                  </span>
                  <span>{stamp(m.created_at)}</span>
                </p>
                <p className="whitespace-pre-wrap leading-relaxed text-zinc-200">
                  {m.body}
                </p>
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Ask something, or say what you found."
          className="w-full resize-y rounded-xl border border-edge bg-ink/60 px-4 py-3 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-glow/60 focus:outline-none"
        />
        {error && <p className="text-sm text-amber-300/90">{error}</p>}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void send()}
            disabled={!draft.trim() || sending}
            className="rounded-full border border-edge px-4 py-1.5 text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-cyan-glow disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? "Sending…" : "Send"}
          </button>
          <span className="text-xs text-zinc-600">
            The other person gets a notification.
          </span>
        </div>
      </div>
    </div>
  );
}
