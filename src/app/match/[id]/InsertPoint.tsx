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
 * IT PLAYS THE RAW UPLOAD, not the cut. The cut video by definition does not
 * contain the missing rally, so the first version of this screen could only
 * grey the gap out and say "this part was cut" — which told the owner the
 * footage was gone when it is not. The original upload is still stored (it
 * is the storage they pay for) and /api/media-url already streams it inline
 * for exactly this reason. Against the raw there is no hole at all: the
 * whole neighbourhood is watchable, the timeline is one continuous piece of
 * real footage, and the rally being restored can simply be played.
 *
 * THE RAW RUNS ON A DIFFERENT CLOCK. A trimmed upload is cut down before the
 * pipeline sees it, so every t0/t1 in points is measured from trim_start_s
 * into the raw file — 236.6s on the match this was built against. The route
 * returns that offset; adding it is what makes the footage the right footage.
 *
 * The cut video remains the fallback for matches whose raw has expired
 * (~18% today, none of them recent), and only there does the hatched "not in
 * this video" band appear.
 */
export function InsertPoint({
  matchId,
  prev,
  next,
  prevNumber,
  nextNumber,
  videoUrl,
  pad,
  youLabel,
  themLabel,
  busy,
  onClose,
  onInsert,
}: {
  matchId: string;
  /** The card before the gap; null when adding before the first rally. */
  prev: Point | null;
  /** The card after the gap; null when adding after the last. */
  next: Point | null;
  /** Their numbers in the strip, so this screen reads as the strip does. */
  prevNumber: number | null;
  nextNumber: number | null;
  /** The cut video — the fallback when the raw is gone. */
  videoUrl: string | null;
  pad: ClipPad;
  youLabel: string;
  themLabel: string;
  busy: boolean;
  onClose: () => void;
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

  // Which file is on screen. "raw" is the good case and the default attempt;
  // "cut" is the fallback and the only one with an unwatchable stretch.
  const [source, setSource] = useState<{
    kind: "raw" | "cut";
    url: string;
    /** seconds to ADD to a point timestamp to reach this file's clock */
    offset: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dragEdge = useRef<"start" | "end" | null>(null);
  const [playhead, setPlayhead] = useState<number>(() =>
    seam ? seam.gapFrom : 0
  );
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/media-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId, rawPreview: true }),
        });
        const data = (await res.json()) as {
          url?: string;
          available?: boolean;
          trimStartS?: number;
        };
        if (!alive) return;
        if (data.available && data.url) {
          setSource({
            kind: "raw",
            url: data.url,
            offset: Number(data.trimStartS ?? 0) || 0,
          });
        } else if (videoUrl) {
          setSource({ kind: "cut", url: videoUrl, offset: 0 });
        }
      } catch {
        if (alive && videoUrl) {
          setSource({ kind: "cut", url: videoUrl, offset: 0 });
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [matchId, videoUrl]);

  /** A point timestamp, in the seconds of whichever file is loaded. */
  const videoTimeFor = useCallback(
    (s: number) => {
      if (!source || !seam) return 0;
      return source.kind === "raw" ? s + source.offset : sourceToCut(seam, s);
    },
    [source, seam]
  );
  /** Against the raw, everything is watchable. Only the cut has holes. */
  const canWatch = useCallback(
    (s: number) =>
      !seam ? false : source?.kind === "raw" ? true : playableAt(seam, s),
    [seam, source]
  );

  const seek = useCallback(
    (s: number) => {
      setPlayhead(s);
      const v = videoRef.current;
      if (v && v.readyState >= 1) v.currentTime = videoTimeFor(s);
    },
    [videoTimeFor]
  );

  // Land on the start of the missing rally once the file is known.
  useEffect(() => {
    if (source && seam) seek(win.t0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

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
      const r = el.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      return seam.from + frac * (seam.to - seam.from);
    },
    [seam]
  );

  const onHandleDown = useCallback(
    (e: React.PointerEvent, edge: "start" | "end") => {
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // best-effort
      }
      videoRef.current?.pause();
      dragEdge.current = edge;
    },
    []
  );
  const onHandleMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragEdge.current || !seam) return;
      const s = pointerToSource(e.clientX);
      if (s === null) return;
      setWin((w) => moveHandle(seam, w, dragEdge.current!, s));
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

  /** Play the rally being restored, and stop at its end. */
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!v.paused) {
      v.pause();
      return;
    }
    if (playhead < win.t0 - 0.05 || playhead > win.t1 - 0.05) seek(win.t0);
    void v.play().catch(() => undefined);
  }, [playhead, win.t0, win.t1, seek]);

  const onTime = useCallback(() => {
    const v = videoRef.current;
    if (!v || !source) return;
    const s =
      source.kind === "raw"
        ? v.currentTime - source.offset
        : playhead; // the cut's map is piecewise; the handles drive it
    if (source.kind === "raw") setPlayhead(s);
    if (!v.paused && s >= win.t1) {
      v.pause();
      seek(win.t1);
    }
  }, [source, playhead, win.t1, seek]);

  if (!seam) return null;

  const b = bounds(seam);
  const len = win.t1 - win.t0;
  const watching = canWatch(playhead);
  const missingInside =
    source?.kind === "raw" || seam.continuous
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
    { value: null, label: "Not sure yet" },
    { value: "user", label: youLabel },
    { value: "opponent", label: themLabel },
  ];

  /** A neighbour drawn as the chip it is in the strip. */
  const neighbourChip = (p: Point | null, n: number | null) => {
    if (!p || n === null) return <span className="w-8 shrink-0" />;
    const tone =
      p.confirmed_winner === "user"
        ? "border-cyan-glow/60 bg-cyan-glow/20 text-cyan-glow"
        : p.confirmed_winner === "opponent"
          ? "border-magenta-glow/60 bg-magenta-glow/20 text-magenta-soft"
          : "border-dashed border-zinc-600 text-zinc-500";
    return (
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums ${tone}`}
      >
        {n}
      </span>
    );
  };

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
            className="rounded-full border border-edge px-3 py-1 text-sm text-zinc-300 transition-colors hover:text-white"
          >
            Cancel
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="relative overflow-hidden rounded-xl bg-black">
            {source && (
              <video
                ref={videoRef}
                src={source.url}
                playsInline
                muted
                preload="metadata"
                onTimeUpdate={onTime}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                className="block max-h-[38vh] w-full object-contain"
              />
            )}
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-xs text-zinc-400">Loading the footage…</p>
              </div>
            )}
            {!loading && !watching && (
              // Only reachable on the cut fallback: this match's original
              // upload is gone, so these seconds exist nowhere we can read.
              <div className="absolute inset-0 flex items-center justify-center bg-ink/75 text-center">
                <p className="px-4 text-xs text-zinc-300">
                  The original video for this match has expired, so this
                  stretch can&apos;t be shown. You can still add the rally.
                </p>
              </div>
            )}
          </div>

          {/* What is being done, in the language of the strip you came from:
              a new card going in between two you already have. */}
          <div className="mt-4 flex items-center justify-center gap-3">
            {neighbourChip(prev, prevNumber)}
            <span className="flex items-center gap-2 rounded-full border border-dashed border-cyan-glow/60 bg-cyan-glow/10 px-3 py-1.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-cyan-glow/70 text-[11px] font-semibold text-cyan-glow">
                +
              </span>
              <span className="text-xs font-medium text-cyan-glow">
                New card
              </span>
            </span>
            {neighbourChip(next, nextNumber)}
          </div>

          <div className="mt-1 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              disabled={!source}
              className="mt-2 rounded-full border border-edge bg-ink/40 px-3 py-1 text-xs font-medium text-zinc-200 disabled:opacity-40"
            >
              {playing ? "Pause" : "Play this rally"}
            </button>
          </div>

          {/* The scrubber is the tool, not the headline: it adjusts where the
              new card starts and ends. */}
          <div
            ref={trackRef}
            onPointerDown={(e) => {
              const s = pointerToSource(e.clientX);
              if (s !== null) seek(s);
            }}
            className="relative mt-3 h-12 w-full touch-none select-none rounded-lg border border-edge bg-ink/50"
          >
            {[seam.prev, seam.next].map((sp, i) =>
              sp ? (
                <div
                  key={i}
                  className="absolute top-2 h-3 rounded bg-zinc-700/70"
                  style={{
                    left: `${pct(sp.t0)}%`,
                    width: `${pct(sp.t1) - pct(sp.t0)}%`,
                  }}
                  aria-hidden="true"
                />
              ) : null
            )}
            {missingInside > 0.25 && (
              <div
                className="absolute top-2 h-3 rounded border border-amber-400/30"
                style={{
                  left: `${pct(seam.gapFrom)}%`,
                  width: `${pct(seam.gapTo) - pct(seam.gapFrom)}%`,
                  backgroundImage:
                    "repeating-linear-gradient(45deg, rgba(251,191,36,0.20) 0 4px, transparent 4px 8px)",
                }}
                aria-hidden="true"
              />
            )}
            <div
              className="absolute bottom-2 top-6 rounded bg-cyan-glow/25 ring-1 ring-cyan-glow/70"
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
                className="absolute bottom-0 top-5 w-7 -translate-x-1/2 cursor-ew-resize touch-none"
                style={{ left: `${pct(edge === "start" ? win.t0 : win.t1)}%` }}
              >
                <span className="mx-auto block h-full w-1.5 rounded-full bg-cyan-glow" />
              </button>
            ))}
            <div
              className="pointer-events-none absolute bottom-0 top-0 w-px bg-white/70"
              style={{ left: `${pct(playhead)}%` }}
              aria-hidden="true"
            />
          </div>

          <p className="mt-2 text-center text-xs text-zinc-500">
            {len.toFixed(1)}s
            {missingInside > 0.25
              ? ` · ${missingInside.toFixed(0)}s not available`
              : ""}
            {" · "}drag the handles to where the rally starts and ends
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
              advance the rotation, so it would fix nothing. */}
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
