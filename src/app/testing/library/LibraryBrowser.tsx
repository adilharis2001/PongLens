"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  RUN_STATUS_LABEL,
  currentResults,
  latestPerSurface,
  otherSurfaces,
  periodFor,
  periodLabel,
  progressFor,
  standings,
  type CaseResult,
  type RunStatus,
} from "@/lib/qa/runs";
import {
  AREA_TITLE,
  DEPTH_META,
  TEST_AREAS,
  TEST_SURFACES,
  testCaseSearchText,
  testCases,
  type TestArea,
  type TestDepth,
  type TestSurface,
} from "@/lib/qa/testLibrary";

const DEPTHS: { key: TestDepth | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "smoke", label: DEPTH_META.smoke.filter },
  { key: "core", label: DEPTH_META.core.filter },
  { key: "edge", label: DEPTH_META.edge.filter },
];

const DEPTH_CHIP: Record<TestDepth, string> = {
  smoke: "border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow",
  core: "border-edge bg-surface-2 text-zinc-300",
  edge: "border-edge bg-surface-2 text-zinc-500",
};

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

const DEPTHS_IN_ORDER: TestDepth[] = ["smoke", "core", "edge"];

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
            {RUN_STATUS_LABEL[e.result!.status].toLowerCase()}
          </span>{" "}
          {new Date(e.result!.updated_at).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
          })}
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
  // Anywhere but the desktop browser opens on the release set. A full
  // weekly sweep of all four surfaces is around 370 marks, and a list that
  // long on a phone is one nobody starts. One tap widens it.
  const [depth, setDepth] = useState<TestDepth | "all">(
    initialSurface === "web-desktop" ? "all" : "smoke",
  );
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [notRun, setNotRun] = useState(false);
  const [results, setResults] = useState<CaseResult[]>([]);
  /** case id -> when a bug it found was most recently marked fixed. */
  const [fixedAt, setFixedAt] = useState<Map<string, string>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);

  // One clock for the whole render, so a case cannot land in a different
  // week from the progress bar counting it.
  const now = useMemo(() => new Date(), []);
  const depthById = useMemo(
    () => new Map(testCases.map((c) => [c.id, c.depth] as const)),
    [],
  );
  // Two views of the same rows. `current` answers "has this been run in
  // the period we are tracking", which drives the progress bar and the
  // "not run" filter. `standing` answers "what did we last find", which is
  // what a person scanning the list actually wants, and it never goes
  // blank just because the calendar moved.
  const current = useMemo(
    () => currentResults(results, depthById, now, surface),
    [results, depthById, now, surface],
  );
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
  // from here rather than from testCases, so a percentage is never quietly
  // measured against work that was never going to be done here.
  const applies = useMemo(
    () => testCases.filter((c) => c.surfaces.includes(surface)),
    [surface],
  );

  const switchSurface = useCallback((next: TestSurface) => {
    setSurface(next);
    setOpenId(null);
    setDepth(next === "web-desktop" ? "all" : "smoke");
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

  const mark = useCallback(
    async (caseId: string, caseDepth: TestDepth, status: RunStatus | null) => {
      const period = periodFor(caseDepth, now);
      setBusyId(caseId);
      const supabase = createClient();

      // Every one of these three has to name the surface. Miss it on the
      // delete and clearing a mark on the app would clear the web one too.
      const mine = (r: CaseResult) =>
        r.case_id === caseId && r.period === period && r.surface === surface;

      if (status === null) {
        setResults((prev) => prev.filter((r) => !mine(r)));
        await supabase
          .from("qa_case_results")
          .delete()
          .eq("case_id", caseId)
          .eq("period", period)
          .eq("surface", surface);
      } else {
        const row: CaseResult = {
          case_id: caseId,
          period,
          surface,
          status,
          note: "",
          marked_by: userId,
          updated_at: new Date().toISOString(),
        };
        setResults((prev) => [...prev.filter((r) => !mine(r)), row]);
        // Upsert on the composite key: marking the same case twice in a
        // week is a correction, not a second run.
        const { error } = await supabase
          .from("qa_case_results")
          .upsert(row, { onConflict: "case_id,period,surface" });
        if (error) await load();
      }
      setBusyId(null);
    },
    [now, surface, userId, load],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return applies.filter((c) => {
      if (area !== "all" && c.area !== area) return false;
      if (depth !== "all" && c.depth !== depth) return false;
      if (notRun && current.has(c.id)) return false;
      if (q && !testCaseSearchText(c).includes(q)) return false;
      return true;
    });
  }, [applies, area, depth, query, notRun, current]);

  // Grouped so the list reads as a walk through the product rather than a
  // flat wall of cases.
  const grouped = useMemo(() => {
    const out: {
      area: TestArea;
      cases: typeof testCases;
      /** How many of the area's cases apply here, and how many exist. */
      applicable: number;
      total: number;
    }[] = [];
    for (const a of TEST_AREAS) {
      const cases = visible.filter((c) => c.area === a.key);
      if (!cases.length) continue;
      out.push({
        area: a.key,
        cases,
        applicable: applies.filter((c) => c.area === a.key).length,
        total: testCases.filter((c) => c.area === a.key).length,
      });
    }
    return out;
  }, [visible, applies]);

  return (
    <div>
      {/* The switch. It sits above everything because it changes what
          everything below means: which cases are listed, which marks are
          shown, and what the counters are counting. */}
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

      <div className="mt-5 flex flex-col gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the library"
          className="w-full rounded-xl border border-edge bg-ink/60 px-4 py-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/50"
        />
        <div className="flex flex-wrap items-center gap-2">
          {DEPTHS.map((d) => (
            <Pill key={d.key} on={depth === d.key} onClick={() => setDepth(d.key)}>
              {d.label}
            </Pill>
          ))}
          <span className="mx-1 h-4 w-px bg-edge" aria-hidden="true" />
          <Pill on={notRun} onClick={() => setNotRun(!notRun)}>
            Still to run
          </Pill>
          <span className="mx-1 h-4 w-px bg-edge" aria-hidden="true" />
          <Pill on={area === "all"} onClick={() => setArea("all")}>
            Everything
          </Pill>
          {TEST_AREAS.map((a) => (
            <Pill key={a.key} on={area === a.key} onClick={() => setArea(a.key)}>
              {a.title}
            </Pill>
          ))}
        </div>
      </div>

      {/* Where each cadence stands this period. This is the answer to
          "which ones still need testing", so it sits above the list. */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {DEPTHS_IN_ORDER.map((d) => {
          const ids = applies.filter((c) => c.depth === d).map((c) => c.id);
          const p = progressFor(ids, current);
          const done = p.run === p.total;
          return (
            <div
              key={d}
              className="rounded-2xl border border-edge bg-surface p-4"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-zinc-200">
                  {DEPTH_META[d].filter}
                </span>
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    done ? "text-emerald-300" : "text-zinc-100"
                  }`}
                >
                  {p.run}/{p.total}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={`h-full rounded-full ${
                    p.failed > 0 ? "bg-amber-400" : "bg-cyan-glow"
                  }`}
                  style={{
                    width: `${p.total ? (p.run / p.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                {p.failed > 0 && (
                  <span className="text-red-300">{p.failed} failing · </span>
                )}
                {p.total - p.run} still to run ·{" "}
                {d === "edge" ? "does not reset" : periodLabel(d, now)}
              </p>
            </div>
          );
        })}
      </div>

      {/* What the cadence chips mean. Without this the chip says "Release"
          to someone who has no way of knowing that means every one. */}
      <div className="mt-5 flex flex-col gap-1.5 text-sm">
        {(depth === "all"
          ? (["smoke", "core", "edge"] as TestDepth[])
          : [depth]
        ).map((d) => (
          <p key={d} className="text-zinc-500">
            <span className="font-medium text-zinc-300">
              {DEPTH_META[d].filter}.
            </span>{" "}
            {DEPTH_META[d].blurb}
          </p>
        ))}
      </div>

      <p className="mt-4 text-sm text-zinc-500">
        {visible.length} case{visible.length === 1 ? "" : "s"}
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
                // The last mark whatever week it came from, so a sweep in
                // progress keeps its place. `stale` dims it and says when.
                const stand = standing.get(c.id);
                const result = stand?.result;
                const stale = stand != null && !stand.current;
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
                        <span
                          className={`mt-0.5 w-16 shrink-0 rounded-full border px-2 py-0.5 text-center text-[10px] font-semibold ${
                            DEPTH_CHIP[c.depth]
                          }`}
                        >
                          {DEPTH_META[c.depth].chip}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium leading-snug text-zinc-100">
                            {c.title}
                          </span>
                          <span className="mt-1 block font-mono text-[11px] text-zinc-600">
                            {c.id}
                            {c.blocked ? " · blocked" : ""}
                            {stale && result && (
                              <span className="text-zinc-500">
                                {" · "}
                                {RUN_STATUS_LABEL[result.status].toLowerCase()}
                                {" last time"}
                              </span>
                            )}
                          </span>
                          <Elsewhere
                            entries={otherSurfaces(latest, c, surface)}
                          />
                          {stand?.retest && (
                            <span className="mt-1.5 inline-block rounded-full border border-cyan-glow/40 bg-cyan-glow/10 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-glow">
                              Fixed since you failed it. Worth re-running.
                            </span>
                          )}
                        </span>
                      </button>

                      {/* Pass and Fail sit on the row itself: marking a case
                          is the most frequent action here, and burying it
                          behind an expand would cost a tap on every case. */}
                      <div className="flex shrink-0 items-center gap-1.5">
                        {(["pass", "fail"] as RunStatus[]).map((s) => {
                          const on = !stale && result?.status === s;
                          return (
                            <button
                              key={s}
                              type="button"
                              disabled={busyId === c.id}
                              onClick={() => void mark(c.id, c.depth, on ? null : s)}
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
                        {!stale &&
                          result &&
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
                      <div className="px-4 pb-5 pl-[3.9rem]">
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
                            const on = !stale && result?.status === s;
                            return (
                              <button
                                key={s}
                                type="button"
                                disabled={busyId === c.id}
                                onClick={() =>
                                  void mark(c.id, c.depth, on ? null : s)
                                }
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
                          {!stale && result && (
                            <button
                              type="button"
                              disabled={busyId === c.id}
                              onClick={() => void mark(c.id, c.depth, null)}
                              className="rounded-full border border-edge px-3.5 py-1 text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-200 disabled:opacity-50"
                            >
                              Clear
                            </button>
                          )}
                          <span className="text-xs text-zinc-600">
                            {result && !stale
                              ? `Marked ${RUN_STATUS_LABEL[result.status].toLowerCase()} for ${periodLabel(c.depth, now)}`
                              : result
                                ? `Last marked ${RUN_STATUS_LABEL[result.status].toLowerCase()} on ${new Date(result.updated_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}. Not run this ${c.depth === "edge" ? "case" : "week"} yet.`
                                : `Not run this ${c.depth === "edge" ? "case" : "week"} yet`}
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
