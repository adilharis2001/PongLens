"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Point } from "@/lib/types";
import { effectivePad } from "./clipEdit";
import { paddedEnd, type ClipPad } from "./playhead";

/**
 * The Modify modal — ALL clip surgery, shared by the Keep-score pad and the
 * point view so a boundary problem never requires switching surfaces. The
 * reviewer watches the whole (possibly wrong) point play out, THEN decides.
 *
 * Three paths, a segmented control at the top:
 *   SPLIT — cut this one point into 2 or 3. A scrubbable video of the clip
 *     span, N-1 draggable markers on the timeline (default even, dragged to
 *     the gap between rallies), and a Me / Them / Skip picker per resulting
 *     segment. Done maps each marker's CUT time to a SOURCE at_t (the exact
 *     inverse the split machinery uses) and hands the plan back to the host,
 *     which runs split_point sequentially + writes each segment's outcome.
 *   JOIN — merge this point with the next 1-2 into one. A stepper for how
 *     many to swallow, the combined span, and one Me / Them / Skip picker.
 *     Done hands the plan back; the host calls merge_points. Join can't be
 *     undone (the merged-away rows are gone), so it confirms.
 *   ADJUST — the point's start/end were cut wrong (short OR long): drag the
 *     two edge handles on the same timeline until the band covers the real
 *     point. Not "Trim" — clips get cut short as often as long, and both
 *     directions are the same drag. Done hands (t0, t1) back; the host
 *     saves and schedules the reclip.
 *
 * This owns its OWN <video> (the same cut-video URL the Player streams — the
 * browser serves both from range requests), so the host's playback state is
 * never disturbed while the reviewer hunts for the moment.
 */

type Disposition = "user" | "opponent" | "skip";
type Tab = "split" | "join" | "adjust";

/** Source-space guard: a split at_t must sit this far inside the point on
 *  both edges (matches split_point's window and PointDetail's guard). */
const EDGE_S = 0.3;
/** Minimum gap between adjacent markers, in seconds of cut video. */
const MIN_GAP_S = 0.4;

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface Geometry {
  spanStart: number;
  spanEnd: number;
  rallyStart: number;
  rallyEnd: number;
  markerLo: number;
  markerHi: number;
}

/** Cut-video geometry of a point's clip span (see playhead.ts anchoring). */
function geometryOf(p: Point, pad: ClipPad): Geometry | null {
  if (p.cut_t0 === null || p.t0 === null || p.t1 === null) return null;
  const eff = effectivePad(pad, p.tight_start, p.tight_end);
  const spanStart = Number(p.cut_t0);
  const rallyStart = spanStart + eff.pre;
  const rallyEnd = rallyStart + Math.max(0, Number(p.t1) - Number(p.t0));
  const spanEnd = paddedEnd(p, pad) ?? rallyEnd;
  return {
    spanStart,
    spanEnd,
    rallyStart,
    rallyEnd,
    // Valid marker band = the rally, held EDGE_S off each source edge (which
    // in cut space is rallyStart+EDGE .. rallyEnd-EDGE, since the cut keeps
    // source durations intact within the span).
    markerLo: rallyStart + EDGE_S,
    markerHi: rallyEnd - EDGE_S,
  };
}

