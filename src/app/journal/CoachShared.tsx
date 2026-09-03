"use client";

import { useState } from "react";
import { EntryImage } from "@/components/entryPhoto";
import { LinkedText } from "@/components/LinkedText";

/**
 * Entries a coach shared with this player. Live documents: the RPC reads
 * the coach's current row, so an edit over there shows here on the next
 * load. Read-only by design — the words belong to the coach. The journal
 * feed loads them (coach_shared_entries) and renders SharedEntryCard.
 */

interface Takeaways {
  title?: string | null;
  themes?: { name: string; points: string[] }[] | null;
}

export interface SharedEntry {
  entry_id: string;
  /** The coach's lesson row, which is what signs the photo (163). */
  lesson_id: string;
  coach_id: string;
  coach_name: string;
  transcript: string;
  takeaways: Takeaways | null;
  entry_kind: string;
  /** Pinned to the coach's own folder by the RPC; null when there is none. */
  image_path: string | null;
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

/**
 * One shared entry as a feed card. The journal renders these among its
 * own entries under All and under the From your coach tab (Adil,
 * 2026-09-02) — they used to sit in a section of their own above the
 * tabs, which read as a second journal.
 */
export function SharedEntryCard({ entry }: { entry: SharedEntry }) {
  const [expanded, setExpanded] = useState(false);
  const themes = entry.takeaways?.themes ?? [];
  return (
    <div className="rounded-2xl border border-edge bg-surface p-4">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="flex min-w-0 items-start gap-3">
          {entry.image_path && (
            <EntryImage
              lessonId={entry.lesson_id}
              className="h-11 w-11 shrink-0 rounded-lg border border-edge object-cover"
            />
          )}
          <span className="min-w-0">
            <span className="block text-xs font-semibold uppercase tracking-wider text-cyan-glow">
              {entry.coach_name}
            </span>
            <span className="mt-1 block text-sm font-medium text-zinc-100">
              {entryTitle(entry)}
            </span>
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
                        <span className="leading-relaxed">
                          <LinkedText text={point} />
                        </span>
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
                  <LinkedText text={entry.transcript} />
                </p>
              </details>
            </>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
              <LinkedText text={entry.transcript} />
            </p>
          )}
          {entry.image_path && <EntryImage lessonId={entry.lesson_id} />}
          <p className="text-xs text-zinc-500">
            Something wrong with this?{" "}
            <a
              className="underline underline-offset-2 hover:text-zinc-300"
              href={`mailto:support@ponglens.com?subject=${encodeURIComponent("Report a shared entry")}&body=${encodeURIComponent(`Entry ${entry.entry_id} from ${entry.coach_name}.\n\nWhat is wrong with it:\n`)}`}
            >
              Report it
            </a>
            . To stop hearing from this coach, remove them under
            Coaching.
          </p>
        </div>
      )}
    </div>
  );
}
