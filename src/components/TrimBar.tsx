"use client";

/**
 * The trimmer: one track for the whole video, the kept window lit between
 * two draggable handles. Dragging a handle scrubs the player to that
 * moment, so the eye confirms what the hand is doing. Grabbing the track
 * jumps the nearer handle there — big targets, phone-first.
 *
 * Shared on purpose. It started on the match page and now also runs in the
 * upload card while the file is still going up, and the two must not drift:
 * a handle that behaves differently in the two places is worse than no
 * handle at all, because the second one teaches the wrong lesson.
 */

import { useRef, type PointerEvent as ReactPointerEvent } from "react";

import { formatClock } from "@/lib/commerce/minutes";

/** Shortest window we will cut to. Below this there is no match left. */
export const MIN_TRIM_S = 5;

export function TrimBar({
  duration,
  start,
  end,
  onChange,
  onScrub,
}: {
  duration: number;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  onScrub: (t: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<"start" | "end" | null>(null);

  const toSeconds = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(f * duration * 10) / 10;
  };

  const move = (which: "start" | "end", t: number) => {
    if (which === "start") {
      const s = Math.min(t, end - MIN_TRIM_S);
      onChange(Math.max(0, s), end);
      onScrub(Math.max(0, s));
    } else {
      const e = Math.max(t, start + MIN_TRIM_S);
      onChange(start, Math.min(duration, e));
      onScrub(Math.min(duration, e));
    }
  };

  const beginDrag =
    (which: "start" | "end") => (ev: ReactPointerEvent<HTMLDivElement>) => {
      ev.preventDefault();
      draggingRef.current = which;
      try {
        ev.currentTarget.setPointerCapture(ev.pointerId);
      } catch {
        // A missed capture only means the drag ends at the element edge.
      }
      move(which, toSeconds(ev.clientX));
    };
  const onDrag = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    move(draggingRef.current, toSeconds(ev.clientX));
  };
  const endDrag = () => {
    draggingRef.current = null;
  };

  const leftPct = (start / duration) * 100;
  const rightPct = (end / duration) * 100;
  const handle =
    "absolute -inset-y-1 z-10 flex w-7 cursor-ew-resize touch-none " +
    "items-center justify-center";
  const knob =
    "h-full w-[18px] rounded-md bg-cyan-glow shadow-[0_0_12px_rgba(34,211,238,0.35)] " +
    "flex items-center justify-center";

  return (
    <div className="select-none">
      <div
        ref={trackRef}
        onPointerDown={(ev) => {
          // Grabbing bare track: the nearer handle comes to the finger.
          const t = toSeconds(ev.clientX);
          const which =
            Math.abs(t - start) <= Math.abs(t - end) ? "start" : "end";
          beginDrag(which)(ev);
        }}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative h-12 touch-none rounded-xl border border-edge bg-ink/60"
      >
        {/* The kept window */}
        <div
          className="absolute inset-y-0 rounded-lg border-y-2 border-cyan-glow/50 bg-cyan-glow/10"
          style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
        />
        <div
          role="slider"
          aria-label="Trim start"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={start}
          onPointerDown={beginDrag("start")}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={handle}
          style={{ left: `calc(${leftPct}% - 14px)` }}
        >
          <div className={knob}>
            <div className="h-4 w-0.5 rounded-full bg-zinc-950/50" />
          </div>
        </div>
        <div
          role="slider"
          aria-label="Trim end"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={end}
          onPointerDown={beginDrag("end")}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={handle}
          style={{ left: `calc(${rightPct}% - 14px)` }}
        >
          <div className={knob}>
            <div className="h-4 w-0.5 rounded-full bg-zinc-950/50" />
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-baseline justify-between text-xs tabular-nums">
        <span className="text-zinc-400">{formatClock(start)}</span>
        <span className="text-cyan-200/90">{formatClock(end - start)} kept</span>
        <span className="text-zinc-400">{formatClock(end)}</span>
      </div>
    </div>
  );
}
