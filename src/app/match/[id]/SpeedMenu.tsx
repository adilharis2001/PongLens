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
 * one. The list is ordered with the slowest rate nearest the pill, since
 * that is what the menu is for.
 *
 * `drop` is not cosmetic — it is the difference between a working control
 * and a dead one. The menu used to always open upward, which is right in
 * the pad's control row down the bottom of the screen and wrong in the
 * watch chrome, which sits at the very TOP: there the list opened past the
 * top of the viewport, so on a phone the speeds could not be seen or
 * reached at all. Hosts say which way they have room.
 */
export function SpeedMenu({
  value,
  onChange,
  onOpenChange,
  className,
  drop = "up",
  label,
  containerClassName,
}: {
  value: number;
  onChange: (v: number) => void;
  /** Lets the host hold its chrome open while the menu is showing. */
  onOpenChange?: (open: boolean) => void;
  /** Classes for the trigger pill, so each host keeps its own look. */
  className?: string;
  /** Which way the list opens. 'down' for a pill near the top of a screen. */
  drop?: "up" | "down";
  /** Tiny name under the value, for hosts whose whole row is labeled
   *  (the score pad's control row). The host's className lays it out. */
  label?: string;
  /** Classes for the wrapper (the actual flex item) — hosts whose rows
   *  distribute width need to size THIS, not the trigger inside it. */
  containerClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  const set = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  return (
    <div className={containerClassName ?? "relative shrink-0"}>
      <button
        type="button"
        onClick={() => set(!open)}
        aria-label="Playback speed"
        aria-haspopup="menu"
        aria-expanded={open}
        className={className}
      >
        {value}x
        {label && (
          <span className="text-[9px] font-medium leading-none">{label}</span>
        )}
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
            className={`ks-fade absolute right-0 z-50 overflow-hidden rounded-xl border border-edge bg-ink/95 shadow-lg shadow-black/60 backdrop-blur-md ${
              drop === "down" ? "top-full mt-2" : "bottom-full mb-2"
            }`}
          >
            {/* Slowest nearest the pill either way — which flips the order
                with the direction: ascending when the list hangs below,
                descending when it stacks above. */}
            {(drop === "down" ? [...SPEEDS] : [...SPEEDS].reverse()).map((s) => (
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
