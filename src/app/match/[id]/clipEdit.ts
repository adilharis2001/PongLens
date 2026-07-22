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
