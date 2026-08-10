import type { BacklogItem } from "./types.ts";

/**
 * "What has to come first" — the graph, and every question the page asks
 * of it. Pure and dependency-free so the whole thing is testable without
 * a database or a browser.
 *
 * The rule the UI is built on: an item is BLOCKED while any item it waits
 * on is not done. Done blockers are simply satisfied and stop counting,
 * so ticking the last one makes the dependent startable with no extra
 * bookkeeping and no state to get out of sync.
 */

export interface BacklogBlocker {
  item_id: string;
  blocker_id: string;
}

/** item id -> the ids it waits on. */
export function blockerMap(edges: BacklogBlocker[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const list = map.get(edge.item_id);
    if (list) list.push(edge.blocker_id);
    else map.set(edge.item_id, [edge.blocker_id]);
  }
  return map;
}

/**
 * The blockers of `id` that are still outstanding, in the given item
 * order. Edges pointing at an item that no longer exists are ignored
 * rather than treated as blocking — a deleted blocker cannot be waited
 * on, and the row is gone by cascade anyway.
 */
export function pendingBlockers(
  id: string,
  edges: BacklogBlocker[],
  byId: Map<string, BacklogItem>,
): BacklogItem[] {
  const out: BacklogItem[] = [];
  for (const edge of edges) {
    if (edge.item_id !== id) continue;
    const blocker = byId.get(edge.blocker_id);
    if (blocker && blocker.lane !== "done") out.push(blocker);
  }
  return out;
}

/** Every item that cannot be started yet. */
export function blockedIds(
  items: BacklogItem[],
  edges: BacklogBlocker[],
): Set<string> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const blocked = new Set<string>();
  for (const edge of edges) {
    const blocker = byId.get(edge.blocker_id);
    if (!byId.has(edge.item_id)) continue;
    if (blocker && blocker.lane !== "done") blocked.add(edge.item_id);
  }
  return blocked;
}

/**
 * A lane, split into what you can pick up now and what is waiting. Order
 * within each half is the caller's existing order, so the date sort is
 * preserved and blocking only ever moves an item down, never past
 * something else that is also waiting.
 */
export function splitByReadiness<T extends { id: string }>(
  laneItems: T[],
  blocked: Set<string>,
): { startable: T[]; waiting: T[] } {
  const startable: T[] = [];
  const waiting: T[] = [];
  for (const item of laneItems) {
    (blocked.has(item.id) ? waiting : startable).push(item);
  }
  return { startable, waiting };
}

/**
 * Would making `itemId` wait on `candidateId` close a loop?
 *
 * The database refuses these outright (migration 090), but the picker
 * filters them out first: an option that always errors is not an option,
 * and "that would make two items wait on each other" is a worse way to
 * learn it than simply not being offered the row.
 */
export function wouldCycle(
  edges: BacklogBlocker[],
  itemId: string,
  candidateId: string,
): boolean {
  if (itemId === candidateId) return true;
  const map = blockerMap(edges);
  const seen = new Set<string>();
  const stack = [candidateId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === itemId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of map.get(current) ?? []) stack.push(next);
  }
  return false;
}

/**
 * The items a picker may offer as a prerequisite for `itemId`: every
 * other item that is not already a blocker and would not close a loop.
 * Done items stay eligible — recording that something waited on work
 * already finished is legitimate history, and it simply reads as
 * satisfied.
 */
export function eligibleBlockers(
  itemId: string,
  items: BacklogItem[],
  edges: BacklogBlocker[],
): BacklogItem[] {
  const existing = new Set(
    edges.filter((e) => e.item_id === itemId).map((e) => e.blocker_id),
  );
  return items.filter(
    (candidate) =>
      candidate.id !== itemId &&
      !existing.has(candidate.id) &&
      !wouldCycle(edges, itemId, candidate.id),
  );
}

/**
 * Items that were blocked before and are startable now — what ticking
 * something just released. The page names them in one line, because the
 * whole reward for recording a dependency is finding out the moment it
 * stops mattering.
 */
export function newlyStartable(
  before: Set<string>,
  after: Set<string>,
): string[] {
  return [...before].filter((id) => !after.has(id));
}

/**
 * The chip on a waiting card. One blocker is named outright, because the
 * name is the useful part; several would not fit a phone, so they are
 * counted and the editor lists them.
 */
export function waitingLabel(blockers: BacklogItem[]): string | null {
  if (blockers.length === 0) return null;
  if (blockers.length === 1) return `after ${blockers[0].title}`;
  return `after ${blockers.length} others`;
}

/**
 * A dependency that the dates contradict: this item is scheduled on or
 * before something it waits on. Worth surfacing because the timeline is
 * the one place the contradiction is visible, and a plan that cannot
 * happen in the order it is drawn is worth one amber word.
 */
export function scheduleConflict(
  item: BacklogItem,
  blockers: BacklogItem[],
): boolean {
  if (!item.target_date) return false;
  return blockers.some(
    (b) => b.target_date !== null && b.target_date >= item.target_date!,
  );
}
