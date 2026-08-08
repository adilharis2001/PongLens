"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SpeedMenu } from "./SpeedMenu";

/** Pinch zoom ceiling. */
const MAX_ZOOM = 4;
// Zoom persists across point navigation (module-scoped): if the user
// zoomed, the camera was too far for the WHOLE recording — every clip
// benefits. The 1x pill or snap-back are the only resets.
const persistedZoom = { scale: 1, tx: 0, ty: 0 };
// Speed persists the same way — slow motion chosen for one rally is a
// choice about the footage, not the clip. Same rates as the match player.
let persistedSpeed = 1;

/** Released below this scale → snap back to exactly 1. */
const SNAP_ZOOM = 1.05;
/** Pointer travel (px) beyond which a press stops counting as a tap. */
const TAP_SLOP = 8;
/** Press-and-hold rates, same as the match player: left half slows,
 *  right half speeds up, release restores. Armed during playback at any
 *  zoom — a STILL press is unambiguous even zoomed in; the moment the
 *  finger travels, the hold cancels and the drag is a pan again. */
const HOLD_MS = 250;
const HOLD_SLOW = 0.25;
const HOLD_FAST = 2;

/**
 * Minimal player for point clips in the detail view. No native controls —
 * clips are seconds long, so the iOS chrome (±10s skips, big play button)
 * is pure noise. Autoplays on open and on prev/next navigation, plays the
 * rally twice, then rests on the first frame. Tap to play/pause; thin
 * tap-to-seek progress bar; small speaker toggle when muted autoplay was
 * needed; speed + zoom buttons bottom-right (the match player's transport
 * pair — both choices persist across clips). Timing fixes live in the
 * Modify modal, not here.
 *
 * Pinch to zoom (1x–4x, anchored at the pinch midpoint) with one-finger
 * pan while zoomed — for judging edge balls on far camera angles. The
 * transform lives on the <video> only; the overlays (mute, progress, play
 * glyph, 1x pill) are unscaled siblings. Zoom survives play/pause and
 * scrubbing but resets when the clip (point) changes.
 */
