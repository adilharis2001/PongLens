"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimal player for point clips in the detail view. No native controls —
 * clips are seconds long, so the iOS chrome (±10s skips, big play button)
 * is pure noise. Autoplays on open and on prev/next navigation, plays the
 * rally twice, then rests on the first frame. Tap to play/pause; thin
 * tap-to-seek progress bar; small speaker toggle when muted autoplay was
 * needed. Clip EDITING keeps the native <video> (frame-accurate scrubbing).
 */
export function ClipPlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const playsRef = useRef(0);
  // Muting is only ever a fallback to satisfy autoplay policy; the first
  // user gesture that starts playback lifts it.
  const autoMuted = useRef(false);

  useEffect(() => {
    playsRef.current = 0;
    setProgress(0);
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
  }, [src]);

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

  return (
    <div className="relative">
      <video
        ref={videoRef}
        src={src}
        playsInline
        preload="metadata"
        onClick={toggle}
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
          onClick={toggle}
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
      <button
        type="button"
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
