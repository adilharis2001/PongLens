"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Side } from "./sides";

/** Tallest a portrait frame may get, so both tap targets stay on screen. */
const PORTRAIT_MAX_H = 360;

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
 *
 * `posterSrc` covers the one caller with no video to seek: a YouTube import
 * is a URL, and the file does not exist anywhere we can read until the
 * worker has fetched it. YouTube publishes a still from the video, which is
 * the same camera on the same table — enough to answer "which end am I".
 * Asking without a frame is the thing to avoid: near/far is a guess without
 * one, and a wrong answer silently mirrors every placement map.
 */
export function PickSide({
  src,
  posterSrc = null,
  atSeconds = 60,
  selected = null,
  busy = false,
  onPick,
  onSkip,
  skipLabel = "Skip",
}: {
  /** Video source (object URL or presigned R2 URL); null while it loads. */
  src: string | null;
  /** A still to use INSTEAD of the video, for callers that have no file. */
  posterSrc?: string | null;
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
  // The frame's real shape, once the file says what it is. Phones hand us
  // both, and a 16:9 box shrank a portrait clip to about a third of the
  // width — the one thing this picker cannot afford, because you answer it
  // by seeing which end you are at.
  const [ratio, setRatio] = useState<number | null>(null);
  // No frame, no question. A phone records HEVC in a .mov, which plenty of
  // desktop browsers will not decode, and the old build left "Loading a
  // frame…" up forever with both answers live — so the honest thing to do
  // was guess, and a wrong guess silently mirrors every placement map (see
  // the note above). Failing explicitly hands the question to the match
  // page instead, where the source is the H.264 cut and always decodes.
  const [unreadable, setUnreadable] = useState(false);

  // A new source starts black until it seeks to (or loads) the frame.
  useEffect(() => {
    setReady(false);
    setUnreadable(false);
    setRatio(null);
  }, [src, posterSrc]);

  // Give it a few seconds, then stop pretending. Covers the codecs that
  // fail loudly (onError) and the ones that just never fire onSeeked.
  useEffect(() => {
    if (ready || unreadable || (!src && !posterSrc)) return;
    const t = window.setTimeout(() => setUnreadable(true), 6000);
    return () => window.clearTimeout(t);
  }, [ready, unreadable, src, posterSrc]);

  // Seek to a real rally once metadata is in, then leave it paused.
  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.videoWidth > 0 && v.videoHeight > 0) {
      setRatio(v.videoWidth / v.videoHeight);
    }
    const dur = v.duration || atSeconds * 2;
    v.currentTime = Math.max(0, Math.min(atSeconds, dur * 0.5));
  };

  // Portrait keeps its own shape but is capped in height; landscape keeps
  // the full width it has always had.
  const boxStyle: CSSProperties =
    ratio !== null && ratio < 1
      ? {
          aspectRatio: ratio,
          width: `min(100%, ${Math.round(PORTRAIT_MAX_H * ratio)}px)`,
        }
      : { aspectRatio: ratio ?? 16 / 9 };

  const sideButton = (side: Side, title: string, hint: string) => {
    const on = selected === side;
    return (
      <button
        type="button"
        disabled={busy || unreadable || (!src && !posterSrc)}
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
      <div
        className="relative mx-auto my-2 overflow-hidden rounded-xl border border-edge bg-black"
        style={boxStyle}
      >
        {posterSrc ? (
          // A remote still whose host isn't in next/image's allowlist, shown
          // once in a form; the loader would buy nothing here.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={posterSrc}
            alt=""
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                setRatio(img.naturalWidth / img.naturalHeight);
              }
              setReady(true);
            }}
            onError={() => setUnreadable(true)}
            className={`absolute inset-0 h-full w-full object-contain transition-opacity ${
              ready ? "opacity-100" : "opacity-0"
            }`}
          />
        ) : (
          src && (
            <video
              ref={videoRef}
              src={src}
              muted
              playsInline
              preload="metadata"
              onLoadedMetadata={onLoadedMetadata}
              onSeeked={() => setReady(true)}
              onError={() => setUnreadable(true)}
              className={`absolute inset-0 h-full w-full object-contain transition-opacity ${
                ready ? "opacity-100" : "opacity-0"
              }`}
            />
          )
        )}
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-zinc-500">
            {unreadable
              ? "This browser can't show a frame from this file."
              : "Loading a frame…"}
          </div>
        )}
      </div>
      {sideButton("near", "I'm at the bottom", "Closer to the camera")}
      {unreadable && (
        <p className="mt-2 text-center text-xs text-zinc-500">
          We&apos;ll ask again on the match page, where the frame will load.
        </p>
      )}
      {onSkip && (
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={onSkip}
            className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white"
          >
            {unreadable ? "Close" : skipLabel}
          </button>
        </div>
      )}
    </div>
  );
}
