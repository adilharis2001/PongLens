import { wouldCycle, type BacklogBlocker } from "./blockers.ts";
import type { BacklogItem, BacklogLane } from "./types.ts";

/**
 * What a drop means, and whether it is allowed.
 *
 * Two drop targets with two different meanings, so the rule has to be
 * unambiguous: a CARD means "this one comes first", anywhere else inside
 * a lane means "move to this lane". Cards are the only exception inside a
 * lane, which is what keeps it learnable — you are either on a card or
 * you are not.
 *
 * Kept pure and out of the pointer handling so the meaning of a drop can
 * be tested without simulating a gesture.
 */

export type DropTarget =
  | { kind: "lane"; lane: BacklogLane }
  | { kind: "item"; id: string };

export type DropOutcome =
  | { kind: "lane"; lane: BacklogLane }
  | { kind: "depend"; itemId: string; blockerId: string };

export interface DropVerdict {
  outcome: DropOutcome | null;
  /** Shown on the hovered target while dragging. Present even when the
   *  drop is refused, because "why not" is the useful half. */
  hint: string;
  allowed: boolean;
}

/**
 * Resolve a hovered target into what would happen, or why it would not.
 *
 * Refusals are worked out here rather than left to the database so the
 * card can say no BEFORE the finger lifts. A drop that lands and then
 * silently does nothing is the worst outcome of the three.
 */
export function dropVerdict(
  draggedId: string,
  target: DropTarget | null,
  items: BacklogItem[],
  edges: BacklogBlocker[],
): DropVerdict {
  const dragged = items.find((i) => i.id === draggedId);
  if (!dragged || !target) {
    return { outcome: null, hint: "", allowed: false };
  }

  if (target.kind === "lane") {
    if (dragged.lane === target.lane) {
      return { outcome: null, hint: "Already here", allowed: false };
    }
    return {
      outcome: { kind: "lane", lane: target.lane },
      hint: `Move to ${target.lane}`,
      allowed: true,
    };
  }

  if (target.id === draggedId) {
    return { outcome: null, hint: "", allowed: false };
  }

  const blocker = items.find((i) => i.id === target.id);
  if (!blocker) return { outcome: null, hint: "", allowed: false };

  const already = edges.some(
    (e) => e.item_id === draggedId && e.blocker_id === target.id,
  );
  if (already) {
    return { outcome: null, hint: "Already waits on this", allowed: false };
  }

  if (wouldCycle(edges, draggedId, target.id)) {
    return {
      outcome: null,
      hint: "That would make a loop",
      allowed: false,
    };
  }

  return {
    outcome: { kind: "depend", itemId: draggedId, blockerId: target.id },
    hint: "Needs this first",
    allowed: true,
  };
}

/**
 * Lay dependency lines out in the side gutter without letting any two
 * share a track.
 *
 * Greedy interval packing: lines are sorted by where they start, and each
 * takes the leftmost track whose previous occupant has already finished
 * above it. Two lines only share a track when their vertical spans do not
 * touch, so nothing ever draws over anything else — which is the whole
 * point of putting them in a gutter rather than across the cards.
 */
export interface LineSpan {
  key: string;
  top: number;
  bottom: number;
}

export function packLines(spans: LineSpan[]): Map<string, number> {
  const ordered = [...spans].sort(
    (a, b) => a.top - b.top || a.bottom - b.bottom,
  );
  /** The lowest y each track is free from. */
  const trackFreeFrom: number[] = [];
  const columns = new Map<string, number>();

  for (const span of ordered) {
    let track = trackFreeFrom.findIndex((freeFrom) => freeFrom <= span.top);
    if (track === -1) {
      track = trackFreeFrom.length;
      trackFreeFrom.push(0);
    }
    trackFreeFrom[track] = span.bottom;
    columns.set(span.key, track);
  }
  return columns;
}

/** A line's endpoints, in coordinates relative to the list container. */
export interface LineGeometry {
  key: string;
  /** The prerequisite: where the line starts. */
  fromY: number;
  /** The dependent: where the line ends, with the arrow. */
  toY: number;
  track: number;
  /** The blocker sits below the item that waits on it — the line runs
   *  upward, which is worth drawing differently from the common case. */
  upward: boolean;
}

/**
 * Turn measured card positions into drawable lines. Only edges where BOTH
 * ends are currently on screen produce a line; a dependency whose other
 * end is filtered out or collapsed has nothing to connect to, and half a
 * line pointing into space reads as a bug.
 */
export function lineGeometry(
  edges: BacklogBlocker[],
  centers: Map<string, { top: number; bottom: number; center: number }>,
): LineGeometry[] {
  const drawable = edges.filter(
    (e) => centers.has(e.item_id) && centers.has(e.blocker_id),
  );
  const spans: LineSpan[] = drawable.map((e) => {
    const a = centers.get(e.item_id)!.center;
    const b = centers.get(e.blocker_id)!.center;
    return {
      key: `${e.item_id}:${e.blocker_id}`,
      top: Math.min(a, b),
      bottom: Math.max(a, b),
    };
  });
  const tracks = packLines(spans);

  return drawable.map((e) => {
    const from = centers.get(e.blocker_id)!.center;
    const to = centers.get(e.item_id)!.center;
    const key = `${e.item_id}:${e.blocker_id}`;
    return {
      key,
      fromY: from,
      toY: to,
      track: tracks.get(key) ?? 0,
      upward: to < from,
    };
  });
}
