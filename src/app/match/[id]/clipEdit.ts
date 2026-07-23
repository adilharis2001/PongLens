/**
 * Clip context padding per cut strictness, in seconds of source video
 * before t0 / after t1. Point clips are cut as
 * [max(0, t0 - pre), t1 + post], so mapping the <video> playhead back onto
 * the source timeline needs these numbers.
 *
 * MUST match STRICTNESS in worker/points_pipeline.py and CLIP_PADDING in
 * worker/worker.py.
 */
export const CLIP_PAD: Record<string, { pre: number; post: number }> = {
  tight: { pre: 0.5, post: 1.0 },
  normal: { pre: 1.0, post: 1.6 },
  loose: { pre: 1.6, post: 2.4 },
};

export function clipPad(strictness: string | null | undefined): {
  pre: number;
  post: number;
} {
  return CLIP_PAD[strictness ?? "normal"] ?? CLIP_PAD.normal;
}

/**
 * Context kept at a SPLIT boundary, in seconds. When a point is split, the
 * two children share one moment — padding both with the full strictness pad
 * would double it in both clips, so the shared edge keeps only this sliver.
 * MUST match TIGHT_PAD in worker/worker.py (process_reclip).
 */
export const TIGHT_PAD = 0.3;

/**
 * The pads a point's clip is actually cut with: full strictness pads on
 * outer edges, min(pad, TIGHT_PAD) on edges flagged as split boundaries
 * (points.tight_start / tight_end). Anything mapping clip-file seconds to
 * source seconds (clipBase in PointDetail) must use THESE, not clipPad().
 */
export function effectivePad(
  pad: { pre: number; post: number },
  tightStart: boolean,
  tightEnd: boolean
): { pre: number; post: number } {
  return {
    pre: tightStart ? Math.min(pad.pre, TIGHT_PAD) : pad.pre,
    post: tightEnd ? Math.min(pad.post, TIGHT_PAD) : pad.post,
  };
}