export function ModifyClip({
  point,
  points,
  videoUrl,
  pad,
  youLabel,
  themLabel,
  busy,
  onClose,
  onSplit,
  onJoin,
  onAdjust,
  adjustLocked = false,
  initialCut = null,
  rotated = false,
}: {
  point: Point;
  points: Point[];
  videoUrl: string | null;
  pad: ClipPad;
  youLabel: string;
  themLabel: string;
  busy: boolean;
  onClose: () => void;
  onSplit: (cutTimes: number[], segments: Disposition[]) => void;
  onJoin: (count: number, winner: Disposition) => void;
  /** Save adjusted timing (source-video seconds). The host owns the write
   *  and the reclip; the modal closes on the host's signal (busy → close). */
  onAdjust: (t0New: number, t1New: number) => void;
  /** A reclip is already in flight for this point: timing edits on top of
   *  a clip that no longer matches t0/t1 would be editing blind. */
  adjustLocked?: boolean;
  /** Pre-place the 2-part split marker here (cut-video seconds) — used by
   *  the pad's "two points in there?" nudge, which suggests a cut but
   *  leaves the decision to this sheet. Clamped into the rally band. */
  initialCut?: number | null;
  /** The host takeover is the rotated iPhone fullscreen: the timeline runs
   *  down the PHYSICAL screen, so drags must read the pointer's y. */
  rotated?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("split");

  // ---- adjacency for JOIN: the next visible points after this one ----
  const nextPoints = useMemo(() => {
    const i = points.findIndex((p) => p.id === point.id);
    if (i < 0) return [];
    return points
      .slice(i + 1)
      .filter((p) => p.cut_t0 !== null && p.t0 !== null && p.t1 !== null)
      .slice(0, 2);
  }, [points, point.id]);
  const maxJoin = nextPoints.length; // 0, 1, or 2

  const geo = useMemo(() => geometryOf(point, pad), [point, pad]);
  const splittable =
    !!geo && geo.markerHi - geo.markerLo > MIN_GAP_S; // room for one interior cut

  // ------------------------------- SPLIT state -------------------------------
  const [parts, setParts] = useState(2); // 2 or 3
  const [markers, setMarkers] = useState<number[]>([]); // cut-video seconds
  // First segment starts on the point's existing answer (the nudge flow
  // opens this sheet right after one was given); the rest default "user".
  const [segs, setSegs] = useState<Disposition[]>(() => [
    point.confirmed_winner ?? "user",
    "opponent",
  ]);

  // (Re)default markers + segments whenever the part count or geometry
  // changes. A suggested cut (the nudge's guess) seeds the single 2-part
  // marker; 3 parts always defaults evenly.
  useEffect(() => {
    if (!geo) return;
    const n = parts;
    const lo = geo.markerLo;
    const hi = geo.markerHi;
    const next: number[] = [];
    for (let k = 1; k < n; k++) {
      next.push(Math.round((lo + ((hi - lo) * k) / n) * 100) / 100);
    }
    if (n === 2 && initialCut !== null && hi - lo > 0) {
      next[0] = Math.round(Math.min(hi, Math.max(lo, initialCut)) * 100) / 100;
    }
    setMarkers(next);
    setSegs((prev) => {
      const out: Disposition[] = [];
      for (let k = 0; k < n; k++) out.push(prev[k] ?? "user");
      return out;
    });
  }, [parts, geo, initialCut]);

  // ------------------------------- JOIN state --------------------------------
  const [joinCount, setJoinCount] = useState(1); // this + next joinCount
  const [joinWinner, setJoinWinner] = useState<Disposition>("user");
  // Join is destructive (the merged-away rows are hard-deleted, no undo), so
  // the CTA arms on the first tap and only fires on a confirming second tap.
  const [joinArmed, setJoinArmed] = useState(false);
  useEffect(() => {
    if (joinCount > maxJoin) setJoinCount(Math.max(1, maxJoin));
  }, [joinCount, maxJoin]);
  // Any change to what's being joined disarms the confirm.
  useEffect(() => setJoinArmed(false), [joinCount, joinWinner, tab]);

  // ------------------------------ ADJUST state -------------------------------
  // Draft t0/t1 on the SOURCE timeline. The cut keeps source durations
  // intact within the span, so one linear map covers the whole clip:
  //   cutOf(src) = rallyStart + (src - t0)
  const srcT0 = point.t0 === null ? null : Number(point.t0);
  const srcT1 = point.t1 === null ? null : Number(point.t1);
  const [adjT0, setAdjT0] = useState(srcT0 ?? 0);
  const [adjT1, setAdjT1] = useState(srcT1 ?? 0);
  const adjDirty =
    srcT0 !== null && srcT1 !== null && (adjT0 !== srcT0 || adjT1 !== srcT1);
  const cutOf = useCallback(
    (src: number) => (geo && srcT0 !== null ? geo.rallyStart + (src - srcT0) : 0),
    [geo, srcT0]
  );
  const srcOf = useCallback(
    (cut: number) => (geo && srcT0 !== null ? srcT0 + (cut - geo.rallyStart) : 0),
    [geo, srcT0]
  );
  // The clip's own footage, in cut seconds. Everything outside this is
  // real timeline the reclip can reach but this video cannot show.
  const adjLoCut = geo ? geo.spanStart : 0;
  const adjHiCut = geo ? geo.spanEnd : 0;
  // How far past the clip an edge may be DRAGGED.
  //
  // A clip cut long is a trim, and both handles open inside the picture
  // with room to move inwards. A clip cut SHORT is the other half of the
  // job and used to be impossible here: both handles opened sitting on the
  // clip's own edges with nowhere further to go. So the track runs past the
  // clip on both sides and that margin is real, draggable room.
  //
  // Fixed for a given point: it bounds the drag, and a bound that moved
  // under a finger would shift the coordinates of the drag it is bounding.
  const adjustReach = geo
    ? Math.min(8, Math.max(2.5, (geo.spanEnd - geo.spanStart) * 0.3))
    : 0;
  const dragLoCut = adjLoCut - adjustReach;
  const dragHiCut = adjHiCut + adjustReach;
  const beyondClip =
    cutOf(adjT0) < adjLoCut - 0.05 || cutOf(adjT1) > adjHiCut + 0.05;

  // The span the video covers: the point's clip for SPLIT, extended through
  // the last joined point for JOIN.
  const videoSpan = useMemo(() => {
    if (!geo) return null;
    if (tab === "join" && joinCount >= 1 && nextPoints.length >= joinCount) {
      const last = nextPoints[joinCount - 1];
      const end = paddedEnd(last, pad);
      if (end !== null) return { start: geo.spanStart, end };
    }
    return { start: geo.spanStart, end: geo.spanEnd };
  }, [geo, tab, joinCount, nextPoints, pad]);

  // The coordinate space of the scrub track. Split and Join measure the
  // footage they are about; Adjust measures the room it can reach, and
  // grows to follow a handle the step buttons have pushed past the drag
  // bounds so "−1s" ten times never walks it off the end of the track.
  const trackSpan = useMemo(() => {
    if (tab !== "adjust" || !geo || !videoSpan) return videoSpan;
    return {
      start: Math.min(dragLoCut, cutOf(adjT0) - 1),
      end: Math.max(dragHiCut, cutOf(adjT1) + 1),
    };
  }, [tab, geo, videoSpan, dragLoCut, dragHiCut, cutOf, adjT0, adjT1]);

  // --------------------------------- video ----------------------------------
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playheadT, setPlayheadT] = useState(0);
  const [paused, setPaused] = useState(true);

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    setPlayheadT(t);
    if (v && v.readyState >= 1) v.currentTime = t;
  }, []);

  // Seek to the span start whenever the covered span changes (open, tab flip,
  // join-count change).
  const spanStart = videoSpan?.start ?? 0;
  useEffect(() => {
    seek(spanStart);
  }, [spanStart, seek]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || !videoSpan) return;
    if (v.paused) {
      if (v.currentTime >= videoSpan.end - 0.05) v.currentTime = videoSpan.start;
      void v.play().catch(() => undefined);
    } else {
      v.pause();
    }
  }, [videoSpan]);

  const onTime = useCallback(
    (v: HTMLVideoElement) => {
      setPlayheadT(v.currentTime);
      if (videoSpan && !v.paused && v.currentTime >= videoSpan.end) {
        v.pause();
        v.currentTime = videoSpan.end;
        setPlayheadT(videoSpan.end);
      }
    },
    [videoSpan]
  );

  // ----------------------------- scrub timeline -----------------------------
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragIdx = useRef<number | null>(null);
  /** Which ADJUST edge a drag owns, when the adjust tab is active. */
  const dragEdge = useRef<"start" | "end" | null>(null);

  const pointerToTime = useCallback(
    (clientX: number, clientY: number): number | null => {
      const el = trackRef.current;
      if (!el || !trackSpan) return null;
      const rect = el.getBoundingClientRect();
      // Inside the rotated iPhone fullscreen the track's layout x runs
      // down the physical screen — the finger's y is the timeline axis.
      const frac = rotated
        ? Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
        : Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return trackSpan.start + frac * (trackSpan.end - trackSpan.start);
    },
    [trackSpan, rotated]
  );

  const timeToPct = useCallback(
    (t: number): number => {
      if (!trackSpan) return 0;
      const span = trackSpan.end - trackSpan.start || 1;
      return Math.min(100, Math.max(0, ((t - trackSpan.start) / span) * 100));
    },
    [trackSpan]
  );

  /** A cut time the video can actually show: inside the clip's own span. */
  const playable = useCallback(
    (t: number) => (videoSpan ? Math.min(videoSpan.end, Math.max(videoSpan.start, t)) : t),
    [videoSpan]
  );

  // Drag a split marker (SPLIT tab only), clamped inside the rally band and
  // kept MIN_GAP_S off its neighbours.
  const onMarkerDown = useCallback(
    (e: React.PointerEvent, idx: number) => {
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // best-effort
      }
      dragIdx.current = idx;
    },
    []
  );
  const onMarkerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragIdx.current === null || !geo) return;
      const idx = dragIdx.current;
      const t = pointerToTime(e.clientX, e.clientY);
      if (t === null) return;
      setMarkers((prev) => {
        const lo = idx > 0 ? prev[idx - 1] + MIN_GAP_S : geo.markerLo;
        const hi =
          idx < prev.length - 1 ? prev[idx + 1] - MIN_GAP_S : geo.markerHi;
        const clamped = Math.round(Math.min(hi, Math.max(lo, t)) * 100) / 100;
        const next = [...prev];
        next[idx] = clamped;
        return next;
      });
      seek(t);
    },
    [geo, pointerToTime, seek]
  );
  const onMarkerUp = useCallback((e: React.PointerEvent) => {
    dragIdx.current = null;
    dragEdge.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // best-effort
    }
  }, []);

  // Drag an ADJUST edge handle: clamped to the clip span and 0.5s clear of
  // the other edge; the video scrubs along so the frame under the handle is
  // the frame being chosen.
  const onEdgeDown = useCallback((e: React.PointerEvent, edge: "start" | "end") => {
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // best-effort
    }
    dragEdge.current = edge;
  }, []);
  const onEdgeMove = useCallback(
    (e: React.PointerEvent) => {
      const edge = dragEdge.current;
      if (!edge || !geo) return;
      const t = pointerToTime(e.clientX, e.clientY);
      if (t === null) return;
      const src = srcOf(t);
      if (edge === "start") {
        const clamped =
          Math.round(
            Math.min(adjT1 - 0.5, Math.max(Math.max(0, srcOf(dragLoCut)), src)) * 100
          ) / 100;
        setAdjT0(clamped);
        // The picture stops at the clip's own edge. Out in the margin there
        // is no frame to show — the cut video jumps to a different part of
        // the match there, and showing that as "the new start" would be a
        // lie the reviewer would act on.
        seek(playable(cutOf(clamped)));
      } else {
        const clamped =
          Math.round(
            Math.max(adjT0 + 0.5, Math.min(srcOf(dragHiCut), src)) * 100
          ) / 100;
        setAdjT1(clamped);
        seek(playable(cutOf(clamped)));
      }
    },
    [geo, pointerToTime, srcOf, cutOf, seek, playable, adjT0, adjT1, dragLoCut, dragHiCut]
  );

  // One second at a time, either direction, on either edge.
  //
  // These used to appear only once a handle had been dragged all the way
  // onto the clip's edge, which meant the one control for a clip cut short
  // was invisible until you had already found the problem by hand. They are
  // always here now. Outward there is no ceiling: the track grows to follow,
  // and the reclip is what brings the frames.
  const nudgeEdge = useCallback(
    (edge: "start" | "end", delta: number) => {
      if (edge === "start") {
        const next =
          Math.round(Math.min(adjT1 - 0.5, Math.max(0, adjT0 + delta)) * 100) / 100;
        setAdjT0(next);
        seek(playable(cutOf(next)));
      } else {
        const next = Math.round(Math.max(adjT0 + 0.5, adjT1 + delta) * 100) / 100;
        setAdjT1(next);
        seek(playable(cutOf(next)));
      }
    },
    [adjT0, adjT1, cutOf, seek, playable]
  );

  // Tap the track (not a marker) to scrub the video to that moment.
  const onTrackDown = useCallback(
    (e: React.PointerEvent) => {
      const t = pointerToTime(e.clientX, e.clientY);
      if (t !== null) seek(t);
    },
    [pointerToTime, seek]
  );

  const setSeg = useCallback((idx: number, v: Disposition) => {
    setSegs((prev) => {
      const next = [...prev];
      next[idx] = v;
      return next;
    });
  }, []);

  const doSplit = useCallback(() => {
    if (!geo || busy) return;
    onSplit([...markers], [...segs]);
  }, [geo, busy, markers, segs, onSplit]);

  const doJoin = useCallback(() => {
    if (maxJoin < 1 || busy) return;
    if (!joinArmed) {
      setJoinArmed(true);
      return;
    }
    onJoin(joinCount, joinWinner);
  }, [maxJoin, busy, joinArmed, joinCount, joinWinner, onJoin]);

  const label = (d: Disposition) =>
    d === "user" ? youLabel : d === "opponent" ? themLabel : "Skip";

  // ----------------------------------- UI -----------------------------------
  return (
    <div className="absolute inset-0 z-20 flex items-end justify-center bg-ink/70 backdrop-blur-sm sm:items-center">
      <div
        className="ks-fade flex w-full flex-col overflow-hidden rounded-t-2xl border border-edge bg-surface sm:max-w-lg sm:rounded-2xl"
        // 92% of the CONTAINER, not 92dvh: inside the iPhone fullscreen
        // mode the takeover is a rotated box whose visible height is the
        // phone's WIDTH — dvh still measures the portrait viewport there,
        // so the sheet overflowed the frame and the close ✕ sat off
        // screen. The container is always the takeover box, whichever way
        // it is turned. Inline, not max-h-[92%]: a stale dev stylesheet
        // drops utilities it has never seen (see the Tailwind memory).
        style={{ maxHeight: "92%" }}
      >
        {/* header: title + close (fixed) */}
        <div className="flex shrink-0 items-center justify-between border-b border-edge/60 px-4 py-3">
          <h2 className="text-base font-semibold">Modify point</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border border-edge bg-ink/40 p-1.5 text-zinc-400 transition-colors hover:text-white"
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

        {/* Everything between header and Done scrolls together — the video
            and Split/Join toggle scroll away so the pickers get full room. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
        {/* segmented: Split | Join | Adjust */}
        <div className="grid grid-cols-3 gap-1.5 p-3">
          <button
            type="button"
            onClick={() => setTab("split")}
            className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
              tab === "split"
                ? "border-cyan-glow/60 bg-cyan-glow/10"
                : "border-edge bg-ink/40 hover:border-cyan-glow/40"
            }`}
          >
            <span className="block text-sm font-semibold text-zinc-100">
              Split
            </span>
            <span className="block text-[11px] text-zinc-500">
              one point → 2-3
            </span>
          </button>
          <button
            type="button"
            onClick={() => maxJoin >= 1 && setTab("join")}
            disabled={maxJoin < 1}
            className={`rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-40 ${
              tab === "join"
                ? "border-cyan-glow/60 bg-cyan-glow/10"
                : "border-edge bg-ink/40 enabled:hover:border-cyan-glow/40"
            }`}
          >
            <span className="block text-sm font-semibold text-zinc-100">
              Join
            </span>
            <span className="block text-[11px] text-zinc-500">
              {maxJoin < 1 ? "no next point" : "merge with next"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => srcT0 !== null && setTab("adjust")}
            disabled={srcT0 === null}
            className={`rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-40 ${
              tab === "adjust"
                ? "border-cyan-glow/60 bg-cyan-glow/10"
                : "border-edge bg-ink/40 enabled:hover:border-cyan-glow/40"
            }`}
          >
            <span className="block text-sm font-semibold text-zinc-100">
              Adjust
            </span>
            <span className="block text-[11px] text-zinc-500">
              fix start / end
            </span>
          </button>
        </div>

        {/* video + scrub */}
        <div className="px-3">
          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                playsInline
                preload="auto"
                onLoadedMetadata={(e) => {
                  e.currentTarget.currentTime = spanStart;
                }}
                onTimeUpdate={(e) => onTime(e.currentTarget)}
                onPlay={() => setPaused(false)}
                onPause={() => setPaused(true)}
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-zinc-600">
                Loading…
              </div>
            )}
            {/* center play/pause */}
            <button
              type="button"
              onClick={togglePlay}
              aria-label={paused ? "Play" : "Pause"}
              className="absolute inset-0 flex items-center justify-center"
            >
              {paused && (
                <span className="rounded-full bg-ink/60 p-3 backdrop-blur-sm">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-7 w-7 text-white"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M8 5.5v13l11-6.5-11-6.5Z" />
                  </svg>
                </span>
              )}
            </button>
          </div>

          {/* scrub track: playhead + (split) draggable markers */}
          <div
            ref={trackRef}
            className="relative mt-3 h-10 cursor-pointer touch-none select-none"
            onPointerDown={onTrackDown}
          >
            {/* the bar */}
            <div
              className={`absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full ${
                tab === "adjust" ? "bg-white/8" : "bg-white/12"
              }`}
            >
              {/* On adjust the track reaches past the clip, so the stretch
                  the clip actually covers is drawn lighter — without it the
                  margins read as more of the same footage rather than as
                  somewhere the picture cannot go yet. */}
              {geo && tab === "adjust" && (
                <span
                  className="absolute inset-y-0 bg-white/16"
                  style={{
                    left: `${timeToPct(geo.spanStart)}%`,
                    width: `${Math.max(
                      0,
                      timeToPct(geo.spanEnd) - timeToPct(geo.spanStart)
                    )}%`,
                  }}
                />
              )}
              {/* rally region tint — on the adjust tab it tracks the draft
                  edges, so the band IS the preview of what the point keeps */}
              {geo && videoSpan && (
                <span
                  className={`absolute inset-y-0 ${
                    tab === "adjust" ? "bg-cyan-glow/45" : "bg-white/10"
                  }`}
                  style={{
                    left: `${timeToPct(
                      tab === "adjust" ? cutOf(adjT0) : geo.rallyStart
                    )}%`,
                    width: `${Math.max(
                      0,
                      timeToPct(tab === "adjust" ? cutOf(adjT1) : geo.rallyEnd) -
                        timeToPct(
                          tab === "adjust" ? cutOf(adjT0) : geo.rallyStart
                        )
                    )}%`,
                  }}
                />
              )}
              {/* Watched-so-far, on the tabs where the track is a timeline.
                  Adjust's track is a ruler, and a fill running to the
                  playhead there painted over the one distinction the tab
                  depends on: which stretch the clip holds. */}
              {tab !== "adjust" && (
                <span
                  className="absolute inset-y-0 left-0 bg-cyan-glow/70"
                  style={{ width: `${timeToPct(playheadT)}%` }}
                />
              )}
            </div>
            {/* where this clip's own footage begins and ends */}
            {tab === "adjust" &&
              geo &&
              [geo.spanStart, geo.spanEnd].map((edge) => (
                <span
                  key={edge}
                  className="pointer-events-none absolute top-1/2 h-4 w-px -translate-y-1/2 bg-white/45"
                  style={{ left: `${timeToPct(edge)}%` }}
                />
              ))}
            {/* playhead knob */}
            <span
              className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-glow shadow-[0_0_8px_rgba(34,211,238,0.7)]"
              style={{ left: `${timeToPct(playheadT)}%` }}
            />
            {/* adjust edge handles */}
            {tab === "adjust" &&
              geo &&
              (["start", "end"] as const).map((edge) => (
                <button
                  key={edge}
                  type="button"
                  aria-label={edge === "start" ? "Start of point" : "End of point"}
                  onPointerDown={(e) => onEdgeDown(e, edge)}
                  onPointerMove={onEdgeMove}
                  onPointerUp={onMarkerUp}
                  onPointerCancel={onMarkerUp}
                  className="absolute top-0 flex h-10 w-8 -translate-x-1/2 touch-none items-center justify-center"
                  style={{
                    left: `${timeToPct(cutOf(edge === "start" ? adjT0 : adjT1))}%`,
                  }}
                >
                  <span className="h-10 w-0.5 rounded-full bg-cyan-glow" />
                  <span className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-cyan-glow bg-ink shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
                </button>
              ))}
            {/* split markers */}
            {tab === "split" &&
              markers.map((m, idx) => (
                <button
                  key={idx}
                  type="button"
                  aria-label={`Split marker ${idx + 1}`}
                  onPointerDown={(e) => onMarkerDown(e, idx)}
                  onPointerMove={onMarkerMove}
                  onPointerUp={onMarkerUp}
                  onPointerCancel={onMarkerUp}
                  className="absolute top-0 flex h-10 w-8 -translate-x-1/2 touch-none items-center justify-center"
                  style={{ left: `${timeToPct(m)}%` }}
                >
                  <span className="h-10 w-0.5 rounded-full bg-magenta-glow" />
                  <span className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-magenta-glow bg-ink shadow-[0_0_8px_rgba(232,121,249,0.6)]" />
                </button>
              ))}
          </div>
        </div>

        {/* body: split, join OR adjust */}
        <div className="px-4 pb-2 pt-1">
          {tab === "adjust" ? (
            <>
              {(["start", "end"] as const).map((edge) => {
                const cur = edge === "start" ? adjT0 : adjT1;
                const orig = edge === "start" ? srcT0 : srcT1;
                const delta = orig === null ? 0 : cur - orig;
                return (
                  <div
                    key={edge}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <span className="w-10 text-sm capitalize text-zinc-300">
                      {edge}
                    </span>
                    <span
                      className={`text-xs tabular-nums ${
                        delta === 0 ? "text-zinc-500" : "text-cyan-glow"
                      }`}
                    >
                      {delta === 0
                        ? "unchanged"
                        : `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}s`}
                    </span>
                    <span className="flex items-center gap-2">
                      {[-1, 1].map((step) => (
                        <button
                          key={step}
                          type="button"
                          onClick={() => nudgeEdge(edge, step)}
                          disabled={adjustLocked}
                          className="rounded-full border border-edge bg-ink/40 px-3.5 py-1.5 text-xs font-semibold tabular-nums text-zinc-200 transition-colors hover:border-cyan-glow/40 disabled:opacity-40"
                        >
                          {step < 0 ? "−1s" : "+1s"}
                        </button>
                      ))}
                    </span>
                  </div>
                );
              })}

              <p className="py-1 text-center text-xs text-zinc-500">
                Point ≈ {fmt(Math.max(0, adjT1 - adjT0))} — drag the handles
                until the band covers the whole point.
              </p>
              <p className="py-1 text-center text-[11px] text-zinc-500">
                {beyondClip
                  ? "The band now runs past this clip's own footage. That part arrives when the clip updates."
                  : "The lighter stretch is what this clip holds. Drag or step an edge past it to take in more of the match."}
              </p>
              {adjustLocked && (
                <p className="py-1 text-center text-[11px] text-amber-300/80">
                  This clip is still updating from an earlier change — try
                  again in a moment.
                </p>
              )}
            </>
          ) : tab === "split" ? (
            <>
              {/* parts stepper */}
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-zinc-300">Into</span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setParts((n) => Math.max(2, n - 1))}
                    disabled={parts <= 2}
                    aria-label="Fewer points"
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-edge bg-ink/40 text-lg text-zinc-200 disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="w-16 text-center text-sm font-semibold tabular-nums text-zinc-100">
                    {parts} points
                  </span>
                  <button
                    type="button"
                    onClick={() => setParts((n) => Math.min(3, n + 1))}
                    disabled={parts >= 3}
                    aria-label="More points"
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-edge bg-ink/40 text-lg text-zinc-200 disabled:opacity-30"
                  >
                    +
                  </button>
                </div>
              </div>

              {!splittable && (
                <p className="py-2 text-center text-xs text-amber-300/80">
                  This point is too short to split.
                </p>
              )}

              {/* per-segment outcome pickers */}
              <div className="mt-1 space-y-2">
                {segs.map((d, idx) => {
                  const from =
                    idx === 0
                      ? geo
                        ? geo.rallyStart
                        : 0
                      : markers[idx - 1];
                  const to =
                    idx === markers.length
                      ? geo
                        ? geo.rallyEnd
                        : 0
                      : markers[idx];
                  return (
                    <div
                      key={idx}
                      className="rounded-xl border border-edge bg-ink/30 p-2.5"
                    >
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-xs font-medium text-zinc-400">
                          Part {idx + 1}
                        </span>
                        <span className="text-[10px] tabular-nums text-zinc-600">
                          {geo ? `${fmt(from - geo.spanStart)}–${fmt(to - geo.spanStart)}` : ""}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(["user", "opponent", "skip"] as const).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setSeg(idx, opt)}
                            className={`truncate rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors ${
                              d === opt
                                ? opt === "user"
                                  ? "border-cyan-glow bg-cyan-glow/20 text-cyan-glow"
                                  : opt === "opponent"
                                    ? "border-magenta-glow bg-magenta-glow/20 text-magenta-soft"
                                    : "border-amber-400/60 bg-amber-400/10 text-amber-300"
                                : "border-edge bg-ink/40 text-zinc-400 hover:border-zinc-500"
                            }`}
                          >
                            {label(opt)}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              {/* join stepper */}
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-zinc-300">Join with next</span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setJoinCount((n) => Math.max(1, n - 1))}
                    disabled={joinCount <= 1}
                    aria-label="Fewer points"
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-edge bg-ink/40 text-lg text-zinc-200 disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="w-20 text-center text-sm font-semibold tabular-nums text-zinc-100">
                    {joinCount} point{joinCount === 1 ? "" : "s"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setJoinCount((n) => Math.min(maxJoin, n + 1))}
                    disabled={joinCount >= maxJoin}
                    aria-label="More points"
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-edge bg-ink/40 text-lg text-zinc-200 disabled:opacity-30"
                  >
                    +
                  </button>
                </div>
              </div>

              <p className="py-1 text-center text-xs text-zinc-500">
                {geo && videoSpan
                  ? `Merged clip ≈ ${fmt(videoSpan.end - videoSpan.start)}`
                  : ""}
              </p>

              {/* one outcome picker for the merged point */}
              <div className="mt-2 rounded-xl border border-edge bg-ink/30 p-2.5">
                <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                  Who won the point?
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(["user", "opponent", "skip"] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setJoinWinner(opt)}
                      className={`truncate rounded-lg border px-2 py-2 text-sm font-semibold transition-colors ${
                        joinWinner === opt
                          ? opt === "user"
                            ? "border-cyan-glow bg-cyan-glow/20 text-cyan-glow"
                            : opt === "opponent"
                              ? "border-magenta-glow bg-magenta-glow/20 text-magenta-soft"
                              : "border-amber-400/60 bg-amber-400/10 text-amber-300"
                          : "border-edge bg-ink/40 text-zinc-400 hover:border-zinc-500"
                      }`}
                    >
                      {label(opt)}
                    </button>
                  ))}
                </div>
              </div>

              <p className="mt-2 text-center text-[11px] text-amber-300/70">
                {joinArmed
                  ? "Tap Confirm to join — this can't be undone."
                  : "Join can't be undone from here."}
              </p>
            </>
          )}
        </div>
        </div>

        {/* footer: Done (fixed) */}
        <div
          className="shrink-0 border-t border-edge/60 p-3"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          {tab === "adjust" ? (
            <button
              type="button"
              onClick={() => adjDirty && !busy && onAdjust(adjT0, adjT1)}
              disabled={!adjDirty || busy || adjustLocked}
              className="glow-cta w-full rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save timing"}
            </button>
          ) : tab === "split" ? (
            <button
              type="button"
              onClick={doSplit}
              disabled={!splittable || busy}
              className="glow-cta w-full rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink disabled:opacity-40"
            >
              {busy ? "Splitting…" : `Split into ${parts}`}
            </button>
          ) : (
            <button
              type="button"
              onClick={doJoin}
              disabled={maxJoin < 1 || busy}
              className={`w-full rounded-full px-6 py-2.5 text-sm font-semibold disabled:opacity-40 ${
                joinArmed
                  ? "border border-amber-400 bg-amber-400/15 text-amber-200"
                  : "glow-cta bg-cyan-glow text-ink"
              }`}
            >
              {busy
                ? "Joining…"
                : joinArmed
                  ? `Confirm — join ${joinCount + 1} points`
                  : `Join ${joinCount + 1} points`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
