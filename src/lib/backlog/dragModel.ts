import type { BacklogBlocker } from "./blockers.ts";
import { sectionForDate, type SectionKey } from "./sections.ts";
import type { BacklogItem } from "./types.ts";

/**
 * What a drop means.
 *
 * One gesture, one meaning: a card's POSITION is its priority, so
 * dropping on a card takes that slot and pushes it down, and dropping
 * anywhere else in a section moves it there and puts it at the end.
 * Dropping across sections does both at once — the card lands in the new
 * section, in the slot you aimed at.
 *
 * Dependencies are deliberately NOT a drop any more. Two meanings on one
 * gesture meant aiming at a card centre versus a gap on a phone, and
 * ordering is the thing done constantly while "what has to come first" is
 * occasional — so ordering gets the gesture and dependencies get the
 * editor.
 */

export type DropTarget =
  | { kind: "section"; section: SectionKey }
  | { kind: "item"; id: string };

export type DropOutcome =
  | { kind: "append"; section: SectionKey }
  | { kind: "before"; section: SectionKey; beforeId: string };

export interface DropVerdict {
  outcome: DropOutcome | null;
  /** Shown on the hovered target while dragging. Present even when the
   *  drop is refused, because "why not" is the useful half. */
  hint: string;
  allowed: boolean;
}

export function dropVerdict(
  draggedId: string,
  target: DropTarget | null,
  items: BacklogItem[],
  today: string,
): DropVerdict {
  const dragged = items.find((i) => i.id === draggedId);
  if (!dragged || !target) {
    return { outcome: null, hint: "", allowed: false };
  }
  const from = sectionForDate(dragged.target_date, today);

  if (target.kind === "section") {
    if (from === target.section) {
      // Not refused so much as pointless: the card is already here, and
      // appending it to the end of its own section would silently demote
      // it. Aim at a card to say where.
      return { outcome: null, hint: "Already here", allowed: false };
    }
    return {
      outcome: { kind: "append", section: target.section },
      hint: "Drop to move here",
      allowed: true,
    };
  }

  if (target.id === draggedId) {
    return { outcome: null, hint: "", allowed: false };
  }
  const onto = items.find((i) => i.id === target.id);
  if (!onto) return { outcome: null, hint: "", allowed: false };

  const section = sectionForDate(onto.target_date, today);
  return {
    outcome: { kind: "before", section, beforeId: onto.id },
    hint: section === from ? "Move above this" : "Put it here",
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
