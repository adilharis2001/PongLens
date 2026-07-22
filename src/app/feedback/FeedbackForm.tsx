"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type MatchOption = {
  id: string;
  opponent_name: string | null;
  played_at: string;
};

function matchLabel(m: MatchOption) {
  const name = m.opponent_name?.trim() || "Match";
  const date = new Date(m.played_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${name} · ${date}`;
}

export function FeedbackForm({
  userId,
  initialMatchId,
}: {
  userId: string;
  initialMatchId: string | null;
}) {
  const [body, setBody] = useState("");
  const [matchId, setMatchId] = useState(initialMatchId ?? "");
  const [matches, setMatches] = useState<MatchOption[]>([]);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );

  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from("matches")
      .select("id, opponent_name, played_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setMatches(data as MatchOption[]);
      });
  }, [userId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    setState("sending");
    const supabase = createClient();
    const { error } = await supabase.from("feedback").insert({
      user_id: userId,
      match_id: matchId || null,
      body: trimmed,
    });
    if (error) {
      setState("error");
      return;
    }
    setState("sent");
  }

  if (state === "sent") {
    return (
      <div className="rounded-2xl border border-edge bg-surface p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/10">
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6 text-emerald-400"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4 10-10" />
          </svg>
        </span>
        <p className="mt-4 font-medium text-zinc-100">Thanks. We read every report.</p>
        <p className="mt-1 text-sm text-zinc-500">
          Feedback like this is how the pipeline gets better.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-full border border-edge bg-surface-2 px-5 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50"
          >
            Back home
          </Link>
          <button
            type="button"
            onClick={() => {
              setBody("");
              setState("idle");
            }}
            className="rounded-full px-5 py-2 text-sm font-medium text-zinc-400 transition-colors hover:text-white"
          >
            Send another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-edge bg-surface p-5 sm:p-6">
      <label htmlFor="feedback-body" className="text-sm font-medium text-zinc-300">
        What happened?
      </label>
      <textarea
        id="feedback-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        required
        placeholder="Tell us what went wrong or what you want to see."
        className="mt-2 w-full resize-y rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-glow/50 focus:outline-none"
      />

      {matches.length > 0 && (
        <div className="mt-4">
          <label htmlFor="feedback-match" className="text-sm font-medium text-zinc-300">
            About a match? <span className="font-normal text-zinc-500">(optional)</span>
          </label>
          <select
            id="feedback-match"
            value={matchId}
            onChange={(e) => setMatchId(e.target.value)}
            className="mt-2 w-full appearance-none rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm text-zinc-100 focus:border-cyan-glow/50 focus:outline-none"
          >
            <option value="">Not about a specific match</option>
            {matches.map((m) => (
              <option key={m.id} value={m.id}>
                {matchLabel(m)}
              </option>
            ))}
          </select>
        </div>
      )}

      {state === "error" && (
        <p className="mt-3 text-sm text-red-400">
          Could not send. Check your connection and try again.
        </p>
      )}

      <button
        type="submit"
        disabled={state === "sending" || !body.trim()}
        className="glow-cta mt-5 w-full rounded-full bg-cyan-glow px-6 py-3 text-sm font-semibold text-ink disabled:opacity-60 sm:w-auto"
      >
        {state === "sending" ? "Sending…" : "Send feedback"}
      </button>
    </form>
  );
}
