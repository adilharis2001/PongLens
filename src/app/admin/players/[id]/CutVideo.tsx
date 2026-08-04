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
    // Re-run per URL: the component is REUSED when you Play the next
    // point (same tree position), and a mount-only effect left every clip
    // after the first waiting for a second press of play.
  }, [url]);
  return (
    <div className="mt-3 aspect-video w-full overflow-hidden rounded-xl bg-black">
      <video ref={ref} src={url} controls playsInline className="h-full w-full" />
    </div>
  );
}
