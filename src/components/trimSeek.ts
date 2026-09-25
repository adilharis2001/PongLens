/**
 * The rules behind TrimPreview (the trim bar with a picture above it, on
 * the upload card, the unprocessed page and a processed match's More
 * options): where "Start here" / "End here" put a handle, how big the
 * picture's box is, and how the picture follows a handle being dragged.
 * No React and no DOM beyond the few members a <video> has, so the node
 * tests hold every case.
 */

/** Shortest window we will cut to. Below this there is no match left. */
export const MIN_TRIM_S = 5;

/** "Start here": the start handle to the playhead, never closer than
 *  MIN_TRIM_S to the end handle and never before zero. */
export function stampStart(t: number, end: number): number {
  return Math.max(0, Math.min(t, end - MIN_TRIM_S));
}

/** "End here": the end handle to the playhead, never closer than
 *  MIN_TRIM_S to the start handle and never past the end. */
export function stampEnd(t: number, start: number, duration: number): number {
  return Math.min(duration, Math.max(t, start + MIN_TRIM_S));
}

/**
 * The picture's box, as width over height. The video's own shape once it
 * is known, 16:9 until then (nearly every match is filmed landscape, so
 * the box rarely changes when the file answers). Clamped: a wider file is
 * letterboxed in 16:9, and a portrait one is shown in a 4:3 box rather
 * than one taller than the phone's screen, which would push the handles
 * it is read against out of sight.
 */
export const DEFAULT_ASPECT = 16 / 9;
export const MIN_ASPECT = 4 / 3;
export function previewAspect(width?: number | null, height?: number | null): number {
  if (!width || !height || !Number.isFinite(width / height)) return DEFAULT_ASPECT;
  return Math.min(DEFAULT_ASPECT, Math.max(MIN_ASPECT, width / height));
}

/** What the seeker needs of a <video>. */
export interface SeekableVideo {
  currentTime: number;
  readonly paused: boolean;
  /** HAVE_NOTHING (0) until the metadata arrives; no seek is made before. */
  readonly readyState: number;
  /** Safari and Firefox: jump to the nearest keyframe, which is fast. */
  fastSeek?: (t: number) => void;
  pause(): void;
  addEventListener(type: "seeked", listener: () => void, options?: { once?: boolean }): void;
}

/** A seek that has not answered in this long is treated as lost. */
export const SEEK_STALE_MS = 500;

/**
 * The picture follows the handle being dragged, so the player sees the
 * frame they are cutting at.
 *
 * While dragging: a fast seek (fastSeek where the browser has one), and
 * never more than one in flight. A pointer moves sixty times a second and
 * a seek on a long file takes longer than that, so every move setting
 * currentTime queues seeks the decoder can never catch up with. The newest
 * position waits for the current seek to land and then goes; the ones in
 * between are dropped.
 *
 * On release: an exact seek to where the handle came to rest, so the frame
 * on screen is the frame the cut starts or ends on, whatever the fast
 * seeks landed on.
 *
 * The picture pauses when a handle is grabbed: a playing video would walk
 * away from the frame the handle points at.
 */
export function scrubSeeker(now: () => number = () => Date.now()) {
  let pending: number | null = null;
  /** When the seek in flight was made, or null when none is. */
  let inFlightSince: number | null = null;

  const scrub = (v: SeekableVideo, t: number) => {
    if (!v.paused) v.pause();
    if (v.readyState < 1) {
      // Nothing to seek yet: the element keeps the position for when its
      // metadata arrives, and no 'seeked' will come for it.
      v.currentTime = t;
      return;
    }
    if (inFlightSince != null && now() - inFlightSince < SEEK_STALE_MS) {
      pending = t;
      return;
    }
    pending = null;
    inFlightSince = now();
    if (typeof v.fastSeek === "function") v.fastSeek(t);
    else v.currentTime = t;
    v.addEventListener(
      "seeked",
      () => {
        inFlightSince = null;
        if (pending != null) {
          const next = pending;
          pending = null;
          scrub(v, next);
        }
      },
      { once: true },
    );
  };

  const release = (v: SeekableVideo, t: number) => {
    // Whatever was waiting is older than this.
    pending = null;
    if (!v.paused) v.pause();
    v.currentTime = t;
  };

  return { scrub, release };
}
