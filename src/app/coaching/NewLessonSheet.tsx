"use client";

import Link from "next/link";

/**
 * The three ways a player records a lesson.
 *
 * Audio is missing on purpose: recording someone speaking for an hour is
 * a phone job, and a browser tab that has to stay open and awake for it
 * is a promise the web cannot keep. The iPhone offers all three; here the
 * chooser is honest about being two.
 *
 * Same dress as the Journal's New entry chooser, because it is the same
 * decision one tab over.
 */
export function NewLessonSheet({
  open,
  onClose,
  onWrite,
}: {
  open: boolean;
  onClose: () => void;
  onWrite: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
      />
      <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-edge bg-surface p-5 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-100">New lesson</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border border-edge p-1.5 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={() => {
              onClose();
              onWrite();
            }}
            className="flex w-full items-start gap-3 rounded-xl border border-edge bg-surface-2/40 p-4 text-left transition-colors hover:border-cyan-glow/40"
          >
            <PenGlyph />
            <span>
              <span className="block text-sm font-medium text-zinc-100">
                Write a lesson note
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-zinc-500">
                What you worked on and who with. Type it, speak it, or paste
                it.
              </span>
            </span>
          </button>

          <Link
            href="/coaching/import"
            onClick={onClose}
            className="flex w-full items-start gap-3 rounded-xl border border-edge bg-surface-2/40 p-4 text-left transition-colors hover:border-cyan-glow/40"
          >
            <FilmGlyph />
            <span>
              <span className="block text-sm font-medium text-zinc-100">
                Import a lesson video
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-zinc-500">
                Import a lesson you filmed. You get a short recap with
                chapters, ready to share.
              </span>
            </span>
          </Link>

          <p className="px-1 pt-1 text-xs leading-relaxed text-zinc-500">
            Recording a lesson as you take it is on the iPhone app.
          </p>
        </div>
      </div>
    </div>
  );
}

function PenGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="mt-0.5 h-5 w-5 shrink-0 text-cyan-glow"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"
      />
    </svg>
  );
}

function FilmGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="mt-0.5 h-5 w-5 shrink-0 text-cyan-glow"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m10 9.5 5 2.5-5 2.5v-5Z" />
    </svg>
  );
}
