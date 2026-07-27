"use client";

import { useState } from "react";

/**
 * Playback rates, ascending. Slow motion is the point: at 0.25x you can see
 * which side of the bat the ball came off, and at 0.1x you can see the
 * contact itself. Browsers drop audio below ~0.25x; the video is unaffected.
 */
export const SPEEDS = [0.1, 0.25, 0.5, 1, 1.5, 2] as const;

/** Index of 1x — the rate every surface opens at. */
export const NORMAL_SPEED_IDX = SPEEDS.indexOf(1);

/**
 * The playback-rate pill and its menu.
 *
 * A menu rather than the old tap-to-cycle: with six rates, cycling means
 * five taps to get back to normal, and the one you want is never the next
 * one. The list opens upward (the pill lives at the bottom of the video
 * chrome and in the pad's control row) with the slowest rate nearest the
 * pill, since that is what the menu is for.
 */
export function SpeedMenu({
  value,
  onChange,
  onOpenChange,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  /** Lets the host hold its chrome open while the menu is showing. */
  onOpenChange?: (open: boolean) => void;
  /** Classes for the trigger pill, so each host keeps its own look. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const set = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => set(!open)}
        aria-label="Playback speed"
        aria-haspopup="menu"
        aria-expanded={open}
        className={className}
      >
        {value}x
      </button>
      {open && (
        <>
          {/* Tap-away catcher. Sits under the menu, over everything else. */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => set(false)}
            aria-hidden="true"
          />
          <div
            role="menu"
            aria-label="Playback speed"
            className="ks-fade absolute bottom-full right-0 z-50 mb-2 overflow-hidden rounded-xl border border-edge bg-ink/95 shadow-lg shadow-black/60 backdrop-blur-md"
          >
            {[...SPEEDS].reverse().map((s) => (
              <button
                key={s}
                type="button"
                role="menuitemradio"
                aria-checked={s === value}
                onClick={() => {
                  onChange(s);
                  set(false);
                }}
                className={`block w-full px-4 py-2 text-right text-xs font-semibold tabular-nums transition-colors ${
                  s === value
                    ? "bg-cyan-glow/15 text-cyan-glow"
                    : "text-zinc-300 hover:bg-surface-2 hover:text-white"
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
