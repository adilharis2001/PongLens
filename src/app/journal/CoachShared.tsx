"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Entries a coach shared with this player. Live documents: the RPC reads
 * the coach's current row, so an edit over there shows here on the next
 * load. Read-only by design — the words belong to the coach.
 */

interface Takeaways {
  title?: string | null;
  themes?: { name: string; points: string[] }[] | null;
}

interface SharedEntry {
  entry_id: string;
  coach_id: string;
  coach_name: string;
  transcript: string;
  takeaways: Takeaways | null;
  entry_kind: string;
  match_id: string | null;
  shared_at: string;
  updated_at: string;
}

function entryTitle(entry: SharedEntry): string {
  const title = entry.takeaways?.title?.trim();
  if (title) return title;
  const words = entry.transcript.replace(/\s+/g, " ").trim();
  return words.length > 72 ? `${words.slice(0, 72)}…` : words;
}

function day(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

export function CoachShared() {
  const [entries, setEntries] = useState<SharedEntry[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void supabase.rpc("coach_shared_entries").then(({ data }) => {
      setEntries((data as SharedEntry[]) ?? []);
    });
  }, []);

  if (entries.length === 0) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        From your coach
      </h3>
      <div className="mt-3 space-y-3">
        {entries.map((entry) => {
          const expanded = open === entry.entry_id;
          const themes = entry.takeaways?.themes ?? [];
          return (
            <div
              key={entry.entry_id}
              className="rounded-2xl border border-edge bg-surface p-4"
            >
              <button
                type="button"
                className="flex w-full items-baseline justify-between gap-3 text-left"
                onClick={() => setOpen(expanded ? null : entry.entry_id)}
              >
                <span className="min-w-0">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-cyan-glow">
                    {entry.coach_name}
                  </span>
                  <span className="mt-1 block text-sm font-medium text-zinc-100">
                    {entryTitle(entry)}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-zinc-500">
                  {day(entry.shared_at)}
                </span>
              </button>
              {expanded && (
                <div className="mt-3 space-y-4">
                  {themes.length > 0 ? (
                    <>
                      {themes.map((theme) => (
                        <div key={theme.name}>
                          <p className="text-xs font-semibold uppercase tracking-wider text-cyan-glow">
                            {theme.name}
                          </p>
                          <ul className="mt-2 space-y-1.5">
                            {theme.points.map((point) => (
                              <li key={point} className="flex gap-2 text-sm text-zinc-200">
                                <span className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
                                <span className="leading-relaxed">{point}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                      <details className="text-sm text-zinc-400">
                        <summary className="cursor-pointer select-none">
                          Transcript
                        </summary>
                        <p className="mt-2 whitespace-pre-wrap leading-relaxed text-zinc-300">
                          {entry.transcript}
                        </p>
                      </details>
                    </>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                      {entry.transcript}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
