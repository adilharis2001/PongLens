"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  RUN_STATUS_LABEL,
  RUN_STATUS_PAST,
  latestPerSurface,
  otherSurfaces,
  periodFor,
  standings,
  type CaseResult,
  type RunStatus,
} from "@/lib/qa/runs";
import {
  AREA_TITLE,
  TEST_AREAS,
  TEST_SURFACES,
  isNewCase,
  testCaseSearchText,
  testCases,
  type TestArea,
  type TestDepth,
  type TestSurface,
} from "@/lib/qa/testLibrary";

/**
 * What the list is narrowed to. There used to be a cadence here (every
 * release, weekly, once) and three progress cards counting against it,
 * and the tester could not tell what any of it wanted from him. The
 * question he is actually asking is "which ones should I do next", and
 * the library answers it with when each case was last tested and what
 * was found. New cases first, then the failing ones, then the ones never
 * touched; everything else is a date.
 */
type View = "new" | "untested" | "failing" | "all";

function Pill({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-3.5 py-1 text-xs font-semibold transition-colors ${
        on
          ? "border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow"
          : "border-edge text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}

const RUN_CHIP: Record<RunStatus, string> = {
  pass: "border-emerald-400/50 bg-emerald-400/10 text-emerald-300",
  fail: "border-red-400/50 bg-red-400/10 text-red-300",
  blocked: "border-amber-400/50 bg-amber-400/10 text-amber-300",
  skipped: "border-edge bg-surface-2 text-zinc-400",
};

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/**
 * The one line under a title that says where a case stands: when it was
 * last tested here and what was found, or that it never has been.
 */
function LastTested({ result }: { result: CaseResult | undefined }) {
  if (!result) {
    return <span className="text-zinc-500">Never tested</span>;
  }
  const tone =
    result.status === "pass"
      ? "text-emerald-400/90"
      : result.status === "fail"
        ? "text-red-400/90"
        : "text-zinc-400";
  return (
    <span className="text-zinc-500">
      Last tested {shortDate(result.updated_at)},{" "}
      <span className={`font-semibold ${tone}`}>
        {RUN_STATUS_PAST[result.status]}
      </span>
    </span>
  );
}

/**
 * How a case's mark on the other surfaces reads. Only surfaces that have
 * actually been run: three trailing "not run"s under every row would bury
 * the one line worth seeing, which is the surface that disagrees.
 */
function Elsewhere({
  entries,
}: {
  entries: { surface: TestSurface; title: string; result: CaseResult | null }[];
}) {
  const marked = entries.filter((e) => e.result !== null);
  if (marked.length === 0) return null;
  return (
    <span className="mt-1 block text-[11px] text-zinc-500">
      {marked.map((e, i) => (
        <span key={e.surface}>
          {i > 0 && " · "}
          {e.title}{" "}
          <span
            className={
              e.result!.status === "pass"
                ? "font-semibold text-emerald-400/90"
                : e.result!.status === "fail"
                  ? "font-semibold text-red-400/90"
                  : "font-semibold text-zinc-400"
            }
          >
            {RUN_STATUS_PAST[e.result!.status]}
          </span>{" "}
          {shortDate(e.result!.updated_at)}
        </span>
      ))}
    </span>
  );
}

export function LibraryBrowser({
  userId,
  surface: initialSurface,
}: {
  userId: string;
  surface: TestSurface;
}) {
  const [surface, setSurface] = useState<TestSurface>(initialSurface);
  const [area, setArea] = useState<TestArea | "all">("all");
  const [view, setView] = useState<View | null>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [results, setResults] = useState<CaseResult[]>([]);
  /** case id -> when a bug it found was most recently marked fixed. */
  const [fixedAt, setFixedAt] = useState<Map<string, string>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);

  // One clock for the whole render.
  const now = useMemo(() => new Date(), []);
  const depthById = useMemo(
    () => new Map(testCases.map((c) => [c.id, c.depth] as const)),
    [],
  );
  // The last mark per case on this surface, whatever week it came from.
  // That is what "last tested" means, and it never goes blank because
  // the calendar moved.
  const standing = useMemo(
    () => standings(results, depthById, now, surface, fixedAt),
    [results, depthById, now, surface, fixedAt],
  );
  // Every surface's latest mark, which is the one thing on this page that
  // deliberately ignores the switch: it exists to compare across it.
  const latest = useMemo(
    () => latestPerSurface(results, depthById),
    [results, depthById],
  );

  // The cases this surface is about. Everything counted on the page reads
  // from here rather than from testCases, so a number is never quietly
  // measured against work that was never going to be done here.
  const applies = useMemo(
    () => testCases.filter((c) => c.surfaces.includes(surface)),
    [surface],
  );
  const counts = useMemo(() => {
    let fresh = 0;
    let untested = 0;
    let failing = 0;
    for (const c of applies) {
      if (isNewCase(c, now)) fresh += 1;
      const result = standing.get(c.id)?.result;
      if (!result) untested += 1;
      else if (result.status === "fail") failing += 1;
    }
    return { fresh, untested, failing, tested: applies.length - untested };
  }, [applies, now, standing]);

  // The new cases are the ones to do first, so that is where the page
  // opens while there are any. One tap widens it.
  const activeView: View =
    view ?? (counts.fresh > 0 ? "new" : "all");

  const switchSurface = useCallback((next: TestSurface) => {
    setSurface(next);
    setOpenId(null);
    // An area filter can survive into a surface that has no cases in it —
    // Paid reviews on the app, say — and the list would go empty with no
    // pill lit to explain why.
    setArea("all");
    // Native history rather than router.replace: this keeps the URL
    // bookmarkable, which is the whole point of it being in the URL, while
    // avoiding a server round trip that would refetch every mark to render
    // a list already in memory.
    const url = new URL(window.location.href);
    url.searchParams.set("surface", next);
    window.history.replaceState(null, "", url);
  }, []);

  const load = useCallback(async () => {
    const supabase = createClient();
    // Two reads, because the second answers a question the first cannot:
    // which failures are worth running again. A case only knows it failed;
    // the bug it produced is what knows the failure has been fixed.
    const [runs, fixes] = await Promise.all([
      supabase.from("qa_case_results").select("*"),
      supabase
        .from("qa_bugs")
        .select("case_id, status_changed_at")
        .eq("status", "fixed")
        .neq("case_id", ""),
    ]);
    if (runs.data) setResults(runs.data as CaseResult[]);
    if (fixes.data) {
      const map = new Map<string, string>();
      for (const row of fixes.data as {
        case_id: string;
        status_changed_at: string;
      }[]) {
        const held = map.get(row.case_id);
        if (!held || row.status_changed_at > held) {
          map.set(row.case_id, row.status_changed_at);
        }
      }
      setFixedAt(map);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Record a result for today. Marks are still stored against a period
   * underneath (the week, or "once"), which is what lets the history keep
   * every week's answer; the page simply shows the newest one.
   */
  const mark = useCallback(
    async (caseId: string, caseDepth: TestDepth, status: RunStatus) => {
      const period = periodFor(caseDepth, now);
      setBusyId(caseId);
      const supabase = createClient();
      const row: CaseResult = {
        case_id: caseId,
        period,
        surface,
        status,
        note: "",
        marked_by: userId,
        updated_at: new Date().toISOString(),
      };
      setResults((prev) => [
        ...prev.filter(
          (r) =>
            !(r.case_id === caseId && r.period === period && r.surface === surface),
        ),
        row,
      ]);
      // Upsert on the composite key: marking the same case twice in a
      // week is a correction, not a second run.
      const { error } = await supabase
        .from("qa_case_results")
        .upsert(row, { onConflict: "case_id,period,surface" });
      if (error) await load();
      setBusyId(null);
    },
    [now, surface, userId, load],
  );

  /** Remove the last mark, whichever period it was made in. */
  const clear = useCallback(
    async (caseId: string, period: string) => {
      setBusyId(caseId);
      const supabase = createClient();
      // Every one of these has to name the surface. Miss it and clearing
      // a mark on the app would clear the web one too.
      setResults((prev) =>
        prev.filter(
          (r) =>
            !(r.case_id === caseId && r.period === period && r.surface === surface),
        ),
      );
      await supabase
        .from("qa_case_results")
        .delete()
        .eq("case_id", caseId)
        .eq("period", period)
        .eq("surface", surface);
      setBusyId(null);
    },
    [surface],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return applies.filter((c) => {
      if (area !== "all" && c.area !== area) return false;
      const result = standing.get(c.id)?.result;
      if (activeView === "new" && !isNewCase(c, now)) return false;
      if (activeView === "untested" && result) return false;
      if (activeView === "failing" && result?.status !== "fail") return false;
      if (q && !testCaseSearchText(c).includes(q)) return false;
      return true;
    });
  }, [applies, area, activeView, now, standing, query]);

  // Grouped so the list reads as a walk through the product rather than a
  // flat wall of cases. New cases come first inside each area.
  const grouped = useMemo(() => {
    const out: {
      area: TestArea;
      cases: typeof testCases;
      /** How many of the area's cases apply here, and how many exist. */
      applicable: number;
      total: number;
    }[] = [];
    for (const a of TEST_AREAS) {
      const cases = visible
        .filter((c) => c.area === a.key)
        .map((c, i) => ({ c, i, fresh: isNewCase(c, now) }))
        .sort((x, y) => Number(y.fresh) - Number(x.fresh) || x.i - y.i)
        .map((x) => x.c);
      if (!cases.length) continue;
      out.push({
        area: a.key,
        cases,
        applicable: applies.filter((c) => c.area === a.key).length,
        total: testCases.filter((c) => c.area === a.key).length,
      });
    }
    return out;
  }, [visible, applies, now]);

  const views: { key: View; label: string }[] = [
    { key: "all", label: "Everything" },
    { key: "new", label: `New (${counts.fresh})` },
    { key: "untested", label: `Never tested (${counts.untested})` },
    { key: "failing", label: `Failing (${counts.failing})` },
  ];

  return (
    <div>
      {/* The switch. It sits above everything because it changes what
          everything below means: which cases are listed, which marks are
          shown, and what the counts are counting. */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {TEST_SURFACES.map((s) => {
          const on = surface === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => switchSurface(s.key)}
              aria-pressed={on}
              className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
                on
                  ? "border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow"
                  : "border-edge text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {s.title}
            </button>
          );
        })}
        <span className="ml-1 text-xs text-zinc-500">
          {applies.length} of {testCases.length} cases apply here
        </span>
      </div>

      {surface === "android" && (
        <p className="mt-3 text-sm text-zinc-500">
          There is no Android build yet, so nothing here has been run. The
          cases are the same ones as the iOS app.
        </p>
      )}

      {/* Where to start. New cases are the ones that describe what changed,
          so they are called out here rather than left to a small chip in a
          list of a hundred and fifty. */}
      {counts.fresh > 0 && (
        <div className="mt-5 rounded-2xl border border-cyan-glow/40 bg-cyan-glow/5 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div>
            <p className="text-sm font-semibold text-zinc-100">
              {counts.fresh} new case{counts.fresh === 1 ? "" : "s"} to test
              first
            </p>
            <p className="mt-1 text-sm text-zinc-400">
              Each one is marked New in the list and covers something that
              shipped recently. After those, work through anything failing or
              never tested.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setView(activeView === "new" ? "all" : "new")}
            className="mt-3 shrink-0 rounded-full border border-cyan-glow/50 bg-cyan-glow/10 px-4 py-1.5 text-sm font-semibold text-cyan-glow transition-colors hover:bg-cyan-glow/20 sm:mt-0"
          >
            {activeView === "new" ? "Show everything" : "Show the new cases"}
          </button>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the library"
          className="w-full rounded-xl border border-edge bg-ink/60 px-4 py-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/50"
        />
        <div className="flex flex-wrap items-center gap-2">
          {views.map((v) => (
            <Pill
              key={v.key}
              on={activeView === v.key}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </Pill>
          ))}
          <span className="mx-1 h-4 w-px bg-edge" aria-hidden="true" />
          <Pill on={area === "all"} onClick={() => setArea("all")}>
            All areas
          </Pill>
          {/* Only areas this surface actually has. Offering "Paid reviews"
              on the app filter row is an invitation to go looking for a
              flow that was never built into it. */}
          {TEST_AREAS.filter((a) =>
            applies.some((c) => c.area === a.key),
          ).map((a) => (
            <Pill key={a.key} on={area === a.key} onClick={() => setArea(a.key)}>
              {a.title}
            </Pill>
          ))}
        </div>
      </div>

      {/* Where things stand on this surface, in one sentence. */}
      <p className="mt-4 text-sm text-zinc-500">
        {counts.tested} of {applies.length} tested here
        {counts.failing > 0 && (
          <>
            {" · "}
            <span className="text-red-300">{counts.failing} failing</span>
          </>
        )}
        {" · "}
        {counts.untested} never tested
        {" · "}
        showing {visible.length}
      </p>

      {grouped.length === 0 && (
        <p className="mt-8 text-sm text-zinc-500">Nothing matches that.</p>
      )}

      <div className="mt-4 space-y-8">
        {grouped.map((group) => (
          <section key={group.area}>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {AREA_TITLE[group.area]}
              {/* Said out loud so a short list reads as "the rest are not
                  in this build" rather than as something missing. */}
              {group.applicable < group.total && (
                <span className="ml-2 font-normal normal-case tracking-normal text-zinc-600">
                  {group.applicable} of {group.total} apply here
                </span>
              )}
            </h2>
            <ul className="mt-3 overflow-hidden rounded-2xl border border-edge bg-surface">
              {group.cases.map((c) => {
                const open = openId === c.id;
                const stand = standing.get(c.id);
                const result = stand?.result;
                const fresh = isNewCase(c, now);
                return (
                  <li
                    key={c.id}
                    className="border-b border-edge/60 last:border-b-0"
                  >
                    <div className="flex items-start gap-3 px-4 py-3.5">
                      <button
                        type="button"
                        onClick={() => setOpenId(open ? null : c.id)}
                        className="flex min-w-0 flex-1 items-start gap-3 text-left"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium leading-snug text-zinc-100">
                            {fresh && (
                              <span className="mr-2 inline-block rounded-full bg-cyan-glow px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-ink">
                                New
                              </span>
                            )}
                            {c.title}
                          </span>
                          <span className="mt-1 block text-[11px]">
                            <LastTested result={result} />
                            <span className="font-mono text-zinc-600">
                              {" · "}
                              {c.id}
                              {c.blocked ? " · blocked" : ""}
                            </span>
                          </span>
                          <Elsewhere
                            entries={otherSurfaces(latest, c, surface)}
                          />
                          {stand?.retest && (
                            <span className="mt-1.5 inline-block rounded-full border border-cyan-glow/40 bg-cyan-glow/10 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-glow">
                              Fixed since you failed it. Worth testing again.
                            </span>
                          )}
                        </span>
                      </button>

                      {/* Pass and Fail sit on the row itself: marking a case
                          is the most frequent action here, and burying it
                          behind an expand would cost a tap on every case.
                          The lit one is the last result; pressing it again
                          records the same result for today. */}
                      <div className="flex shrink-0 items-center gap-1.5">
                        {(["pass", "fail"] as RunStatus[]).map((s) => {
                          const on = result?.status === s;
                          return (
                            <button
                              key={s}
                              type="button"
                              disabled={busyId === c.id}
                              onClick={() => void mark(c.id, c.depth, s)}
                              aria-pressed={on}
                              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                                on
                                  ? RUN_CHIP[s]
                                  : "border-edge text-zinc-500 hover:text-zinc-200"
                              }`}
                            >
                              {RUN_STATUS_LABEL[s]}
                            </button>
                          );
                        })}
                        {result &&
                          result.status !== "pass" &&
                          result.status !== "fail" && (
                            <span
                              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                                RUN_CHIP[result.status]
                              }`}
                            >
                              {RUN_STATUS_LABEL[result.status]}
                            </span>
                          )}
                      </div>
                    </div>

                    {open && (
                      <div className="px-4 pb-5">
                        <p className="text-sm leading-relaxed text-zinc-400">
                          {c.why}
                        </p>

                        {c.blocked && (
                          <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm leading-relaxed text-amber-200/90">
                            Cannot be run yet. {c.blocked}
                          </p>
                        )}

                        {c.needs && c.needs.length > 0 && (
                          <div className="mt-4">
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                              You need
                            </h3>
                            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-zinc-300">
                              {c.needs.map((need) => (
                                <li key={need}>{need}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="mt-4">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                            Do this
                          </h3>
                          <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm text-zinc-300">
                            {c.steps.map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ol>
                        </div>

                        <div className="mt-4">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                            Should happen
                          </h3>
                          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-zinc-300">
                            {c.expected.map((e) => (
                              <li key={e}>{e}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-3">
                          <Link
                            href={`/testing/report?case=${encodeURIComponent(c.id)}&surface=${surface}`}
                            className="rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-cyan-glow"
                          >
                            Something broke here
                          </Link>
                          <span className="text-xs text-zinc-600">
                            Run on:{" "}
                            {TEST_SURFACES.filter((s) =>
                              c.surfaces.includes(s.key),
                            )
                              .map((s) => s.title)
                              .join(", ")}
                          </span>
                        </div>

                        {/* The other two outcomes. Not on the row, because
                            they are rare, but a tester who could not run a
                            case needs somewhere to say so that is not Fail. */}
                        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-edge/60 pt-4">
                          {(["blocked", "skipped"] as RunStatus[]).map((s) => {
                            const on = result?.status === s;
                            return (
                              <button
                                key={s}
                                type="button"
                                disabled={busyId === c.id}
                                onClick={() => void mark(c.id, c.depth, s)}
                                aria-pressed={on}
                                className={`rounded-full border px-3.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                                  on
                                    ? RUN_CHIP[s]
                                    : "border-edge text-zinc-500 hover:text-zinc-200"
                                }`}
                              >
                                {RUN_STATUS_LABEL[s]}
                              </button>
                            );
                          })}
                          {result && (
                            <button
                              type="button"
                              disabled={busyId === c.id}
                              onClick={() => void clear(c.id, result.period)}
                              className="rounded-full border border-edge px-3.5 py-1 text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-200 disabled:opacity-50"
                            >
                              Clear
                            </button>
                          )}
                          <span className="text-xs text-zinc-600">
                            {result
                              ? `Last tested ${shortDate(result.updated_at)}: ${RUN_STATUS_LABEL[result.status].toLowerCase()}`
                              : "Never tested on this surface"}
                          </span>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
