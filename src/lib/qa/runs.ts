/**
 * Marking a test case run, and the trick that makes a weekly reset need no
 * cron job.
 *
 * A result is stored against a *period* rather than against the case
 * alone. When the period rolls over, last week's marks are still there
 * and simply no longer answer the question "has this been run", because
 * the question is now being asked about a different period. Nothing has
 * to run at midnight on Monday, nothing can fail to run, and the history
 * is kept rather than wiped.
 *
 * Which period a case belongs to comes from its cadence:
 *
 *   Every release, Weekly  ->  the ISO week
 *   Once                   ->  "once", so it never comes back
 *
 * The release set resets weekly too rather than per deploy. Per deploy is
 * literally what "every release" means, but this project ships several
 * times a day, and a checklist that empties itself hourly is one nobody
 * fills in.
 */

import type { TestDepth } from "./testLibrary.ts";

export type RunStatus = "pass" | "fail" | "blocked" | "skipped";

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  blocked: "Blocked",
  skipped: "Skipped",
};

export interface CaseResult {
  case_id: string;
  period: string;
  status: RunStatus;
  note: string;
  marked_by: string;
  updated_at: string;
}

/**
 * ISO-8601 week. Weeks start Monday, and week 1 is the one holding the
 * first Thursday, which is why this is not just "day of year over seven":
 * the first days of January often belong to the previous year's last week.
 */
export function isoWeek(date: Date): string {
  // Work in UTC so the label does not shift with the viewer's timezone.
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // Thursday of this week decides the year the week belongs to.
  const day = d.getUTCDay() || 7; // Sunday is 7, not 0
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The period a case of this cadence is currently being tracked against. */
export function periodFor(depth: TestDepth, now: Date): string {
  return depth === "edge" ? "once" : `week:${isoWeek(now)}`;
}

/** How the current period reads in the UI. */
export function periodLabel(depth: TestDepth, now: Date): string {
  return depth === "edge" ? "all time" : `week ${isoWeek(now)}`;
}

/**
 * Results keyed by case id, keeping only those for the period each case is
 * currently tracked against. A row from last week is simply not returned,
 * which is the whole reset.
 */
export function currentResults(
  results: CaseResult[],
  depthById: Map<string, TestDepth>,
  now: Date,
): Map<string, CaseResult> {
  const out = new Map<string, CaseResult>();
  for (const result of results) {
    const depth = depthById.get(result.case_id);
    if (!depth) continue; // a case that has since been renamed or removed
    if (result.period !== periodFor(depth, now)) continue;
    out.set(result.case_id, result);
  }
  return out;
}

export interface RunProgress {
  total: number;
  run: number;
  passed: number;
  failed: number;
}

export function progressFor(
  caseIds: string[],
  results: Map<string, CaseResult>,
): RunProgress {
  let run = 0;
  let passed = 0;
  let failed = 0;
  for (const id of caseIds) {
    const result = results.get(id);
    if (!result) continue;
    run += 1;
    if (result.status === "pass") passed += 1;
    if (result.status === "fail") failed += 1;
  }
  return { total: caseIds.length, run, passed, failed };
}
