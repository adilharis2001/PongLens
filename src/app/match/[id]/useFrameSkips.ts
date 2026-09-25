"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

type VideoWithFrames = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    cb: (now: number, meta: { mediaTime: number }) => void
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * Jump dead spans on the frame, not on the tick.
 *
 * A player that jumps spans from timeupdate jumps up to a quarter of a
 * second late, which on a hand-cut match (playhead.handCutGaps) is a quarter
 * of a second of footage the player never marked. The frame callback
 * reports the media time of each frame as it is shown, so the jump fires on
 * the first frame inside a span. The host's timeupdate rule stays as the
 * fallback for a browser without the callback; both land on the same
 * `end`, so running both never double-jumps.
 *
 * `active` is off wherever the spans are not a hand cut's, so automatic
 * matches keep exactly the timing they have. `key` re-attaches when the
 * host swaps its <video> (a new source).
 */
export function useFrameSkips(
  videoRef: MutableRefObject<HTMLVideoElement | null>,
  spans: { start: number; end: number }[],
  active: boolean,
  key: unknown,
  onJump?: (t: number) => void
) {
  const spansRef = useRef(spans);
  spansRef.current = spans;
  const jumpRef = useRef(onJump);
  jumpRef.current = onJump;
  useEffect(() => {
    const v = videoRef.current as VideoWithFrames | null;
    if (!active || !v || typeof v.requestVideoFrameCallback !== "function") return;
    let alive = true;
    let handle = 0;
    const onFrame = (_now: number, meta: { mediaTime: number }) => {
      if (!alive) return;
      if (!v.paused) {
        const t = meta.mediaTime;
        const z = spansRef.current.find((sp) => t >= sp.start && t < sp.end - 0.05);
        if (z) {
          v.currentTime = z.end;
          jumpRef.current?.(z.end);
        }
      }
      handle = v.requestVideoFrameCallback!(onFrame);
    };
    handle = v.requestVideoFrameCallback(onFrame);
    return () => {
      alive = false;
      v.cancelVideoFrameCallback?.(handle);
    };
  }, [videoRef, active, key]);
}
