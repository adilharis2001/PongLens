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
 *
 * Since 142 a result is also stored against a *surface*. The same case in
 * the same week carries a separate answer on the site at desktop width, on
 * the site on a phone, and in the app, because those are separate layouts
 * and separate builds and a pass on one proves nothing about the others.
 * Every function below that answers "how are we doing" therefore takes a
 * surface; the one that does not is latestPerSurface, whose whole job is
 * to compare them.
 */

import { TEST_SURFACES, type TestDepth, type TestSurface } from "./testLibrary.ts";

export type RunStatus = "pass" | "fail" | "blocked" | "skipped";

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  blocked: "Blocked",
  skipped: "Skipped",
};

/** For reporting what already happened somewhere else, in a sentence. */
export const RUN_STATUS_PAST: Record<RunStatus, string> = {
  pass: "passed",
  fail: "failed",
  blocked: "blocked",
  skipped: "skipped",
};

export interface CaseResult {
  case_id: string;
  period: string;
  /** Where it was run. Part of the key since 142, so four can coexist. */
  surface: TestSurface;
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
  surface: TestSurface,
): Map<string, CaseResult> {
  const out = new Map<string, CaseResult>();
  for (const result of results) {
    if (result.surface !== surface) continue;
    const depth = depthById.get(result.case_id);
    if (!depth) continue; // a case that has since been renamed or removed
    if (result.period !== periodFor(depth, now)) continue;
    out.set(result.case_id, result);
  }
  return out;
}

/**
 * What a case's last mark was, whatever period it belongs to, plus the two
 * facts that decide how it should read.
 *
 * The period reset was hiding the mark entirely, and that turned out to be
 * the wrong thing to do to a person. A weekly sweep is a fine question to
 * ask, but the tester working through the list is not asking it — they are
 * asking "have I already done this one", and on the Monday the ISO week
 * rolled over, twenty-nine answers to that question vanished overnight
 * while they were midway through, having deliberately skipped some to come
 * back to. Nothing was deleted; it simply stopped being shown.
 *
 * So the mark is always shown now, and `current` says whether it counts
 * for this period. The sweep question survives in progressFor and the
 * "not run" filter, which still read the current period alone.
 */
export interface CaseStanding {
  result: CaseResult;
  /** Marked within the period this case is currently tracked against. */
  current: boolean;
  /**
   * A bug this case found has since been fixed, and the fix landed after
   * the mark. The case is stale in the way that matters most: it says
   * fail, and the thing it failed on is gone.
   */
  retest: boolean;
}

/**
 * The latest mark per case, newest wins when a case has been run in more
 * than one period. `fixedAt` maps a case id to when a bug it found was
 * most recently marked fixed.
 */
export function standings(
  results: CaseResult[],
  depthById: Map<string, TestDepth>,
  now: Date,
  surface: TestSurface,
  fixedAt?: Map<string, string>,
): Map<string, CaseStanding> {
  const latest = new Map<string, CaseResult>();
  for (const result of results) {
    if (result.surface !== surface) continue;
    if (!depthById.has(result.case_id)) continue;
    const held = latest.get(result.case_id);
    if (!held || result.updated_at > held.updated_at) {
      latest.set(result.case_id, result);
    }
  }

  const out = new Map<string, CaseStanding>();
  for (const [caseId, result] of latest) {
    const depth = depthById.get(caseId)!;
    const fixed = fixedAt?.get(caseId);
    out.set(caseId, {
      result,
      current: result.period === periodFor(depth, now),
      // Only a failure can want re-testing, and only if the fix is newer
      // than the mark. A case that passed does not become interesting
      // because some unrelated bug on it closed.
      retest:
        result.status === "fail" && fixed != null && fixed > result.updated_at,
    });
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

/**
 * The latest mark for every case on every surface, so a row can say what
 * the other three found.
 *
 * That line is the reason this is one library with a switch rather than
 * four separate pages. A case that passes on the site and fails in the app
 * is the most interesting result the tester can produce, and it is only
 * visible if both answers are on the same screen. Four pages would each
 * hold half the finding.
 */
export function latestPerSurface(
  results: CaseResult[],
  depthById: Map<string, TestDepth>,
): Map<string, Map<TestSurface, CaseResult>> {
  const out = new Map<string, Map<TestSurface, CaseResult>>();
  for (const result of results) {
    if (!depthById.has(result.case_id)) continue;
    let bySurface = out.get(result.case_id);
    if (!bySurface) {
      bySurface = new Map();
      out.set(result.case_id, bySurface);
    }
    const held = bySurface.get(result.surface);
    if (!held || result.updated_at > held.updated_at) {
      bySurface.set(result.surface, result);
    }
  }
  return out;
}

export interface OtherSurface {
  surface: TestSurface;
  title: string;
  /** Null when the case applies there but has never been run there. */
  result: CaseResult | null;
}

/**
 * What the other surfaces found for one case, in library order.
 *
 * Only surfaces the case actually applies to. Saying "Paid reviews: not
 * run on iOS" would be noise about something that was never in the app.
 */
export function otherSurfaces(
  latest: Map<string, Map<TestSurface, CaseResult>>,
  testCase: { id: string; surfaces: TestSurface[] },
  surface: TestSurface,
): OtherSurface[] {
  const bySurface = latest.get(testCase.id);
  return TEST_SURFACES.filter(
    (s) => s.key !== surface && testCase.surfaces.includes(s.key),
  ).map((s) => ({
    surface: s.key,
    title: s.short,
    result: bySurface?.get(s.key) ?? null,
  }));
}
