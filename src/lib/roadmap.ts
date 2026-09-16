/**
 * The roadmap's shape and the few rules its three surfaces share: the
 * public /roadmap page, the Roadmap tab on the feedback board, and the
 * admin page that edits it. Pure, so node --test can run it.
 */

export type RoadmapStage = "building" | "planned" | "shipped";

export type RoadmapItem = {
  id: string;
  title: string;
  description: string;
  stage: RoadmapStage;
  position: number;
  shipped_at: string | null;
  link: string | null;
  feedback_item_id: string | null;
  /** Sum of up and down votes. Meaningless once shipped. */
  score: number;
  created_at: string;
  updated_at: string;
};

/** How one person stands on an entry: for, against, or neither. */
export type RoadmapVote = -1 | 0 | 1;

/**
 * Votes are for what is still to come. A shipped entry is finished, and a
 * score under it reads as a review rather than a request.
 */
export function canVote(stage: RoadmapStage): boolean {
  return stage !== "shipped";
}

/**
 * What pressing an arrow does: the same arrow again takes the vote back,
 * the other arrow flips it. The database applies the same rule.
 */
export function nextVote(current: RoadmapVote, pressed: 1 | -1): RoadmapVote {
  return current === pressed ? 0 : pressed;
}

/** The score as it will read once the vote lands, for the optimistic step. */
export function adjustedScore(score: number, from: RoadmapVote, to: RoadmapVote): number {
  return score - from + to;
}

/** "+3", "0", "-2": a signed count, so a negative score reads as one. */
export function scoreLabel(score: number): string {
  return score > 0 ? `+${score}` : String(score);
}

/** The order the page reads in: what is happening now, then next, then done. */
export const STAGE_ORDER: RoadmapStage[] = ["building", "planned", "shipped"];

export const STAGE_LABEL: Record<RoadmapStage, string> = {
  building: "In development",
  planned: "Planned",
  shipped: "Shipped",
};

/** One colour per stage, the same as the board's status chips. */
export const STAGE_DOT: Record<RoadmapStage, string> = {
  building: "bg-amber-400",
  planned: "bg-sky-400",
  shipped: "bg-emerald-400",
};

export function isRoadmapStage(value: string): value is RoadmapStage {
  return value === "building" || value === "planned" || value === "shipped";
}

/**
 * Items grouped by stage in reading order, each stage sorted by position
 * then by age. Shipped is newest first: the top of that list is the
 * thing that just landed.
 */
export function groupRoadmap(
  items: RoadmapItem[]
): { stage: RoadmapStage; items: RoadmapItem[] }[] {
  return STAGE_ORDER.map((stage) => ({
    stage,
    items: items
      .filter((i) => i.stage === stage)
      .sort((a, b) => {
        if (stage === "shipped") {
          const da = a.shipped_at ?? "";
          const db = b.shipped_at ?? "";
          if (da !== db) return da < db ? 1 : -1;
        }
        if (a.position !== b.position) return a.position - b.position;
        return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
      }),
  })).filter((g) => g.items.length > 0);
}

/** "Sep 2026" from a date column. Month and year only: the day is noise. */
export function shippedLabel(shippedAt: string | null): string | null {
  if (!shippedAt) return null;
  const [y, m] = shippedAt.split("-").map(Number);
  if (!y || !m) return null;
  const date = new Date(Date.UTC(y, m - 1, 1));
  return date.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The next free slot at the end of a stage. */
export function nextPosition(items: RoadmapItem[], stage: RoadmapStage): number {
  const inStage = items.filter((i) => i.stage === stage);
  return inStage.length === 0 ? 1 : Math.max(...inStage.map((i) => i.position)) + 1;
}

/**
 * Swap an item with its neighbour within its stage. Returns the two rows
 * whose positions changed, or [] when the item is already at that end.
 */
export function moveWithinStage(
  items: RoadmapItem[],
  id: string,
  direction: "up" | "down"
): { id: string; position: number }[] {
  const item = items.find((i) => i.id === id);
  if (!item) return [];
  const group = groupRoadmap(items).find((g) => g.stage === item.stage)?.items ?? [];
  const index = group.findIndex((i) => i.id === id);
  const other = group[direction === "up" ? index - 1 : index + 1];
  if (!other) return [];
  // Positions may collide (two rows both 0); renumber the whole stage so
  // the swap is unambiguous.
  const renumbered = group.map((i, n) => ({ id: i.id, position: n + 1 }));
  const a = renumbered[index];
  const b = renumbered[direction === "up" ? index - 1 : index + 1];
  const swapped = renumbered.map((r) =>
    r.id === a.id ? { ...r, position: b.position } : r.id === b.id ? { ...r, position: a.position } : r
  );
  return swapped;
}
