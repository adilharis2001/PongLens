"use client";

import { useEffect, useRef, useState } from "react";
import type { Side } from "./sides";

/**
 * Snapshot "which player are you?" picker. Shows the match video seeked to
 * a real point of play and PAUSED — display only, no canvas/pixel read, so
 * cross-origin R2 URLs are fine — with a tap target ABOVE and BELOW the
 * frame so the choice is tied to what the user sees: TOP = far from the
 * camera, BOTTOM = near it (matching the worker's near/far convention).
 * Returns 'near' | 'far'.
 *
 * Purely presentational: callers supply the chrome (upload form, first-open
 * banner, Tools sheet) and the src — a local object URL at upload time, the
 * presigned cut video afterwards. Skippable wherever a caller passes onSkip.
 */
export function PickSide({
  src,
  atSeconds = 60,
  selected = null,
  busy = false,
  onPick,
  onSkip,
  skipLabel = "Skip",
}: {
  /** Video source (object URL or presigned R2 URL); null while it loads. */
  src: string | null;
  /** Seek target in seconds; clamped to <= 50% of duration for short clips. */
  atSeconds?: number;
  /** Highlight the already-chosen side (change flows). */
  selected?: Side | null;
  busy?: boolean;
  onPick: (side: Side) => void;
  /** Present -> a quiet Skip/close link under the picker. */
  onSkip?: () => void;
  skipLabel?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);

  // A new source starts black until it seeks to the chosen frame.
  useEffect(() => {
    setReady(false);
  }, [src]);

  // Seek to a real rally once metadata is in, then leave it paused.
  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    const dur = v.duration || atSeconds * 2;
    v.currentTime = Math.max(0, Math.min(atSeconds, dur * 0.5));
  };

  const sideButton = (side: Side, title: string, hint: string) => {
    const on = selected === side;
    return (
      <button
        type="button"
        disabled={busy || !src}
        onClick={() => onPick(side)}
        aria-pressed={on}
        className={`w-full rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
          on
            ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
            : "border-edge bg-ink/40 text-zinc-200 hover:border-cyan-glow/40 hover:text-white"
        }`}
      >
        {title}
        <span className="mt-0.5 block text-[11px] font-normal text-zinc-500">
          {hint}
        </span>
      </button>
    );
  };

  return (
    <div>
      {sideButton("far", "I'm at the top", "Farther from the camera")}
      <div className="relative my-2 aspect-video overflow-hidden rounded-xl border border-edge bg-black">
        {src && (
          <video
            ref={videoRef}
            src={src}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={onLoadedMetadata}
            onSeeked={() => setReady(true)}
            className={`absolute inset-0 h-full w-full object-contain transition-opacity ${
              ready ? "opacity-100" : "opacity-0"
            }`}
          />
        )}
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500">
            Loading a frame…
          </div>
        )}
      </div>
      {sideButton("near", "I'm at the bottom", "Closer to the camera")}
      {onSkip && (
        <div className="mt-2 text-center">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-zinc-500 underline underline-offset-2 transition-colors hover:text-zinc-300"
          >
            {skipLabel}
          </button>
        </div>
      )}
    </div>
  );
}
