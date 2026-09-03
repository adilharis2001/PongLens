"use client";

import { useState } from "react";
import type { Lesson, Tag } from "@/lib/types";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PointTags } from "@/app/match/[id]/Tags";
import { ShareEntrySheet } from "./ShareEntrySheet";
import { EntryImage } from "@/components/entryPhoto";
import { LinkedText } from "@/components/LinkedText";

import type { AddCueResult } from "./WorkingOn";

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
  tags,
  vocab,
  onToggleTag,
  onCreateTag,
  onAddCue,
  onUpdated,
  onDeleted,
  onEdit,
}: {
  lesson: Lesson;
  /** Tags on this entry (same vocabulary as point tags). */
  tags: Tag[];
  vocab: Tag[];
  onToggleTag: (tag: Tag) => void;
  onCreateTag: (label: string) => void;
  /** Files a takeaway into Working on; reports dup/full so we can say so. */
  onAddCue: (label: string) => Promise<AddCueResult>;
  /** Replaces the lesson after a retry resolves. */
  onUpdated: (lesson: Lesson) => void;
  /** Removes the lesson from the feed after a delete. */
  onDeleted: (id: string) => void;
  /** Opens the note editor on this entry. */
  onEdit: (lesson: Lesson) => void;
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  // Takeaways already filed into Working on this session, plus the quiet
  // one-line notice when the list is full.
  const [filed, setFiled] = useState<Set<string>>(new Set());
  const [cueNotice, setCueNotice] = useState<string | null>(null);

  const fileCue = async (point: string) => {
    if (filed.has(point)) return;
    const result = await onAddCue(point);
    if (result === "full" || result === "error") {
      setCueNotice(
        result === "full"
          ? "Working on is full — tick a cue off first."
          : "Couldn't save that. Try again."
      );
      setTimeout(() => setCueNotice(null), 3500);
      return;
    }
    setFiled((s) => new Set(s).add(point));
  };

  const deleteEntry = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/journal-entry", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: lesson.id }),
      });
      if (!res.ok) throw new Error("delete failed");
      setConfirmDel(false);
      onDeleted(lesson.id);
    } catch {
      setDeleteError("Couldn't delete this entry. Try again.");
    } finally {
      setDeleting(false);
    }
  };

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

  // The headline the share link is stored under, so the Account list can
  // tell shared entries apart: the takeaways title when there is one,
  // else the same kind-and-date line the card header shows.
  const shareTitle =
    t?.title ??
    `${
      lesson.kind === "practice"
        ? "Practice"
        : lesson.coach_name
          ? `Lesson with ${lesson.coach_name}`
          : "Lesson"
    } · ${shortDateTime(lesson.created_at)}`;

  return (
    <li
      id={`journal-entry-${lesson.id}`}
      className="scroll-mt-24 rounded-2xl border border-edge bg-surface p-4"
    >
      <p className="text-xs text-zinc-500">
        {lesson.kind === "practice" ? "Practice" : "Lesson"}
        {lesson.coach_name ? (
          <>
            {" with "}
            <span className="text-zinc-300">{lesson.coach_name}</span>
          </>
        ) : null}
        {" · "}
        {shortDateTime(lesson.created_at)}
      </p>

      {t ? (
        <>
          <p className="mt-1 text-sm font-semibold text-zinc-100">{t.title}</p>
          <div className="mt-3 space-y-3">
            {t.themes.map((theme) => (
              <div key={theme.name}>
                <p className="text-xs font-semibold uppercase tracking-wider text-cyan-glow/80">
                  {theme.name}
                </p>
                <ul className="mt-1 space-y-1">
                  {theme.points.map((p) => (
                    <li
                      key={p}
                      className="flex gap-2 text-sm leading-relaxed text-zinc-200"
                    >
                      <span className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
                      <span className="min-w-0 flex-1">
                        <LinkedText text={p} />
                      </span>
                      <button
                        type="button"
                        onClick={() => void fileCue(p)}
                        aria-label={
                          filed.has(p)
                            ? "On the Working on list"
                            : "Add to Working on"
                        }
                        title={
                          filed.has(p)
                            ? "On the Working on list"
                            : "Add to Working on"
                        }
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors ${
                          filed.has(p)
                            ? "text-cyan-glow"
                            : "text-zinc-700 hover:bg-surface-2 hover:text-cyan-glow"
                        }`}
                      >
                        {filed.has(p) ? (
                          <svg
                            viewBox="0 0 24 24"
                            className="h-3.5 w-3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m5 13 4 4L19 7"
                            />
                          </svg>
                        ) : (
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
                        )}
                      </button>
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
          <LinkedText text={lesson.transcript} />
        </p>
      )}

      {lesson.image_path && <EntryImage lessonId={lesson.id} />}

      {cueNotice && (
        <p className="mt-2 text-xs text-amber-300/90">{cueNotice}</p>
      )}

      {/* Same tag row as a point's — one vocabulary across the app. */}
      <div className="mt-3">
        <PointTags
          pointLabel={lesson.kind === "practice" ? "Practice entry" : "Lesson"}
          tags={tags}
          vocab={vocab}
          onToggle={onToggleTag}
          onCreate={onCreateTag}
        />
      </div>

      <div className="mt-3 border-t border-edge/60 pt-2.5">
          <div className="flex items-center gap-3">
            {(t || lesson.status === "failed") && (
            <button
              type="button"
              onClick={() => setShowTranscript((v) => !v)}
              className="text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200"
            >
              {showTranscript ? "Hide transcript" : "Transcript"}
            </button>
            )}
            {showTranscript && (
              <button
                type="button"
                onClick={() => void copyTranscript()}
                className="text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            )}
            {/* Same idiom as a match note's footer: Edit beside Delete,
                the whole row in the card's quiet text-button register.
                Not offered while the entry is still being read: the
                takeaways land on the row when that finishes, and an edit
                saved in the meantime would be overwritten by them. */}
            {lesson.status !== "queued" && (
              <button
                type="button"
                onClick={() => onEdit(lesson)}
                className="text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200"
              >
                Edit
              </button>
            )}
            <span className="ml-auto flex items-center gap-3">
              {/* Share sits beside Delete: a public read-only link to
                  this entry, minted in the sheet it opens. Hidden while
                  queued for the same reason Edit is — the entry is not
                  its final self yet. */}
              {lesson.status !== "queued" && (
                <button
                  type="button"
                  onClick={() => setShareOpen(true)}
                  className="text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200"
                >
                  Share
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setDeleteError(null);
                  setConfirmDel(true);
                }}
                className="text-sm font-medium text-zinc-400 transition-colors hover:text-red-400"
              >
                Delete
              </button>
            </span>
          </div>
          {showTranscript && (
            <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">
              <LinkedText text={lesson.transcript} />
            </p>
          )}
        </div>

      <ShareEntrySheet
        open={shareOpen}
        lessonId={lesson.id}
        title={shareTitle}
        onClose={() => setShareOpen(false)}
      />

      <ConfirmDialog
        open={confirmDel}
        title="Delete this entry?"
        confirmLabel="Delete"
        busy={deleting}
        error={deleteError}
        onCancel={() => setConfirmDel(false)}
        onConfirm={() => void deleteEntry()}
      />
    </li>
  );
}
