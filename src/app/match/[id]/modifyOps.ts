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
/** Which way a Join reaches: into the points before this one, or after. */
export type JoinDirection = "prev" | "next";

/**
 * The points a Join in `direction` would swallow, nearest first, at most
 * two. Shared by the sheet (to size the stepper and the preview) and the
 * plan (to build the merge), so the two can never disagree about which
 * rows are on the table.
 */
export function joinNeighbours(
  point: Point,
  points: Point[],
  direction: JoinDirection
): Point[] {
  const i = points.findIndex((p) => p.id === point.id);
  if (i < 0) return [];
  const ok = (p: Point) => p.cut_t0 !== null && p.t0 !== null && p.t1 !== null;
  if (direction === "next") return points.slice(i + 1).filter(ok).slice(0, 2);
  return points.slice(0, i).filter(ok).slice(-2).reverse();
}

export async function runJoinPlan({
  point,
  points,
  count,
  direction = "next",
}: {
  point: Point;
  points: Point[];
  count: number;
  direction?: JoinDirection;
}): Promise<{
  survivor: Point;
  survivorPatch: Partial<Point>;
  mergedIds: string[];
  /** The last point of the merged run on the timeline — what a landing
   *  "after the join" is measured from. */
  lastId: string;
} | null> {
  const neighbours = joinNeighbours(point, points, direction).slice(0, count);
  if (neighbours.length < count) return null;
  const A = points.find((p) => p.id === point.id);
  if (!A) return null;
  // merge_points keeps the FIRST id as the survivor, so the ids go in
  // timeline order: joining backwards makes the earliest neighbour the
  // survivor and this point one of the rows that disappear.
  const run =
    direction === "next"
      ? [A, ...neighbours]
      : [...neighbours].reverse().concat(A);
  const ids = run.map((p) => p.id);

  const supabase = createClient();
  const { data, error } = await supabase.rpc("merge_points", { p_ids: ids });
  if (error || !data) return null;
  const survivor = data as Point;
  return {
    survivor,
    survivorPatch: {
      t1: survivor.t1 === null ? run[0].t1 : Number(survivor.t1),
      tight_end: false,
      edited: true,
    },
    mergedIds: ids.slice(1),
    lastId: ids[ids.length - 1],
  };
}

/**
 * What the undo path hands back to an Adjust so the reverse write restores
 * exactly what the forward write changed: the tight flags the forward save
 * may have dissolved, and the observed endings it cleared when the end
 * moved (adjust_point nulls scored_at_cut_s / rally_end_cut_s on an end
 * move, because a player who extended the end has overruled them).
 */
export interface AdjustRestore {
  tight_start: boolean;
  tight_end: boolean;
  scored_at_cut_s?: number | null;
  rally_end_cut_s?: number | null;
}

/**
 * The Adjust save's tight-flag rule: a manually re-timed split-boundary
 * edge dissolves its tight flag so the re-cut pads the moved edge with full
 * strictness context again. Pure — the host owns the write (adjust_point)
 * and the optimistic mirror; the database re-anchors cut_t0 and the host
 * mirrors that with reanchorCutT0 so the pad is right before the row
 * comes back.
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
