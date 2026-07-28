"use client";

import { useState } from "react";

export interface FocusPoint {
  id: string;
  label: string;
  retired_at: string | null;
  created_at: string;
}

/** What happened to an "add cue" attempt — the card and the lesson
 *  takeaway buttons both report it the same way. */
export type AddCueResult = "added" | "dup" | "full";

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * The pinned "Working on" card: the 3-5 cues a player is actively fixing
 * — the list every paper table-tennis journal keeps on its first page.
 * Ticking a cue retires it (kept, not deleted): the retired set is the
 * History — the quiet record of what became habit — with a way back for
 * anything that crept in again. State lives in NotesFeed so lesson
 * takeaways can file cues here too.
 */
export function WorkingOn({
  cues,
  onAdd,
  onRetire,
  onRestore,
}: {
  /** every cue, active and retired, oldest first */
  cues: FocusPoint[];
  onAdd: (label: string) => Promise<AddCueResult>;
  onRetire: (id: string) => void;
  onRestore: (id: string) => Promise<AddCueResult>;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const active = cues.filter((c) => !c.retired_at);
  const retired = cues
    .filter((c) => c.retired_at)
    .sort((a, b) => (b.retired_at ?? "").localeCompare(a.retired_at ?? ""));

  const add = async () => {
    const label = draft.trim().slice(0, 120);
    if (!label) return;
    setDraft("");
    setAdding(false);
    await onAdd(label);
  };

  const historyToggle = retired.length > 0 && (
    <button
      type="button"
      onClick={() => setShowHistory((v) => !v)}
      className="text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-300"
    >
      {showHistory ? "Hide history" : `History (${retired.length})`}
    </button>
  );

  const historyList = showHistory && (
    <ul className="mt-2 space-y-1.5">
      {retired.map((c) => (
        <li key={c.id} className="flex items-start gap-2.5">
          <svg
            viewBox="0 0 24 24"
            className="mt-0.5 h-4 w-4 shrink-0 text-cyan-glow/50"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
          </svg>
          <span className="min-w-0 flex-1 text-sm leading-snug text-zinc-500">
            {c.label}
            <span className="ml-1.5 text-[11px] text-zinc-600">
              {c.retired_at ? shortDate(c.retired_at) : ""}
            </span>
          </span>
          <button
            type="button"
            onClick={() => void onRestore(c.id)}
            className="shrink-0 text-[11px] font-medium text-zinc-600 transition-colors hover:text-cyan-glow"
          >
            Restore
          </button>
        </li>
      ))}
    </ul>
  );

  if (active.length === 0 && !adding) {
    return (
      <div className="mb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300"
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
          {historyToggle}
        </div>
        {historyList}
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl border border-cyan-glow/25 bg-surface p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-glow/80">
          Working on
        </p>
        {!adding && active.length < 5 && (
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
        {active.map((p) => (
          <li key={p.id} className="group flex items-start gap-2.5">
            <button
              type="button"
              onClick={() => onRetire(p.id)}
              aria-label={`Done: ${p.label}`}
              title="Got it — retire this cue"
              className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-zinc-600 text-zinc-600 transition-colors hover:border-cyan-glow/60 hover:text-cyan-glow"
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
      {retired.length > 0 && <div className="mt-2.5">{historyToggle}</div>}
      {historyList}
    </div>
  );
}
