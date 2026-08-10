/**
 * Calendar arithmetic for the backlog, on plain YYYY-MM-DD strings.
 *
 * Everything takes `today` as an argument instead of reading the clock,
 * so the module is pure and the tests do not have to mock time. The page
 * reads the clock once, at the top, and passes it down.
 *
 * Strings rather than Date objects because target_date is a Postgres
 * `date`: a calendar day, with no time and no zone. Round-tripping that
 * through a Date is exactly how a task dated Monday starts rendering on
 * Sunday for anyone west of UTC. Parsing happens at UTC noon internally
 * so day arithmetic can never be shifted by a daylight-saving jump.
 *
 * Weeks start Monday, because "next week" in a working list means the
 * next working Monday, not the next Sunday.
 *
 * The when-picker vocabulary and the horizontal timeline columns that
 * used to live here are gone (091): the list is grouped by section now,
 * and sections.ts owns that. This file is date maths and nothing else.
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

/** "Feb 23" — used where an exact day is worth naming. */
export function monthDay(iso: string): string {
  return parse(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
