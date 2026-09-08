"use client";

/**
 * Playback speed as a rail you grab, not a menu you open.
 *
 * A menu costs two deliberate acts — open it, find the row, hit it — and
 * during a marking pass the speed is something you want to lean on and let
 * go of. Here the whole strip is the control: press anywhere and the rate
 * jumps there, keep holding and it follows your finger, let go and it
 * stays. The same gesture with a mouse, a finger or a stylus, because it
 * is all one pointer.
 *
 * The stops are the app's own six rates (SpeedMenu.tsx), evenly spaced
 * rather than laid out by value. Spacing them by value would give 0.1x to
 * 1x nine tenths of the rail and squeeze 1x, 1.5x and 2x into the last
 * sliver, which is backwards: the fast end is where a pass through a match
 * actually lives.
 */

import { useCallback, useRef } from "react";

import { SPEEDS as RATES } from "./SpeedMenu";

/** A plain number list: SPEEDS is a readonly tuple of literals, which makes
 *  indexOf and length comparisons unusable here. */
const SPEEDS: number[] = [...RATES];

/** Nearest stop to a rate, so a value set elsewhere still lands on the rail. */
function stopFor(rate: number): number {
  let best = 0;
  for (let i = 1; i < SPEEDS.length; i++) {
    if (Math.abs(SPEEDS[i] - rate) < Math.abs(SPEEDS[best] - rate)) best = i;
  }
  return best;
}

export function SpeedRail({
  value,
  onChange,
  compact = false,
  className,
}: {
  value: number;
  onChange: (rate: number) => void;
  /** The landscape band: shorter, no end labels, same gesture. */
  compact?: boolean;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const i = stopFor(value);
  const pct = (SPEEDS.length === 1 ? 0 : i / (SPEEDS.length - 1)) * 100;

  const setFromX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0) return;
      // The visual track is inset in compact mode; map against the same
      // box the knob is drawn in, or a press at the left edge reads as
      // beyond the first stop.
      const inset = compact ? 12 : 0;
      const usable = Math.max(1, r.width - inset * 2);
      const f = Math.min(1, Math.max(0, (clientX - r.left - inset) / usable));
      const next = SPEEDS[Math.round(f * (SPEEDS.length - 1))];
      if (next !== value) onChange(next);
    },
    [onChange, value, compact]
  );

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="Playback speed"
      aria-valuemin={SPEEDS[0]}
      aria-valuemax={SPEEDS[SPEEDS.length - 1]}
      aria-valuenow={value}
      aria-valuetext={`${value}x`}
      // touch-none so a drag along the rail is never stolen by the page's
      // own scroll, which is what makes it feel like a control rather than
      // a thing you fight.
      className={`relative w-full shrink-0 cursor-pointer touch-none select-none ${
        compact
          ? // Over the picture the bare track disappeared against bright
            // footage, so it gets the same translucent bed the other
            // landscape bands sit on.
            "h-9 rounded-xl bg-ink/55 px-3 backdrop-blur-sm"
          : "h-11"
      } ${className ?? ""}`}
      onPointerDown={(e) => {
        e.preventDefault();
        dragging.current = true;
        // The jump happens FIRST and the capture is best effort. Capturing
        // a pointer the browser does not recognise throws, and with the
        // order the other way round that exception swallowed the tap, so
        // pressing the rail set nothing until you also moved.
        setFromX(e.clientX);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // No capture: the drag still tracks while the pointer is over
          // the rail, which is where it is.
        }
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        setFromX(e.clientX);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          onChange(SPEEDS[Math.max(0, i - 1)]);
        } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          onChange(SPEEDS[Math.min(SPEEDS.length - 1, i + 1)]);
        }
      }}
    >
      {/* the bar, with the travelled part filled */}
      <div
        className={`absolute top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/15 ${
          compact ? "inset-x-3" : "inset-x-0"
        }`}
      >
        <span
          className="absolute inset-y-0 left-0 bg-cyan-glow/60"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* a tick per stop, so the detents are visible before you feel them */}
      {SPEEDS.map((sp, n) => (
        <span
          key={sp}
          aria-hidden="true"
          className={`pointer-events-none absolute top-1/2 h-2 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
            n <= i ? "bg-cyan-glow/70" : "bg-white/25"
          }`}
          style={{
            left: `calc(${compact ? "12px + " : ""}${
              (n / (SPEEDS.length - 1)) * 100
            }% ${compact ? "- 24px * " + n / (SPEEDS.length - 1) : ""})`,
          }}
        />
      ))}

      {/* the knob says the rate, so the rail needs no separate readout */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full border-2 border-cyan-glow bg-ink font-semibold tabular-nums text-cyan-glow shadow-[0_0_10px_rgba(34,211,238,0.55)] ${
          compact ? "h-6 text-[10px]" : "h-7 text-[11px]"
        }`}
        style={{
          left: `calc(${compact ? "12px + " : ""}${pct}% ${
            compact ? "- 24px * " + pct / 100 : ""
          })`,
          // Kept inside the rail at both ends rather than hanging off it:
          // a knob half off the track reads as broken at 0.1x and 2x.
          transform: `translate(-${pct}%, -50%)`,
          minWidth: compact ? 34 : 40,
          paddingLeft: 6,
          paddingRight: 6,
        }}
      >
        {value}x
      </span>
    </div>
  );
}
