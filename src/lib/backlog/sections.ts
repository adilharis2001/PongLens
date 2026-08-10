import { addDays, daysBetween, endOfWeek } from "./schedule.ts";
import type { BacklogItem } from "./types.ts";

/**
 * Sections: when a thing is meant to happen, as somewhere you put it
 * rather than a question you answer.
 *
 * Capture asks nothing. Everything lands in Someday, and scheduling is a
 * later, separate act — drag the card into Today, or Next week. That
 * keeps writing an idea down to one gesture, which is the only thing that
 * decides whether a backlog gets used.
 *
 * Sections are DERIVED from target_date rather than stored, so there is
 * one source of truth about when something is meant to happen and the
 * sections re-bucket themselves as days pass: a card dropped in Tomorrow
 * is in Today when you next open the page, and then Overdue, without
 * anything having to run.
 *
 * Two sections are conditional, and both exist so that no row can ever be
 * invisible. Overdue catches dates that have gone past; Later catches
 * dates beyond next week, which the current UI cannot create but older
 * rows may still carry.
 */

export type SectionKey =
  | "overdue"
  | "today"
  | "tomorrow"
  | "this_week"
  | "next_week"
  | "later"
  | "someday";

export interface Section {
  key: SectionKey;
  label: string;
  /** Shown only when it has something in it. */
  conditional: boolean;
  /** Can a card be dropped here? Later has no single date to mean. */
  droppable: boolean;
}

const ALL: Section[] = [
  { key: "overdue", label: "Overdue", conditional: true, droppable: false },
  { key: "today", label: "Today", conditional: false, droppable: true },
  { key: "tomorrow", label: "Tomorrow", conditional: false, droppable: true },
  { key: "this_week", label: "This week", conditional: false, droppable: true },
  { key: "next_week", label: "Next week", conditional: false, droppable: true },
  { key: "later", label: "Later", conditional: true, droppable: false },
  { key: "someday", label: "Someday", conditional: false, droppable: true },
];

/**
 * Which sections to render today.
 *
 * "This week" disappears on the last two days of a week, because by then
 * the rest of the week IS tomorrow and a section that can only hold what
 * the one above it already holds is a section that lies about being a
 * choice.
 */
export function visibleSections(
  items: BacklogItem[],
  today: string,
): Section[] {
  const counts = new Map<SectionKey, number>();
  for (const item of items) {
    const key = sectionForDate(item.target_date, today);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const weekHasRoom = daysBetween(today, endOfWeek(today)) > 1;
  return ALL.filter((section) => {
    if (section.key === "this_week" && !weekHasRoom) {
      return (counts.get("this_week") ?? 0) > 0;
    }
    if (section.conditional) return (counts.get(section.key) ?? 0) > 0;
    return true;
  });
}

/** Sections a card can actually be dropped into, for the editor picker. */
export function droppableSections(today: string): Section[] {
  const weekHasRoom = daysBetween(today, endOfWeek(today)) > 1;
  return ALL.filter(
    (s) => s.droppable && (s.key !== "this_week" || weekHasRoom),
  );
}

/** Which section an item belongs in. Every date lands in exactly one. */
export function sectionForDate(
  target: string | null,
  today: string,
): SectionKey {
  if (!target) return "someday";
  if (target < today) return "overdue";
  if (target === today) return "today";
  if (target === addDays(today, 1)) return "tomorrow";
  if (target <= endOfWeek(today)) return "this_week";
  if (target <= addDays(endOfWeek(today), 7)) return "next_week";
  return "later";
}

/**
 * The date a section means. Dropping into a section writes this.
 *
 * "This week" is the end of the current week and "Next week" is the
 * Monday after it — the near edge of next week rather than its end,
 * because a thing put in next week should surface at the start of it.
 */
export function dateForSection(
  key: SectionKey,
  today: string,
): string | null {
  switch (key) {
    case "someday":
    case "later":
    case "overdue":
      return null;
    case "today":
      return today;
    case "tomorrow":
      return addDays(today, 1);
    case "this_week":
      return endOfWeek(today);
    case "next_week": {
      // Normally the Monday, so the thing surfaces at the start of the
      // week. On a Sunday that Monday is also Tomorrow, and Tomorrow
      // claims the date first — a card dropped into Next week would
      // visibly jump into Tomorrow instead. Step one day further so it
      // stays where it was put.
      const monday = addDays(endOfWeek(today), 1);
      return monday === addDays(today, 1) ? addDays(monday, 1) : monday;
    }
  }
}

/** Items in a section, in priority order: lowest sort first. */
export function itemsInSection(
  items: BacklogItem[],
  key: SectionKey,
  today: string,
): BacklogItem[] {
  return items
    .filter((i) => sectionForDate(i.target_date, today) === key)
    .sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));
}

// ---------------------------------------------------------------------------
// Sort keys
// ---------------------------------------------------------------------------

/** Below this, two neighbours are too close to keep halving safely. */
const MIN_GAP = 1e-6;

/** A new capture goes to the top of Someday: what you just typed is what
 *  you want to see, not something buried under a year of ideas. */
export function sortForTop(sectionItems: BacklogItem[]): number {
  if (sectionItems.length === 0) return 0;
  return sectionItems[0].sort - 1;
}

/** Dropping into a section without aiming at a card appends to the end:
 *  "put this here" says where, not how urgent. */
export function sortForBottom(sectionItems: BacklogItem[]): number {
  if (sectionItems.length === 0) return 0;
  return sectionItems[sectionItems.length - 1].sort + 1;
}

/**
 * The sort that puts a card immediately above `beforeId`, taking its slot
 * and pushing it down. Null means the gap has closed and the section
 * needs renumbering first.
 */
export function sortBefore(
  sectionItems: BacklogItem[],
  beforeId: string,
): number | null {
  const index = sectionItems.findIndex((i) => i.id === beforeId);
  if (index === -1) return null;
  const target = sectionItems[index].sort;
  if (index === 0) return target - 1;
  const previous = sectionItems[index - 1].sort;
  if (target - previous < MIN_GAP) return null;
  return previous + (target - previous) / 2;
}

/**
 * Whole-number sorts for a section whose gaps have collapsed. Rare and
 * local: one section, one pass, and only when a midpoint could not be
 * found.
 */
export function renumber(
  sectionItems: BacklogItem[],
): { id: string; sort: number }[] {
  return sectionItems.map((item, index) => ({ id: item.id, sort: index }));
}
