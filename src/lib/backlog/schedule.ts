import type { BacklogItem } from "./types.ts";

/**
 * Dates for the backlog, as plain YYYY-MM-DD strings.
 *
 * Everything here takes `today` as an argument instead of reading the
 * clock, so the whole module is pure and the tests do not have to mock
 * time. The page reads the clock once, at the top, and passes it down.
 *
 * Strings rather than Date objects because target_date is a Postgres
 * `date`: a calendar day, with no time and no zone. Round-tripping that
 * through a Date is exactly how a task dated Monday starts rendering on
 * Sunday for anyone west of UTC. Parsing happens at UTC noon internally
 * so day arithmetic can never be shifted by a daylight-saving jump.
 *
 * Weeks start Monday, because "next week" in a working list means the
 * next working Monday, not the next Sunday.
 */

function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function fmt(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today as YYYY-MM-DD in the viewer's own zone, not UTC. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number): string {
  const date = parse(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return fmt(date);
}

/** 0 = Monday … 6 = Sunday. */
function weekdayIndex(iso: string): number {
  return (parse(iso).getUTCDay() + 6) % 7;
}

export function startOfWeek(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}

export function endOfWeek(iso: string): string {
  return addDays(iso, 6 - weekdayIndex(iso));
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (parse(to).getTime() - parse(from).getTime()) / 86_400_000,
  );
}

/**
 * The whole "when" vocabulary. Deliberately short: six choices you can
 * hit without thinking, plus an exact date for the rare thing that has a
 * real deadline. Anything longer than this and dating an item becomes a
 * decision, which is the thing that stops people capturing.
 */
export type WhenKey =
  | "someday"
  | "today"
  | "tomorrow"
  | "this_week"
  | "next_week"
  | "two_weeks"
  | "further";

export const WHEN_CHOICES: { key: WhenKey; label: string }[] = [
  { key: "someday", label: "Someday" },
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "this_week", label: "This week" },
  { key: "next_week", label: "Next week" },
  { key: "two_weeks", label: "In 2 weeks" },
  { key: "further", label: "Further out" },
];

/**
 * Resolve a relative choice to a stored date.
 *
 * "This week" means the end of the current week, except on the last day
 * of it, when the end of the week has already arrived and today is the
 * honest answer.
 */
export function dateForWhen(when: WhenKey, today: string): string | null {
  switch (when) {
    case "someday":
      return null;
    case "today":
      return today;
    case "tomorrow":
      return addDays(today, 1);
    case "this_week": {
      const end = endOfWeek(today);
      return daysBetween(today, end) <= 0 ? today : end;
    }
    case "next_week":
      return addDays(startOfWeek(today), 7);
    case "two_weeks":
      return addDays(startOfWeek(today), 14);
    case "further":
      return addDays(startOfWeek(today), 28);
  }
}

function monthDay(iso: string): string {
  return parse(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function weekdayName(iso: string): string {
  return parse(iso).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
}

/**
 * The short label on an item's date chip. Relative near the front, where
 * relative is what you think in, and absolute further out, where "in 23
 * days" is not a thing anyone can picture.
 */
export function whenLabel(target: string | null, today: string): string {
  if (!target) return "Someday";
  const delta = daysBetween(today, target);
  if (delta < 0) return "Overdue";
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (target <= endOfWeek(today)) return weekdayName(target);
  if (target <= addDays(endOfWeek(today), 7)) return "Next week";
  return monthDay(target);
}

export type ColumnKind = "someday" | "overdue" | "day" | "week" | "beyond";

export interface TimelineColumn {
  key: string;
  label: string;
  /** The dates the column covers, spelled out under the label. */
  sub: string | null;
  kind: ColumnKind;
  /** Inclusive bounds; null on the unbounded and undated columns. */
  from: string | null;
  to: string | null;
  items: BacklogItem[];
}

/** How many week columns follow the day columns before "Later" absorbs
 *  the rest. Three keeps the scroll finite while still covering the
 *  month that "Further out" lands in. */
const WEEK_COLUMNS = 3;

/**
 * Lay the items out along the horizontal scale.
 *
 * The scale is deliberately uneven, because attention is: the next few
 * days get a column each, the weeks after that get one column each, and
 * everything beyond the month collapses into a single "Later". A uniform
 * scale would spend the same width on next March as on tomorrow.
 *
 * Today and Tomorrow always get a column even on a Sunday, so every
 * choice in WHEN_CHOICES always has somewhere visible to land. The first
 * week column starts the day after the last day column, so a date can
 * never fall in two columns.
 */
export function timelineColumns(
  items: BacklogItem[],
  today: string,
): TimelineColumn[] {
  const columns: TimelineColumn[] = [];
  const push = (c: Omit<TimelineColumn, "items">) =>
    columns.push({ ...c, items: [] });

  push({
    key: "someday",
    label: "Someday",
    sub: "No date",
    kind: "someday",
    from: null,
    to: null,
  });

  const hasOverdue = items.some(
    (i) => i.target_date !== null && i.target_date < today,
  );
  if (hasOverdue) {
    push({
      key: "overdue",
      label: "Overdue",
      sub: "Past their date",
      kind: "overdue",
      from: null,
      to: addDays(today, -1),
    });
  }

  // Day columns: today, tomorrow, then the rest of this week.
  const lastDay =
    daysBetween(today, endOfWeek(today)) >= 1
      ? endOfWeek(today)
      : addDays(today, 1);
  for (let d = today; d <= lastDay; d = addDays(d, 1)) {
    const delta = daysBetween(today, d);
    push({
      key: `day-${d}`,
      label: delta === 0 ? "Today" : delta === 1 ? "Tomorrow" : weekdayName(d),
      sub: monthDay(d),
      kind: "day",
      from: d,
      to: d,
    });
  }

  let cursor = addDays(lastDay, 1);
  for (let i = 0; i < WEEK_COLUMNS; i++) {
    const end = endOfWeek(cursor);
    push({
      key: `week-${cursor}`,
      label: i === 0 ? "Next week" : `Week of ${monthDay(cursor)}`,
      sub: `${monthDay(cursor)} – ${monthDay(end)}`,
      kind: "week",
      from: cursor,
      to: end,
    });
    cursor = addDays(end, 1);
  }

  push({
    key: "beyond",
    label: "Later",
    sub: `After ${monthDay(addDays(cursor, -1))}`,
    kind: "beyond",
    from: cursor,
    to: null,
  });

  for (const item of items) {
    const column = columns.find((c) => columnAccepts(c, item.target_date));
    if (column) column.items.push(item);
  }
  for (const column of columns) column.items.sort(compareForBoard);
  return columns;
}

function columnAccepts(column: TimelineColumn, date: string | null): boolean {
  if (column.kind === "someday") return date === null;
  if (date === null) return false;
  if (column.from !== null && date < column.from) return false;
  if (column.to !== null && date > column.to) return false;
  return true;
}

/** The order inside any group: dated before undated, soonest first, then
 *  newest first. No drag handles anywhere — the date is the ordering. */
export function compareForBoard(a: BacklogItem, b: BacklogItem): number {
  if (a.target_date !== b.target_date) {
    if (a.target_date === null) return 1;
    if (b.target_date === null) return -1;
    return a.target_date < b.target_date ? -1 : 1;
  }
  return b.created_at.localeCompare(a.created_at);
}
