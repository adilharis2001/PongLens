"use client";

import { useState } from "react";

/**
 * The gestures cheat sheet: a "?" pill in the player chrome opening a
 * small static card. This is the always-available replay path for the
 * one-time hints (gestureHints.ts) — hidden controls stay learnable
 * without any hint ever repeating.
 */

const ROWS: {
  gesture: string;
  watch: string;
  score: string;
  /** Needs points locatable in the stitched video (cut_t0); dropped where
   *  they aren't. */
  needsPoints?: boolean;
}[] = [
  { gesture: "Tap", watch: "Pause or resume", score: "Show the controls" },
  {
    gesture: "Double tap right",
    watch: "Next point",
    score: "Next point",
    needsPoints: true,
  },
  {
    gesture: "Double tap left",
    watch: "Back a point",
    score: "Back a point",
    needsPoints: true,
  },
  {
    gesture: "Hold the right side",
    watch: "2x while you hold",
    score: "2x while you hold",
  },
  {
    gesture: "Hold the left side",
    watch: "0.25x while you hold",
    score: "0.25x while you hold",
  },
  { gesture: "Pinch", watch: "", score: "Zoom; one finger pans" },
];

export function GesturesButton({
  mode,
  hasPoints = true,
  className,
}: {
  mode: "watch" | "score";
  /** False when the match's points have no cut_t0: the point-jump gestures
   *  do nothing there, so the sheet doesn't claim them. */
  hasPoints?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="Gestures"
        onClick={() => setOpen(true)}
        className={
          className ??
          "shrink-0 rounded-full border border-edge bg-ink/60 px-2.5 py-1 text-[11px] font-semibold text-zinc-400 transition-colors hover:text-white"
        }
      >
        ?
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/80 p-6 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-edge bg-surface p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-zinc-100">Gestures</h3>
            <ul className="mt-3 space-y-2.5">
              {ROWS.filter(
                (r) => r[mode] && (hasPoints || !r.needsPoints)
              ).map((r) => (
                <li
                  key={r.gesture}
                  className="flex items-baseline justify-between gap-4 text-sm"
                >
                  <span className="text-zinc-200">{r.gesture}</span>
                  <span className="text-right text-[13px] text-zinc-500">
                    {r[mode]}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex items-center justify-between border-t border-edge/60 pt-4">
              <a
                href="/learn/match-viewer"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-cyan-glow transition-colors hover:text-white"
              >
                More in the guide
              </a>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:text-white"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