export function ClipPlayer({
  src,
  videoElRef,
  mode = "clip",
  onTime,
  onMediaError,
  onReplay,
  tall = false,
}: {
  src: string;
  /** Exposes the <video> element so the point view can capture the
   *  on-screen frame for annotation (Player.captureFrame rationale). */
  videoElRef?: React.MutableRefObject<HTMLVideoElement | null>;
  /** "clip" (default): autoplays and plays the rally twice — the point
   *  detail behavior. "cut": a full match video — starts paused, plays
   *  straight through, never restarts itself. Gestures are identical. */
  mode?: "clip" | "cut";
  /** Every timeupdate, for point tracking in the cut view. */
  onTime?: (el: HTMLVideoElement) => void;
  /** The media failed after the CORS retry — the owner may hold an
   *  expired signed URL and want to mint a fresh one. */
  onMediaError?: () => void;
  /** Restart whatever the owner considers "this point". Only the caller
   *  knows where a point begins in cut mode, so the button is theirs to
   *  wire; it sits in the transport cluster so the spacing stays right. */
  onReplay?: () => void;
  /** Lift the desktop height cap. Width alone does not make a 16:9 picture
   *  bigger: past 52vh the box just grows black bars either side, so a
   *  full-width layout has to raise the ceiling too. */
  tall?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(false);
  // Readable pixels for annotation; a CORS regression retries once
  // without crossOrigin so the clip always plays (drawing degrades).
  const [corsOff, setCorsOff] = useState(false);
  const [progress, setProgress] = useState(0);
  const [zoomed, setZoomed] = useState(persistedZoom.scale > 1);
  const [zoomScale, setZoomScale] = useState(persistedZoom.scale);
  const playsRef = useRef(0);
  // Muting is only ever a fallback to satisfy autoplay policy; the first
  // user gesture that starts playback lifts it.
  const autoMuted = useRef(false);

  // ---- zoom/pan gesture state -------------------------------------------
  // The transform is applied imperatively (element.style) during gestures
  // so pointermove never waits on a React render. `zoomed` is the only
  // piece React needs (1x pill, touch-action, sheet-swipe exclusion).
  const tRef = useRef({ ...persistedZoom });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    downX: number;
    downY: number;
    moved: boolean;
    pinched: boolean;
    /** a press-and-hold rate fired during this press */
    held: boolean;
    /** pan anchor: last position of the single active pointer */
    lastX: number;
    lastY: number;
    /** pinch anchors, captured when the second finger lands */
    startDist: number;
    startScale: number;
    startTx: number;
    startTy: number;
    startMidX: number;
    startMidY: number;
  } | null>(null);

  const applyTransform = useCallback((animate: boolean) => {
    const v = videoRef.current;
    if (!v) return;
    const { scale, tx, ty } = tRef.current;
    persistedZoom.scale = scale;
    persistedZoom.tx = tx;
    persistedZoom.ty = ty;
    v.style.transition = animate ? "transform 180ms ease" : "";
    v.style.transform =
      scale === 1 && tx === 0 && ty === 0
        ? ""
        : `translate(${tx}px, ${ty}px) scale(${scale})`;
    setZoomed(scale > 1);
    setZoomScale(scale);
  }, []);

  /** Keep the (scaled) frame covering the viewport — no gaps at the edges. */
  const clampPan = () => {
    const v = videoRef.current;
    if (!v) return;
    const t = tRef.current;
    const mx = ((t.scale - 1) * v.offsetWidth) / 2;
    const my = ((t.scale - 1) * v.offsetHeight) / 2;
    t.tx = Math.min(mx, Math.max(-mx, t.tx));
    t.ty = Math.min(my, Math.max(-my, t.ty));
  };

  const resetZoom = useCallback(
    (animate: boolean) => {
      tRef.current = { scale: 1, tx: 0, ty: 0 };
      applyTransform(animate);
    },
    [applyTransform]
  );

  // Button zoom (same ×1.5 steps as the match player's transport): pinch
  // is invisible, and on desktop there is nothing to pinch with. Scales
  // about the frame center, so the pan offset scales along.
  const zoomBy = useCallback(
    (f: number) => {
      const t = tRef.current;
      const s = Math.min(MAX_ZOOM, Math.max(1, t.scale * f));
      const k = s / t.scale;
      t.scale = s;
      t.tx *= k;
      t.ty *= k;
      if (s <= SNAP_ZOOM) {
        t.scale = 1;
        t.tx = 0;
        t.ty = 0;
      }
      clampPan();
      applyTransform(true);
    },
    [applyTransform]
  );

  // Playback rate: applied on mount (persisted choice) and on change.
  const [speed, setSpeedState] = useState(persistedSpeed);
  const setSpeed = useCallback((v: number) => {
    persistedSpeed = v;
    setSpeedState(v);
    const el = videoRef.current;
    if (el) el.playbackRate = v;
  }, []);

  // Press-and-hold rate (match-player parity). holdRate drives the pill;
  // the timer arms on a still, single-finger press during 1x playback.
  const [holdRate, setHoldRate] = useState<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endHold = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    const v = videoRef.current;
    if (v) v.playbackRate = persistedSpeed;
    setHoldRate(null);
  }, []);

  useEffect(() => {
    playsRef.current = 0;
    setProgress(0);
    // New point, same framing: gestures reset but the ZOOM carries over
    // (persistedZoom) — re-apply it to the fresh <video> element.
    pointers.current.clear();
    gesture.current = null;
    applyTransform(false);
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    setMuted(false);
    v.playbackRate = persistedSpeed;
    // A full cut waits for the coach; a clip is here to be watched now.
    if (mode === "cut") {
      setPaused(true);
      return;
    }
    v.play().catch(() => {
      // Autoplay with sound refused (fresh iOS page load): retry muted.
      v.muted = true;
      autoMuted.current = true;
      setMuted(true);
      v.play().catch(() => setPaused(true));
    });
  }, [src, applyTransform, mode]);

  // React's touch listeners are passive, so scroll prevention during an
  // active pinch (or a pan while zoomed) needs a native non-passive hook —
  // otherwise the browser claims the gesture for sheet scrolling and fires
  // pointercancel mid-pinch. Single-finger touches at 1x are left alone.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (
        pointers.current.size >= 2 ||
        (pointers.current.size === 1 && tRef.current.scale > 1)
      ) {
        e.preventDefault();
      }
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, []);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (autoMuted.current) {
        v.muted = false;
        autoMuted.current = false;
        setMuted(false);
      }
      playsRef.current = 0;
      void v.play().catch(() => setPaused(true));
    } else {
      v.pause();
    }
  }, []);

  const seek = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    v.currentTime = frac * v.duration;
    setProgress(frac * 100);
  }, []);

  // ---- gesture handlers (on the wrapper: the video and, while paused, ----
  // ---- the glyph overlay both funnel here; small controls opt out) -------

  /** Anchor a pinch on the current two pointers. */
  const beginPinch = () => {
    const g = gesture.current;
    const wrap = wrapRef.current;
    if (!g || !wrap || pointers.current.size < 2) return;
    const [a, b] = [...pointers.current.values()];
    const r = wrap.getBoundingClientRect();
    const t = tRef.current;
    g.startDist = Math.hypot(b.x - a.x, b.y - a.y);
    g.startScale = t.scale;
    g.startTx = t.tx;
    g.startTy = t.ty;
    // Midpoint relative to the wrapper center — the transform's origin.
    g.startMidX = (a.x + b.x) / 2 - r.left - r.width / 2;
    g.startMidY = (a.y + b.y) / 2 - r.top - r.height / 2;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Small controls (mute, 1x pill, seek bar) keep their native behavior.
    if ((e.target as HTMLElement).closest("[data-nozoom]")) return;
    if (pointers.current.size >= 2) return; // two fingers is plenty
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events may carry inactive pointer ids; capture is a
      // nicety (keeps pans alive past the edge), not a requirement.
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      gesture.current = {
        downX: e.clientX,
        downY: e.clientY,
        moved: false,
        pinched: false,
        held: false,
        lastX: e.clientX,
        lastY: e.clientY,
        startDist: 0,
        startScale: 1,
        startTx: 0,
        startTy: 0,
        startMidX: 0,
        startMidY: 0,
      };
      // Arm the hold: a still press during playback becomes slow-mo
      // (left half) or fast-forward (right half) until release. Works
      // zoomed too — movement cancels it into a pan (onPointerMove).
      if (!videoRef.current?.paused) {
        holdTimer.current = setTimeout(() => {
          const g = gesture.current;
          const wrap = wrapRef.current;
          const v = videoRef.current;
          if (
            !g ||
            g.moved ||
            g.pinched ||
            pointers.current.size !== 1 ||
            !wrap ||
            !v ||
            v.paused
          ) {
            return;
          }
          const r = wrap.getBoundingClientRect();
          const rate =
            g.downX > r.left + r.width / 2 ? HOLD_FAST : HOLD_SLOW;
          g.held = true;
          v.playbackRate = rate;
          setHoldRate(rate);
        }, HOLD_MS);
      }
    } else {
      // Second finger: this is a pinch, never a tap (and never a hold).
      if (gesture.current) gesture.current.pinched = true;
      endHold();
      beginPinch();
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const t = tRef.current;
    if (pointers.current.size >= 2) {
      // Pinch: scale about the moving midpoint. The content point that sat
      // under the start-midpoint stays under the current midpoint:
      //   t' = mid − (mid₀ − t₀)·(s'/s₀)
      const wrap = wrapRef.current;
      if (g.startDist > 0 && wrap) {
        const [a, b] = [...pointers.current.values()];
        const r = wrap.getBoundingClientRect();
        const midX = (a.x + b.x) / 2 - r.left - r.width / 2;
        const midY = (a.y + b.y) / 2 - r.top - r.height / 2;
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const s = Math.min(
          MAX_ZOOM,
          Math.max(1, (g.startScale * dist) / g.startDist)
        );
        const k = s / g.startScale;
        t.scale = s;
        t.tx = midX - (g.startMidX - g.startTx) * k;
        t.ty = midY - (g.startMidY - g.startTy) * k;
        clampPan();
        applyTransform(false);
      }
    } else if (t.scale > 1) {
      // One-finger pan, only while zoomed. At 1x single-finger drags stay
      // inert — the point sheet already ignores video-origin drags, and we
      // must not start eating them here.
      t.tx += e.clientX - g.lastX;
      t.ty += e.clientY - g.lastY;
      clampPan();
      applyTransform(false);
    }
    g.lastX = e.clientX;
    g.lastY = e.clientY;
    if (
      Math.abs(e.clientX - g.downX) > TAP_SLOP ||
      Math.abs(e.clientY - g.downY) > TAP_SLOP
    ) {
      if (!g.moved) {
        g.moved = true;
        // A press that moves is a pan or scrub, not a hold.
        endHold();
      }
    }
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (pointers.current.size === 1) {
      // Pinch → pan handoff: re-anchor on the surviving finger.
      const [p] = [...pointers.current.values()];
      g.lastX = p.x;
      g.lastY = p.y;
      g.startDist = 0;
    } else if (pointers.current.size === 0) {
      const t = tRef.current;
      const held = g.held;
      endHold();
      if (!cancelled && !g.moved && !g.pinched && !held) {
        toggle(); // a clean tap is still play/pause
      } else if (t.scale !== 1 && t.scale < SNAP_ZOOM) {
        resetZoom(true); // barely zoomed: snap back to exactly 1
      }
      gesture.current = null;
    }
  };

  return (
    <div
      ref={wrapRef}
      // The callout opt-out lives on the wrapper so the gesture layer over
      // the video inherits it too (see Player.tsx).
      className="relative select-none overflow-hidden [-webkit-touch-callout:none]"
      // While zoomed the finger owns the frame; at 1x defer to the sheet's
      // vertical scrolling like before.
      style={{ touchAction: zoomed ? "none" : "pan-y" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPointer(e, false)}
      onPointerCancel={(e) => endPointer(e, true)}
    >
      <video
        ref={(el) => {
          videoRef.current = el;
          if (videoElRef) videoElRef.current = el;
        }}
        src={src}
        playsInline
        preload="metadata"
        crossOrigin={corsOff ? undefined : "anonymous"}
        onError={() => {
          if (!corsOff) {
            setCorsOff(true);
            const v = videoRef.current;
            if (v) {
              // Drop the attribute NOW: a sync load() would otherwise
              // re-request before React commits the prop change, and the
              // retry races the very failure it exists to dodge.
              v.removeAttribute("crossorigin");
              v.load();
              if (mode !== "cut") {
                void v.play().catch(() => setPaused(true));
              }
            }
          } else {
            onMediaError?.();
          }
        }}
        // Same as the match player: a long press here is a gesture of ours,
        // not an invitation to save the file (see Player.tsx).
        disablePictureInPicture
        controlsList="nodownload noplaybackrate noremoteplayback"
        onContextMenu={(e) => e.preventDefault()}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (Number.isFinite(v.duration) && v.duration > 0) {
            setProgress((v.currentTime / v.duration) * 100);
          }
          onTime?.(v);
        }}
        onEnded={(e) => {
          const v = e.currentTarget;
          if (mode === "cut") {
            setPaused(true);
            return;
          }
          playsRef.current += 1;
          v.currentTime = 0;
          if (playsRef.current < 2) {
            void v.play().catch(() => setPaused(true));
          } else {
            setPaused(true);
            setProgress(0);
          }
        }}
        className={`max-h-[45vh] w-full select-none bg-black [-webkit-touch-callout:none] ${
          tall ? "lg:max-h-[70vh]" : "lg:max-h-[52vh]"
        }`}
      />
      {paused && (
        <button
          type="button"
          // Pointer taps are handled by the wrapper's gesture logic (the
          // wrapper captures the pointer, so no click lands here); keep the
          // button for keyboard activation only.
          onClick={(e) => {
            if (e.detail === 0) toggle();
          }}
          // While zoomed this full-bleed overlay must not feed the point
          // sheet's swipe-to-navigate — the drag is a pan. At 1x it keeps
          // its old behavior (sheet swipes work from the paused overlay).
          data-noswipe={zoomed || undefined}
          aria-label="Play"
          className="absolute inset-0 flex items-center justify-center"
        >
          <span className="ks-fade rounded-full bg-ink/60 p-3.5 backdrop-blur-sm">
            <svg
              viewBox="0 0 24 24"
              className="h-7 w-7 text-white"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 5.5v13l11-6.5-11-6.5Z" />
            </svg>
          </span>
        </button>
      )}
      {zoomed && (
        <button
          type="button"
          data-nozoom
          onClick={() => resetZoom(true)}
          aria-label="Reset zoom"
          className="absolute left-2 top-2 rounded-full bg-ink/60 px-2.5 py-1 text-[11px] font-semibold leading-none text-zinc-300 backdrop-blur-sm"
        >
          1x
        </button>
      )}
      {holdRate !== null && (
        <span className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-ink/60 px-2.5 py-1 text-[11px] font-semibold tabular-nums leading-none text-zinc-200 backdrop-blur-sm">
          {holdRate}x
        </span>
      )}
      <button
        type="button"
        data-nozoom
        onClick={() => {
          const v = videoRef.current;
          if (!v) return;
          autoMuted.current = false;
          v.muted = !v.muted;
          setMuted(v.muted);
        }}
        aria-label={muted ? "Unmute" : "Mute"}
        className="absolute right-2 top-2 rounded-full bg-ink/60 p-1.5 text-zinc-300 backdrop-blur-sm"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          {muted ? (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11 5 6 9H3v6h3l5 4V5Zm10 4-6 6m0-6 6 6"
            />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11 5 6 9H3v6h3l5 4V5Zm4.5 2.5a5 5 0 0 1 0 9M18 4.8a8.5 8.5 0 0 1 0 14.4"
            />
          )}
        </svg>
      </button>
      {/* speed + zoom, same controls the match player carries on its
          transport — pinch is invisible and desktop has nothing to pinch
          with. Bottom-right, clear of the progress bar's hit area. */}
      <div
        data-nozoom
        data-noswipe
        className="absolute bottom-4 right-2 flex items-center gap-1"
      >
        {onReplay && (
          <button
            type="button"
            onClick={onReplay}
            aria-label="Replay this point"
            title="Replay this point"
            className="rounded-full bg-ink/60 p-1.5 text-zinc-300 backdrop-blur-sm transition-colors hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8Z" />
            </svg>
          </button>
        )}
        <SpeedMenu
          value={speed}
          onChange={setSpeed}
          className="rounded-full bg-ink/60 px-2.5 py-1.5 text-[11px] font-semibold tabular-nums leading-none text-zinc-300 backdrop-blur-sm"
        />
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.5)}
          disabled={zoomScale <= 1.001}
          aria-label="Zoom out"
          title="Zoom out"
          className="rounded-full bg-ink/60 p-1.5 text-zinc-300 backdrop-blur-sm transition-colors hover:text-white disabled:opacity-30"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.4-3.4M8 11h6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1.5)}
          disabled={zoomScale >= MAX_ZOOM - 0.001}
          aria-label="Zoom in"
          title="Zoom in"
          className="rounded-full bg-ink/60 p-1.5 text-zinc-300 backdrop-blur-sm transition-colors hover:text-white disabled:opacity-30"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.4-3.4M8 11h6M11 8v6" />
          </svg>
        </button>
      </div>
      <div
        onPointerDown={seek}
        data-noswipe
        data-nozoom
        className="absolute inset-x-0 bottom-0 h-3 cursor-pointer"
      >
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
          <div
            className="h-full bg-cyan-glow/80"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
