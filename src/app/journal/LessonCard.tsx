"use client";

import { useState } from "react";
import type { Lesson } from "@/lib/types";

function shortDateTime(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * One lesson in the Improve feed: the takeaways ARE the card — short
 * grouped reminders you can actually keep in your head. The raw
 * transcript stays one tap away, readable and copyable, because it often
 * needs to travel to other apps. No machinery on display anywhere.
 */
export function LessonCard({
  lesson,
  onUpdated,
}: {
  lesson: Lesson;
  /** Replaces the lesson after a retry resolves. */
  onUpdated: (lesson: Lesson) => void;
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const copyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(lesson.transcript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // selection stays possible in the expanded view
    }
  };

  const retry = async () => {
    setRetrying(true);
    try {
      const res = await fetch("/api/lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId: lesson.id }),
      });
      const data = res.ok ? await res.json() : null;
      onUpdated({
        ...lesson,
        takeaways: data?.takeaways ?? null,
        status: data?.status === "ready" ? "ready" : "failed",
      });
    } catch {
      onUpdated({ ...lesson, status: "failed" });
    } finally {
      setRetrying(false);
    }
  };

  const t = lesson.takeaways;

  return (
    <li className="rounded-2xl border border-edge bg-surface p-4">
      <p className="text-xs text-zinc-500">
        {lesson.kind === "practice" ? "Practice" : "Lesson"} ·{" "}
        {shortDateTime(lesson.created_at)}
      </p>

      {t ? (
        <>
          <p className="mt-1 text-sm font-semibold text-zinc-100">{t.title}</p>
          <div className="mt-3 space-y-3">
            {t.themes.map((theme) => (
              <div key={theme.name}>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-glow/80">
                  {theme.name}
                </p>
                <ul className="mt-1 space-y-1">
                  {theme.points.map((p) => (
                    <li
                      key={p}
                      className="flex gap-2 text-sm leading-relaxed text-zinc-200"
                    >
                      <span className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      ) : lesson.status === "failed" ? (
        <div className="mt-2 flex items-center gap-3">
          <p className="text-sm text-zinc-400">
            Couldn&apos;t pull the takeaways out of this one.
          </p>
          <button
            type="button"
            onClick={() => void retry()}
            disabled={retrying}
            className="shrink-0 rounded-full border border-edge px-3 py-1 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-50"
          >
            {retrying ? "Reading…" : "Try again"}
          </button>
        </div>
      ) : lesson.status === "queued" ? (
        <p className="mt-2 animate-pulse text-sm text-zinc-400">
          Reading the session…
        </p>
      ) : (
        // Short lesson: no takeaways needed, the text carries itself.
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
          {lesson.transcript}
        </p>
      )}

      {(t || lesson.status === "failed") && (
        <div className="mt-3 border-t border-edge/60 pt-2.5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowTranscript((v) => !v)}
              className="text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300"
            >
              {showTranscript ? "Hide transcript" : "Transcript"}
            </button>
            {showTranscript && (
              <button
                type="button"
                onClick={() => void copyTranscript()}
                className="text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            )}
          </div>
          {showTranscript && (
            <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">
              {lesson.transcript}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
