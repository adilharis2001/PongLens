/**
 * Clip context padding, in seconds of source video before t0 / after t1.
 * Point clips are cut as [max(0, t0 - pre), t1 + post], so mapping the
 * <video> playhead back onto the source timeline needs the pads a clip was
 * ACTUALLY cut with.
 *
 * Since migration 048 the worker stamps those pads on the match row
 * (matches.clip_pads) and this table is only the fallback for older
 * matches — which is why its values are FROZEN: they are what pre-048
 * clips were cut with, and must never track the worker's current
 * CLIP_PADS (points_pipeline.py).
 */
export const CLIP_PAD: Record<string, { pre: number; post: number }> = {
  tight: { pre: 0.5, post: 1.0 },
  normal: { pre: 1.0, post: 1.6 },
  loose: { pre: 1.6, post: 2.4 },
};

export function clipPad(
  strictness: string | null | undefined,
  stored?: { pre: number; post: number } | null
): {
  pre: number;
  post: number;
} {
  if (
    stored &&
    typeof stored.pre === "number" &&
    typeof stored.post === "number"
  ) {
    return { pre: stored.pre, post: stored.post };
  }
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

/**
 * Where a point's padded clip starts in the cut video AFTER its start
 * edge moves: the old anchor shifted by the change in the padded start.
 *
 * cut_t0 is the padded clip start on the cut video's clock (the anchoring
 * fact in playhead.ts). Adjust used to move t0 and leave cut_t0 alone, so
 * every cut-clock consumer placed the serve wrong by exactly the amount the
 * start moved, forever. The database's adjust_point applies this same
 * arithmetic and its row is the truth; this is the optimistic mirror so the
 * scoring pad is right the instant the save lands. Mirrored in
 * Playhead.swift reanchorCutT0 — keep the two identical.
 */
export function reanchorCutT0(
  point: { cut_t0: number | null; t0: number | null; tight_start: boolean; tight_end: boolean },
  t0New: number,
  tightStartNew: boolean,
  pad: { pre: number; post: number }
): number | null {
  if (point.cut_t0 === null || point.t0 === null) return point.cut_t0;
  const effOld = effectivePad(pad, point.tight_start, point.tight_end).pre;
  const effNew = effectivePad(pad, tightStartNew, point.tight_end).pre;
  const anchorOld = Math.max(0, Number(point.t0) - effOld);
  const anchorNew = Math.max(0, t0New - effNew);
  return Math.max(
    0,
    Math.round((Number(point.cut_t0) + anchorNew - anchorOld) * 100) / 100
  );
}
