"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimal custom player for the public /s/[token] pages — the tiny,
 * logged-out-safe sibling of the match page's Player. Same visual
 * language (bg-ink, cyan progress, ks-fade glyphs) but no chrome beyond
 * tap-to-play, a thin scrub bar with time labels, and a mute toggle.
 *
 * NO native controls, ever: on iOS the native chrome (big play button,
 * ±10s skips, scrubber) flashes on every src swap, which wrecks the
 * starred auto-advance. And no fullscreen/PiP — native fullscreen forces
 * the iOS player back in.
 *
 * Autoplay contract: the page starts each session muted (mobile browsers
 * require it), but the FIRST user gesture that starts playback unmutes —
 * muting was only ever for the automatic start. After that the speaker
 * toggle is the sole authority. When src changes (starred auto-advance)
 * the same element keeps playing seamlessly; if play() rejects we show
 * our own tap-to-play glyph rather than anything native.
 */

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function SharePlayer({
  src,
  onEnded,
}: {
  src: string;
  /** StarredView's auto-advance hook; single videos just stop. */
  onEnded?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(true);
  const [playheadT, setPlayheadT] = useState(0);
  const [duration, setDuration] = useState(0);

  // First user-gesture play unmutes automatically (see contract above).
  const autoMuted = useRef(true);

  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  // New src on the same element (starred auto-advance): keep rolling.
  // The sequence is one user session, so iOS allows continued playback
  // after the initial gesture; if play() still rejects, our paused glyph
  // is the fallback — never native chrome.
  useEffect(() => {
    setPlayheadT(0);
    setDuration(0);
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => setPaused(true));
  }, [src]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      // A user gesture is starting playback: drop the autoplay-only mute.
      if (autoMuted.current && v.muted) {
        v.muted = false;
        setMuted(false);
      }
      autoMuted.current = false;
      v.play().catch(() => setPaused(true));
    } else {
      v.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    autoMuted.current = false; // explicit choice from here on
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  // ------------------------------------------------------------ scrub bar

  const scrubRef = useRef<HTMLDivElement | null>(null);
  const scrubbing = useRef(false);

  const scrubToClientX = useCallback(
    (clientX: number) => {
      const el = scrubRef.current;
      const v = videoRef.current;
      if (!el || !v || duration <= 0) return;
      const rect = el.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const t = frac * duration;
      setPlayheadT(t);
      if (v.readyState >= 1) v.currentTime = t;
    },
    [duration]
  );

  const onScrubDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Capture is best-effort; tap-to-seek still works without it.
      }
      scrubbing.current = true;
      scrubToClientX(e.clientX);
    },
    [scrubToClientX]
  );
  const onScrubMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!scrubbing.current) return;
      scrubToClientX(e.clientX);
    },
    [scrubToClientX]
  );
  const onScrubUp = useCallback(() => {
    scrubbing.current = false;
  }, []);

  const progressPct = duration > 0 ? (playheadT / duration) * 100 : 0;

  return (
    <div>
      <div className="relative bg-black">
        <video
          ref={videoRef}
          src={src}
          playsInline
          autoPlay
          muted
          preload="metadata"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
          onTimeUpdate={(e) => setPlayheadT(e.currentTarget.currentTime)}
          onSeeked={(e) => setPlayheadT(e.currentTarget.currentTime)}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onEnded={() => onEndedRef.current?.()}
          className="max-h-[60vh] w-full bg-black"
        />

        {/* tap surface: play/pause */}
        <button
          type="button"
          onClick={togglePlay}
          aria-label={paused ? "Play" : "Pause"}
          className="absolute inset-0 select-none"
          style={{ touchAction: "manipulation" }}
          onContextMenu={(e) => e.preventDefault()}
        />

        {/* paused glyph — same pattern as the app's Player */}
        {paused && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="ks-fade rounded-full bg-ink/60 p-4 backdrop-blur-sm">
              <svg
                viewBox="0 0 24 24"
                className="h-8 w-8 text-white"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5.5v13l11-6.5-11-6.5Z" />
              </svg>
            </span>
          </div>
        )}
      </div>

      {/* transport row: time · scrub · time · mute */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="shrink-0 text-[10px] tabular-nums text-zinc-400">
          {formatTime(playheadT)}
        </span>
        <div
          ref={scrubRef}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(playheadT)}
          className="relative flex h-8 min-w-0 flex-1 cursor-pointer items-center"
          style={{ touchAction: "none" }}
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
        >
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/15">
            <span
              className="absolute inset-y-0 left-0 bg-cyan-glow"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span
            className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 rounded-full bg-cyan-glow shadow-[0_0_8px_rgba(34,211,238,0.7)]"
            style={{ left: `${progressPct}%` }}
          />
        </div>
        <span className="shrink-0 text-[10px] tabular-nums text-zinc-400">
          {formatTime(duration)}
        </span>
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
          aria-pressed={muted}
          className="shrink-0 rounded-full p-1.5 text-zinc-300 transition-colors hover:text-white"
        >
          {muted ? (
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11 5 6.5 9H3v6h3.5L11 19V5ZM16 9.5l5 5M21 9.5l-5 5"
              />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11 5 6.5 9H3v6h3.5L11 19V5ZM15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"
              />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
