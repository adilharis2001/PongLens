import { createClient } from "@/lib/supabase/client";
import type { Point } from "@/lib/types";
import { TIGHT_PAD, effectivePad } from "./clipEdit";
import type { ClipPad } from "./playhead";

/**
 * The RPC machinery behind the Modify modal's Split and Join, shared by the
 * Keep-score pad and the point view. One implementation of the marker→at_t
 * math and the split_point / merge_points sequences, so the two surfaces
 * can never disagree about what a split does to the data. Everything
 * host-specific — undo stacks, seeks, snackbars — stays in the host.
 */

/** A split at_t must sit this far inside the point on both edges (matches
 *  split_point's window and the modal's marker band). */
export const SPLIT_EDGE_S = 0.3;

export type Disposition = "user" | "opponent" | "skip";

/** What it takes to reverse one split_point call (unsplit_point args). */
export interface UnsplitRecord {
  parentId: string;
  childId: string;
  prevT1: number;
  prevTightEnd: boolean;
  prevEdited: boolean;
}

/**
 * Split ONE point into N segments at the given CUT-video marker times.
 * Markers map to SOURCE at_t through the span anchor (the cut keeps source
 * durations intact within the span, so one linear map covers the whole
 * original point), then split_point runs sequentially down the tail.
 *
 * `onChild` fires after each successful split with the parent's patch and
 * the new child row — the host mirrors both into its state immediately, so
 * a mid-sequence failure leaves the UI truthful. Returns what succeeded;
 * `ok: false` means the sequence stopped early (the returned unsplits still
 * describe the splits that DID land, newest first, for undo).
 */
export async function runSplitPlan({
  point,
  pad,
  cutTimes,
  onChild,
}: {
  point: Point;
  pad: ClipPad;
  cutTimes: number[];
  onChild: (parent: Point, patch: Partial<Point>, child: Point) => void;
}): Promise<{
  ok: boolean;
  created: Point[];
  unsplits: UnsplitRecord[];
}> {
  const A = point;
  if (A.cut_t0 === null || A.t0 === null || A.t1 === null) {
    return { ok: false, created: [], unsplits: [] };
  }
  const eff = effectivePad(pad, A.tight_start, A.tight_end);
  const cutT0 = Number(A.cut_t0);
  const t0 = Number(A.t0);
  const origT1 = Number(A.t1);
  const anchor = Math.max(0, t0 - eff.pre);

  // Markers (cut secs) → source at_t, sorted, clamped to a valid interior
  // split, kept >= SPLIT_EDGE_S apart (matches split_point's window).
  const raw = cutTimes.map((T) => anchor + (T - cutT0)).sort((a, b) => a - b);
  const ats: number[] = [];
  let floor = t0 + SPLIT_EDGE_S;
  const ceil = origT1 - SPLIT_EDGE_S;
  for (const a of raw) {
    const v = Math.round(Math.min(ceil, Math.max(floor, a)) * 100) / 100;
    if (v >= ceil) break; // no room for further cuts
    ats.push(v);
    floor = v + SPLIT_EDGE_S;
  }
  if (ats.length === 0) return { ok: false, created: [], unsplits: [] };

  const childCutT0Of = (at: number) =>
    Math.round((cutT0 + (at - Math.min(pad.pre, TIGHT_PAD)) - anchor) * 100) /
    100;

  const supabase = createClient();
  let curParent: Point = A;
  // child.tight_end inherits the ORIGINAL parent's tight_end; children are
  // born edited=true. Captured per split for a byte-exact unsplit.
  let curPrevTightEnd = A.tight_end;
  let curPrevEdited = A.edited;
  const created: Point[] = [];
  const unsplits: UnsplitRecord[] = [];

  for (const at of ats) {
    const { data, error } = await supabase.rpc("split_point", {
      p_id: curParent.id,
      at_t: at,
      child_cut_t0: childCutT0Of(at),
    });
    if (error || !data) {
      return { ok: false, created, unsplits: [...unsplits].reverse() };
    }
    const child = data as Point;
    onChild(curParent, { t1: at, edited: true, tight_end: true }, child);
    unsplits.push({
      parentId: curParent.id,
      childId: child.id,
      prevT1: origT1,
      prevTightEnd: curPrevTightEnd,
      prevEdited: curPrevEdited,
    });
    created.push(child);
    curParent = child; // the tail becomes the next split's parent
    curPrevTightEnd = A.tight_end;
    curPrevEdited = true;
  }
  return { ok: true, created, unsplits: [...unsplits].reverse() };
}

/**
 * Join this point with the next `count` visible points. merge_points keeps
 * the survivor (this point), grows its t1 to the last point's t1, clears
 * tight_end, hard-deletes the rest — which is why Join is the one Modify
 * action that cannot be undone. Returns null on failure or when there
 * aren't enough points after this one.
 */
export async function runJoinPlan({
  point,
  points,
  count,
}: {
  point: Point;
  points: Point[];
  count: number;
}): Promise<{
  survivor: Point;
  survivorPatch: Partial<Point>;
  mergedIds: string[];
} | null> {
  const i = points.findIndex((p) => p.id === point.id);
  if (i < 0) return null;
  const nexts = points
    .slice(i + 1)
    .filter((p) => p.cut_t0 !== null && p.t1 !== null)
    .slice(0, count);
  if (nexts.length < count) return null;
  const A = points[i];
  const ids = [A.id, ...nexts.map((p) => p.id)];

  const supabase = createClient();
  const { data, error } = await supabase.rpc("merge_points", { p_ids: ids });
  if (error || !data) return null;
  const survivor = data as Point;
  return {
    survivor,
    survivorPatch: {
      t1: survivor.t1 === null ? A.t1 : Number(survivor.t1),
      tight_end: false,
      edited: true,
    },
    mergedIds: nexts.map((p) => p.id),
  };
}

/**
 * The Adjust save: new t0/t1, with a manually re-timed split-boundary edge
 * dissolving its tight flag so the reclip pads the moved edge with full
 * strictness context again. Pure patch builder — the host owns the write,
 * the optimistic mirror, and the reclip schedule.
 */
export function adjustPatch(
  point: Point,
  t0New: number,
  t1New: number
): Partial<Point> {
  const patch: Partial<Point> = { t0: t0New, t1: t1New };
  if (point.tight_start && t0New !== Number(point.t0)) patch.tight_start = false;
  if (point.tight_end && t1New !== Number(point.t1)) patch.tight_end = false;
  return patch;
}
