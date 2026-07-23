"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Pinch zoom ceiling. */
const MAX_ZOOM = 4;
/** Released below this scale → snap back to exactly 1. */
const SNAP_ZOOM = 1.05;
/** Pointer travel (px) beyond which a press stops counting as a tap. */
const TAP_SLOP = 8;

/**
 * Minimal player for point clips in the detail view. No native controls —
 * clips are seconds long, so the iOS chrome (±10s skips, big play button)
 * is pure noise. Autoplays on open and on prev/next navigation, plays the
 * rally twice, then rests on the first frame. Tap to play/pause; thin
 * tap-to-seek progress bar; small speaker toggle when muted autoplay was
 * needed. Clip EDITING keeps the native <video> (frame-accurate scrubbing).
 *
 * Pinch to zoom (1x–4x, anchored at the pinch midpoint) with one-finger
 * pan while zoomed — for judging edge balls on far camera angles. The
 * transform lives on the <video> only; the overlays (mute, progress, play
 * glyph, 1x pill) are unscaled siblings. Zoom survives play/pause and
 * scrubbing but resets when the clip (point) changes.
 */
export function ClipPlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const playsRef = useRef(0);
  // Muting is only ever a fallback to satisfy autoplay policy; the first
  // user gesture that starts playback lifts it.
  const autoMuted = useRef(false);

  // ---- zoom/pan gesture state -------------------------------------------
  // The transform is applied imperatively (element.style) during gestures
  // so pointermove never waits on a React render. `zoomed` is the only
  // piece React needs (1x pill, touch-action, sheet-swipe exclusion).
  const tRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    downX: number;
    downY: number;
    moved: boolean;
    pinched: boolean;
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
    v.style.transition = animate ? "transform 180ms ease" : "";
    v.style.transform =
      scale === 1 && tx === 0 && ty === 0
        ? ""
        : `translate(${tx}px, ${ty}px) scale(${scale})`;
    setZoomed(scale > 1);
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

  useEffect(() => {
    playsRef.current = 0;
    setProgress(0);
    // New point, new framing: drop any zoom from the previous clip.
    pointers.current.clear();
    gesture.current = null;
    resetZoom(false);
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    setMuted(false);
    v.play().catch(() => {
      // Autoplay with sound refused (fresh iOS page load): retry muted.
      v.muted = true;
      autoMuted.current = true;
      setMuted(true);
      v.play().catch(() => setPaused(true));
    });
  }, [src, resetZoom]);

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
        lastX: e.clientX,
        lastY: e.clientY,
        startDist: 0,
        startScale: 1,
        startTx: 0,
        startTy: 0,
        startMidX: 0,
        startMidY: 0,
      };
    } else {
      // Second finger: this is a pinch, never a tap.
      if (gesture.current) gesture.current.pinched = true;
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
      g.moved = true;
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
      if (!cancelled && !g.moved && !g.pinched) {
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
      className="relative overflow-hidden"
      // While zoomed the finger owns the frame; at 1x defer to the sheet's
      // vertical scrolling like before.
      style={{ touchAction: zoomed ? "none" : "pan-y" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPointer(e, false)}
      onPointerCancel={(e) => endPointer(e, true)}
    >
      <video
        ref={videoRef}
        src={src}
        playsInline
        preload="metadata"
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (Number.isFinite(v.duration) && v.duration > 0) {
            setProgress((v.currentTime / v.duration) * 100);
          }
        }}
        onEnded={(e) => {
          const v = e.currentTarget;
          playsRef.current += 1;
          v.currentTime = 0;
          if (playsRef.current < 2) {
            void v.play().catch(() => setPaused(true));
          } else {
            setPaused(true);
            setProgress(0);
          }
        }}
        className="max-h-[45vh] w-full bg-black lg:max-h-[52vh]"
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
