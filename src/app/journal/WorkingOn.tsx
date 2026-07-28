"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface FocusPoint {
  id: string;
  label: string;
  retired_at: string | null;
}

/**
 * The pinned "Working on" card: the 3-5 cues a player is actively fixing
 * — the list every paper table-tennis journal keeps on its first page.
 * Ticking a cue retires it (kept, not deleted: the retired set is the
 * record of what became habit). Hidden entirely until the first cue.
 */
export function WorkingOn({ userId }: { userId: string }) {
  const [points, setPoints] = useState<FocusPoint[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from("focus_points")
      .select("id, label, retired_at")
      .is("retired_at", null)
      .order("created_at", { ascending: true })
      .then(({ data }) => setPoints((data as FocusPoint[]) ?? []));
  }, []);

  const add = useCallback(async () => {
    const label = draft.trim().slice(0, 120);
    if (!label) return;
    setDraft("");
    setAdding(false);
    const supabase = createClient();
    const { data } = await supabase
      .from("focus_points")
      .insert({ user_id: userId, label })
      .select("id, label, retired_at")
      .single();
    if (data) setPoints((ps) => [...(ps ?? []), data as FocusPoint]);
  }, [draft, userId]);

  const retire = useCallback(async (id: string) => {
    setPoints((ps) => (ps ?? []).filter((p) => p.id !== id));
    const supabase = createClient();
    await supabase
      .from("focus_points")
      .update({ retired_at: new Date().toISOString() })
      .eq("id", id);
  }, []);

  if (points === null) return null;
  if (points.length === 0 && !adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path strokeLinecap="round" d="M12 5v14M5 12h14" />
        </svg>
        Working on
      </button>
    );
  }

  return (
    <div className="mb-4 rounded-2xl border border-cyan-glow/25 bg-surface p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-glow/80">
          Working on
        </p>
        {!adding && points.length < 5 && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            aria-label="Add a cue"
            className="rounded-full p-1 text-zinc-500 transition-colors hover:text-zinc-300"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path strokeLinecap="round" d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>
      <ul className="mt-2 space-y-1.5">
        {points.map((p) => (
          <li key={p.id} className="group flex items-start gap-2.5">
            <button
              type="button"
              onClick={() => void retire(p.id)}
              aria-label={`Done: ${p.label}`}
              title="Got it — retire this cue"
              className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-edge text-transparent transition-colors hover:border-cyan-glow/60 hover:text-cyan-glow"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
              </svg>
            </button>
            <span className="text-sm leading-snug text-zinc-200">
              {p.label}
            </span>
          </li>
        ))}
      </ul>
      {adding && (
        <input
          type="text"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
            if (e.key === "Escape") setAdding(false);
          }}
          onBlur={() => (draft.trim() ? void add() : setAdding(false))}
          placeholder="One cue, e.g. racket up between strokes"
          maxLength={120}
          className="mt-2 w-full rounded-lg border border-edge bg-surface-2/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
        />
      )}
    </div>
  );
}
