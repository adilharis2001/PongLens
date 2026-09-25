"use client";

/**
 * The trim, with the picture it is cut against: a preview player above the
 * trim bar, and "Start here" / "End here" under it. ONE component on every
 * surface that processes a video automatically: the upload card (the
 * picked file, played straight off disk while it uploads), the unprocessed
 * match page and a processed match's More options (Adil, 2026-09-25). A
 * trim that behaves differently in two places teaches the wrong lesson in
 * one of them, so change it here, never in a host.
 *
 * Dragging a handle takes the picture to that handle's time, so the player
 * sees the exact frame being cut at: fast seeks while the handle moves,
 * the exact frame when it is let go (scrubSeeker). The times under the bar
 * are written with the player's own clock, so the bar's end and the
 * player's length are the same number.
 *
 * The picture's box is sized on a div, never on the <video> (a media
 * element has no size until its metadata arrives), in the video's own
 * shape when the host already knows it and 16:9 until then. The player is
 * ClipPlayer in its cut mode, which draws its own idle state and has no
 * native controls. A file this browser cannot play (an HEVC .mov in
 * desktop Chrome) shows the trim bar alone: the host's own message says
 * why, and a black rectangle with a spinner would only look broken.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ClipPlayer, clock as playerClock } from "@/app/match/[id]/ClipPlayer";
import { TrimBar } from "@/components/TrimBar";
import { previewAspect, scrubSeeker, stampEnd, stampStart } from "@/components/trimSeek";

const PILL =
  "rounded-full border border-edge px-3.5 py-1.5 text-sm text-zinc-300 hover:border-zinc-500";

export function TrimPreview({
  src,
  poster,
  playable = true,
  aspect = null,
  unavailable = null,
  label = null,
  duration,
  noDuration = null,
  start,
  end,
  onChange,
  trimmed,
  onReset,
  onLoadedMetadata,
  className = "",
}: {
  /** The video to preview. Null while its address is still being fetched
   *  (the box shows, empty, in its final size). */
  src: string | null;
  /** A frame to paint until the file's own first frame is decoded. */
  poster?: string;
  /** False when the host already knows this browser cannot play the file:
   *  the trim bar shows alone. */
  playable?: boolean;
  /** The video's width over its height, when the host already knows it,
   *  so the box is the right shape from the first frame. */
  aspect?: number | null;
  /** In place of the picture: the host's own line for a video that is no
   *  longer there. */
  unavailable?: ReactNode;
  /** Between the picture and the bar. */
  label?: ReactNode;
  /** The bar's length: the file's own, as the player reads it. Null until
   *  it is known, and then `noDuration` shows in the bar's place. */
  duration: number | null;
  noDuration?: ReactNode;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  /** A handle has moved: Reset shows, and puts both back. */
  trimmed: boolean;
  onReset: () => void;
  /** The preview read the file. */
  onLoadedMetadata?: (el: HTMLVideoElement) => void;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const seeker = useMemo(() => scrubSeeker(), []);
  /** This browser refused the file, or read it and found no picture. */
  const [failed, setFailed] = useState(false);
  const [shape, setShape] = useState<number | null>(null);
  useEffect(() => {
    setFailed(false);
  }, [src]);

  // A <video> taken out of the document keeps playing, with sound.
  const mounted = useRef<HTMLVideoElement | null>(null);
  useEffect(() => () => mounted.current?.pause(), []);

  const showPicture = playable && !failed && !unavailable;
  const ratio = previewAspect(shape ?? aspect, 1);

  const video = () => (showPicture ? videoRef.current : null);

  return (
    <div className={className}>
      {unavailable}
      {showPicture && (
        <div
          className="relative mb-5 w-full overflow-hidden rounded-xl border border-edge bg-black"
          style={{ aspectRatio: ratio }}
        >
          {src ? (
            <ClipPlayer
              src={src}
              poster={poster}
              mode="cut"
              fill
              readPixels={false}
              videoElRef={videoRef}
              onLoadedMetadata={(el) => {
                mounted.current = el;
                if (!el.videoWidth || !el.videoHeight) {
                  setFailed(true);
                  return;
                }
                setShape(el.videoWidth / el.videoHeight);
                onLoadedMetadata?.(el);
              }}
              onMediaError={() => setFailed(true)}
            />
          ) : (
            <div className="h-full w-full animate-pulse bg-surface-2" />
          )}
        </div>
      )}
      {label}
      {duration == null ? (
        noDuration
      ) : (
        <>
          <TrimBar
            duration={duration}
            start={start}
            end={end}
            onChange={onChange}
            onScrub={(t) => {
              const v = video();
              if (v) seeker.scrub(v, t);
            }}
            onScrubEnd={(t) => {
              const v = video();
              if (v) seeker.release(v, t);
            }}
            clock={playerClock}
          />
          {(showPicture || trimmed) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {showPicture && (
                <>
                  <button
                    type="button"
                    onClick={() => onChange(stampStart(video()?.currentTime ?? 0, end), end)}
                    className={PILL}
                  >
                    Start here
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onChange(start, stampEnd(video()?.currentTime ?? 0, start, duration))
                    }
                    className={PILL}
                  >
                    End here
                  </button>
                </>
              )}
              {trimmed && (
                <button
                  type="button"
                  onClick={onReset}
                  className="ml-auto text-sm text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
                >
                  Reset
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
