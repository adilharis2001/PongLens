"use client";

import { useEffect, useRef } from "react";

/**
 * The box is sized by a div (aspect-video), never the <video> itself, and
 * playback starts immediately so native controls are the right chrome.
 * play() runs after the signed-URL fetch, outside the click gesture, so
 * a blocked unmuted start falls back to muted — the controls unmute.
 * Pause on unmount: a removed <video> keeps playing with sound.
 */
export function CutVideo({ url }: { url: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Offscreen muted playback gets auto-paused by the browser, so bring
    // the player into view before starting.
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el.play().catch(() => {
      el.muted = true;
      el.play().catch(() => {});
    });
    return () => {
      el.pause();
    };
  }, []);
  return (
    <div className="mt-3 aspect-video w-full overflow-hidden rounded-xl bg-black">
      <video ref={ref} src={url} controls playsInline className="h-full w-full" />
    </div>
  );
}
