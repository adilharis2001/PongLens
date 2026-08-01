"use client";

import Link from "next/link";

/**
 * "This map is wrong" — the other half of the beta pill.
 *
 * A badge sets expectations but collects nothing, and the usual fix for a
 * feature that can be wrong is a caveat, which costs words on every view
 * and still leaves the person stuck with the wrong map. This is the
 * override instead: one tap, from the map itself, and the map goes away.
 *
 * The tap IS the feedback — a boolean set while looking at a specific map
 * joins straight back to the placement rows that produced it, which is a
 * better signal than prose and costs the user nothing to give. The "Tell
 * us more" link is there for when they want to say why, and only appears
 * once they've already flagged it, so the unflagged state stays one quiet
 * control.
 */

function FlagIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 21V4.5m0 0c4-2 8 2 12 0V14c-4 2-8-2-12 0"
      />
    </svg>
  );
}

/** The quiet control that sits with a map that is currently shown. */
export function LooksWrongButton({
  onFlag,
  label,
  className,
}: {
  onFlag: () => void;
  /** What gets flagged, for screen readers only. */
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onFlag}
      aria-label={label}
      className={`group inline-flex items-center gap-1.5 rounded-full text-xs text-zinc-500 outline-none transition-colors hover:text-zinc-300 focus-visible:text-zinc-300 ${className ?? ""}`}
    >
      <FlagIcon className="h-3.5 w-3.5 shrink-0 text-zinc-600 transition-colors group-hover:text-amber-300/80" />
      Looks wrong
    </button>
  );
}

/** What stands in for the map once it's been flagged. */
export function MarkedWrongNotice({
  onUndo,
  matchId,
  className,
}: {
  onUndo: () => void;
  matchId: string;
  className?: string;
}) {
  const action =
    "underline decoration-zinc-600 underline-offset-2 transition-colors hover:text-white hover:decoration-cyan-glow/50";
  return (
    <p
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 ${className ?? ""}`}
    >
      <span className="inline-flex items-center gap-1.5 text-zinc-400">
        <FlagIcon className="h-3.5 w-3.5 shrink-0 text-amber-300/80" />
        Marked wrong
      </span>
      <button type="button" onClick={onUndo} className={action}>
        Undo
      </button>
      <Link href={`/feedback?matchId=${matchId}`} className={action}>
        Tell us more
      </Link>
    </p>
  );
}
