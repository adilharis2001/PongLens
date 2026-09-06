"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Point } from "@/lib/types";
import type { ClipPad } from "./playhead";
import {
  bounds,
  clampWindow,
  cutT0For,
  defaultWindow,
  moveHandle,
  playableAt,
  seamBetween,
  sourceToCut,
  type Window as InsertWindow,
} from "./insertGeometry";

/**
 * "Add a missing rally" — the card for a rally the cutter dropped.
 *
 * Its own modal rather than a fourth tab in ModifyClip, for one reason:
 * every other clip surface works in CUT seconds, because within one point's
 * span the cut keeps source duration intact and a single linear map covers
 * it. Across a seam that stops being true — the cutter removed footage, so
 * the cut jumps while the source runs on. This timeline is drawn on SOURCE
 * seconds, the only axis the whole neighbourhood shares, and maps into the
 * cut for playback. Bolting that into ModifyClip would have meant a second
 * coordinate system inside every one of its memos.
 *
 * The picture the timeline draws is the whole point: the rally before, the
 * hole, the rally after, and your new card on top of all three. Dragging a
 * handle left visibly takes footage from the previous rally, which is what
 * a badly cut match needs — the missing rally is often smeared across its
 * neighbours rather than sitting cleanly in a gap.
 */
export function InsertPoint({
  prev,
  next,
  videoUrl,
  pad,
  youLabel,
  themLabel,
  busy,
  onClose,
  onInsert,
}: {
  /** The card before the gap; null when adding before the first rally. */
  prev: Point | null;
  /** The card after the gap; null when adding after the last. */
  next: Point | null;
  videoUrl: string | null;
  pad: ClipPad;
  youLabel: string;
  themLabel: string;
  busy: boolean;
  onClose: () => void;
  /** Source seconds, the new card's place in the cut, and who won it —
   *  null for "not sure yet", which still fixes the rotation. */
  onInsert: (
    t0: number,
    t1: number,
    cutT0: number,
    winner: "user" | "opponent" | null
  ) => void;
}) {
  const seam = useMemo(() => seamBetween(prev, next, pad), [prev, next, pad]);
  const [win, setWin] = useState<InsertWindow>(() =>
    seam ? defaultWindow(seam) : { t0: 0, t1: 1 }
  );
  const [winner, setWinner] = useState<"user" | "opponent" | null>(null);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dragEdge = useRef<"start" | "end" | null>(null);
  const [playhead, setPlayhead] = useState<number>(() =>
    seam ? seam.gapFrom : 0
  );

  // Source seconds -> a percentage across the track.
  const pct = useCallback(
    (s: number) => {
      if (!seam) return 0;
      const span = seam.to - seam.from || 1;
      return Math.min(100, Math.max(0, ((s - seam.from) / span) * 100));
    },
    [seam]
  );

  const pointerToSource = useCallback(
    (clientX: number): number | null => {
      const el = trackRef.current;
      if (!el || !seam) return null;
      const rect = el.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return seam.from + frac * (seam.to - seam.from);
    },
    [seam]
  );

  /** Show this source second, if the cut video has it. */
  const seek = useCallback(
    (s: number) => {
      if (!seam) return;
      setPlayhead(s);
      const v = videoRef.current;
      if (v && v.readyState >= 1) v.currentTime = sourceToCut(seam, s);
    },
    [seam]
  );

  useEffect(() => {
    if (seam) seek(seam.gapFrom);
    // Only on open: afterwards the handles drive the playhead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onHandleDown = useCallback(
    (e: React.PointerEvent, edge: "start" | "end") => {
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // best-effort
      }
      dragEdge.current = edge;
    },
    []
  );
  const onHandleMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragEdge.current || !seam) return;
      const s = pointerToSource(e.clientX);
      if (s === null) return;
      setWin((w) => {
        const nextWin = moveHandle(seam, w, dragEdge.current!, s);
        return nextWin;
      });
      seek(s);
    },
    [seam, pointerToSource, seek]
  );
  const onHandleUp = useCallback((e: React.PointerEvent) => {
    dragEdge.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // best-effort
    }
  }, []);

  const nudge = useCallback(
    (edge: "start" | "end", by: number) => {
      if (!seam) return;
      setWin((w) => {
        const nextWin = moveHandle(
          seam,
          w,
          edge,
          (edge === "start" ? w.t0 : w.t1) + by
        );
        seek(edge === "start" ? nextWin.t0 : nextWin.t1);
        return nextWin;
      });
    },
    [seam, seek]
  );

  if (!seam) return null;

  const b = bounds(seam);
  const len = win.t1 - win.t0;
  const watching = playableAt(seam, playhead);
  // How much of the new card is footage this video does not have. Said out
  // loud rather than left as a mystery jump during playback.
  const missingInside = seam.continuous
    ? 0
    : Math.max(
        0,
        Math.min(win.t1, seam.gapTo) - Math.max(win.t0, seam.gapFrom)
      );

  const confirm = () => {
    if (busy) return;
    const w = clampWindow(seam, win);
    onInsert(w.t0, w.t1, cutT0For(seam, w, pad), winner);
  };

  const choices: { value: "user" | "opponent" | null; label: string }[] = [
    { value: "user", label: youLabel },
    { value: "opponent", label: themLabel },
    { value: null, label: "Not sure yet" },
  ];

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/80 p-3 backdrop-blur-sm">
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">
            Add a missing rally
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border border-edge px-3 py-1 text-sm text-zinc-300 transition-colors hover:text-white"
          >
            Cancel
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {videoUrl && (
            <div className="relative overflow-hidden rounded-xl bg-black">
              <video
                ref={videoRef}
                src={videoUrl}
                playsInline
                muted
                preload="metadata"
                className="block max-h-[38vh] w-full object-contain"
              />
              {!watching && (
                // The honest state. The cutter removed this stretch, so
                // there is no frame to show: saying so beats freezing on a
                // frame that looks like the wrong moment.
                <div className="absolute inset-0 flex items-center justify-center bg-ink/75 text-center">
                  <p className="px-4 text-xs text-zinc-300">
                    This part was cut from the video. You can still add the
                    rally here.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* The neighbourhood, in source seconds: the rally before, the
              hole, the rally after, and the new card over all three. */}
          <div
            ref={trackRef}
            onPointerDown={(e) => {
              const s = pointerToSource(e.clientX);
              if (s !== null) seek(s);
            }}
            className="relative mt-4 h-16 w-full touch-none select-none rounded-lg border border-edge bg-ink/50"
          >
            {seam.prev && (
              <div
                className="absolute top-2 h-4 rounded bg-zinc-700/70"
                style={{
                  left: `${pct(seam.prev.t0)}%`,
                  width: `${pct(seam.prev.t1) - pct(seam.prev.t0)}%`,
                }}
                aria-hidden="true"
              />
            )}
            {seam.next && (
              <div
                className="absolute top-2 h-4 rounded bg-zinc-700/70"
                style={{
                  left: `${pct(seam.next.t0)}%`,
                  width: `${pct(seam.next.t1) - pct(seam.next.t0)}%`,
                }}
                aria-hidden="true"
              />
            )}
            {!seam.continuous && (
              <div
                className="absolute top-2 h-4 rounded border border-amber-400/30"
                style={{
                  left: `${pct(seam.gapFrom)}%`,
                  width: `${pct(seam.gapTo) - pct(seam.gapFrom)}%`,
                  // Hatching says "there is time here, but no picture" in a
                  // way a plain empty bar cannot.
                  backgroundImage:
                    "repeating-linear-gradient(45deg, rgba(251,191,36,0.20) 0 4px, transparent 4px 8px)",
                }}
                aria-hidden="true"
              />
            )}

            {/* the new card */}
            <div
              className="absolute bottom-2 top-8 rounded bg-cyan-glow/25 ring-1 ring-cyan-glow/70"
              style={{
                left: `${pct(win.t0)}%`,
                width: `${Math.max(0.5, pct(win.t1) - pct(win.t0))}%`,
              }}
              aria-hidden="true"
            />
            {(["start", "end"] as const).map((edge) => (
              <button
                key={edge}
                type="button"
                onPointerDown={(e) => onHandleDown(e, edge)}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleUp}
                aria-label={
                  edge === "start"
                    ? "Drag where the rally starts"
                    : "Drag where the rally ends"
                }
                className="absolute bottom-0 top-6 w-6 -translate-x-1/2 cursor-ew-resize touch-none"
                style={{ left: `${pct(edge === "start" ? win.t0 : win.t1)}%` }}
              >
                <span className="mx-auto block h-full w-1.5 rounded-full bg-cyan-glow" />
              </button>
            ))}
            {/* playhead */}
            <div
              className="pointer-events-none absolute bottom-0 top-0 w-px bg-white/70"
              style={{ left: `${pct(playhead)}%` }}
              aria-hidden="true"
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
            <span className="tabular-nums">
              {len.toFixed(1)}s rally
              {missingInside > 0.25
                ? ` · ${missingInside.toFixed(0)}s not in this video`
                : ""}
            </span>
            <span className="flex items-center gap-1">
              {(["start", "end"] as const).map((edge) => (
                <span key={edge} className="flex items-center gap-1">
                  <span className="text-zinc-600">
                    {edge === "start" ? "Start" : "End"}
                  </span>
                  <button
                    type="button"
                    onClick={() => nudge(edge, -0.5)}
                    aria-label={`Move the ${edge} back half a second`}
                    className="rounded border border-edge px-1.5 text-zinc-300"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => nudge(edge, 0.5)}
                    aria-label={`Move the ${edge} on half a second`}
                    className="rounded border border-edge px-1.5 text-zinc-300"
                  >
                    +
                  </button>
                </span>
              ))}
            </span>
          </div>

          <p className="mt-3 text-xs text-zinc-500">
            Drag the handles over the rally that is missing. Reaching into a
            neighbouring rally takes that footage from it.
          </p>

          <h3 className="mt-4 text-sm font-semibold text-zinc-200">
            Who won it?
          </h3>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {choices.map((c) => (
              <button
                key={String(c.value)}
                type="button"
                aria-pressed={winner === c.value}
                onClick={() => setWinner(c.value)}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                  winner === c.value
                    ? c.value === "user"
                      ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                      : c.value === "opponent"
                        ? "border-magenta-glow/60 bg-magenta-glow/15 text-magenta-soft"
                        : "border-zinc-500 bg-ink/60 text-zinc-200"
                    : "border-edge bg-ink/40 text-zinc-400 hover:border-zinc-500"
                }`}
              >
                <span className="block truncate">{c.label}</span>
              </button>
            ))}
          </div>
          {/* Skip is deliberately not offered: a skipped card does not
              advance the rotation, so it would hand back a card that fixes
              nothing. "Not sure yet" leaves it unscored, which still fixes
              the rotation, and Keep score asks when you reach it. */}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-edge px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-edge px-4 py-2 text-sm text-zinc-300"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy || len < 0.5 || win.t0 < b.lo - 0.01}
            className="rounded-full border border-cyan-glow/60 bg-cyan-glow/15 px-4 py-2 text-sm font-semibold text-cyan-glow disabled:opacity-40"
          >
            {busy ? "Adding…" : "Add card"}
          </button>
        </div>
      </div>
    </div>
  );
}
