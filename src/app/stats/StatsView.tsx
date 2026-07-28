"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDate } from "@/app/dashboard/shared";
import { MATCH_TYPE_LABEL } from "@/lib/matchTitle";
import {
  CountBar,
  Empty,
  Pair,
  Pct,
  SplitBar,
  StatRow,
} from "@/app/match/[id]/AnalysisCards";
import type { AggregateStats } from "./aggregate";
import { useAggregateStats } from "./useAggregate";

/**
 * /stats — your whole game, aggregated across every match you scored.
 * Two views on one fetch: "My stats" (how you're doing) and "Tactics"
 * (the patterns in how points are won and lost). ?view=tactics deep-links
 * the second so Account and Home can address them separately.
 *
 * All aggregation happens client-side in aggregate.ts through the exact
 * pure walks the match page uses — see the rationale there.
 */

type View = "stats" | "tactics";

export function StatsView({
  userId,
  accountName,
  initialView,
}: {
  userId: string;
  accountName: string | null;
  initialView: View;
}) {
  const [view, setView] = useState<View>(initialView);
  const agg = useAggregateStats(userId, accountName);

  const switchView = (v: View) => {
    setView(v);
    const url = v === "tactics" ? "/stats?view=tactics" : "/stats";
    window.history.replaceState(null, "", url);
  };

  const tab = (value: View, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => switchView(value)}
      aria-pressed={view === value}
      className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
        view === value
          ? "bg-surface-2 text-white"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="mt-6 flex gap-1">
        {tab("stats", "My stats")}
        {tab("tactics", "Tactics")}
      </div>

      {agg === null ? (
        <p className="mt-10 text-center text-sm text-zinc-500">
          Reading your matches…
        </p>
      ) : agg.matchesWithScores === 0 ? (
        <div className="mt-6 rounded-2xl border border-edge bg-surface p-6 text-center">
          <p className="text-sm text-zinc-300">Nothing to count yet.</p>
          <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-zinc-500">
            Score the points in your matches and this page builds itself:
            serve and receive, pressure points, patterns across every match.
          </p>
          <Link
            href="/matches"
            className="mt-4 inline-block rounded-full bg-cyan-glow px-4 py-2 text-sm font-semibold text-ink"
          >
            Go to matches
          </Link>
        </div>
      ) : view === "stats" ? (
        <MyStats agg={agg} />
      ) : (
        <Tactics agg={agg} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- shells */

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-edge bg-surface p-4">
      <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Hero({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-edge bg-surface px-3 py-4 text-center">
      <p className="text-lg font-bold tabular-nums tracking-tight">
        {children}
      </p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- my stats */

function MyStats({ agg }: { agg: AggregateStats }) {
  const [showAll, setShowAll] = useState(false);
  const matchesWon = agg.results.filter((r) => r.gamesYou > r.gamesThem).length;
  const matchesLost = agg.results.filter(
    (r) => r.gamesThem > r.gamesYou
  ).length;
  const totalPts = agg.points.won + agg.points.lost;
  const ptsPct =
    totalPts > 0 ? Math.round((agg.points.won / totalPts) * 100) : null;
  const recent = [...agg.results].reverse();
  const shown = showAll ? recent : recent.slice(0, 8);
  const serveKnown = agg.serve.played + agg.receive.played > 0;
  const deuceTotal = agg.deuceGames.won + agg.deuceGames.lost;

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Hero label="Matches">
          {agg.results.length > 0 ? (
            <Pair you={matchesWon} them={matchesLost} />
          ) : (
            <span className="text-zinc-500">—</span>
          )}
        </Hero>
        <Hero label="Games">
          {agg.games.you + agg.games.them > 0 ? (
            <Pair you={agg.games.you} them={agg.games.them} />
          ) : (
            <span className="text-zinc-500">—</span>
          )}
        </Hero>
        <Hero label="Points won">
          {ptsPct !== null ? (
            <span className="text-cyan-glow">{ptsPct}%</span>
          ) : (
            <span className="text-zinc-500">—</span>
          )}
        </Hero>
      </div>

      <Section
        title="Winning points"
        hint={`Across ${agg.matchesWithScores} scored ${
          agg.matchesWithScores === 1 ? "match" : "matches"
        }`}
      >
        <div className="divide-y divide-edge/60">
          {serveKnown ? (
            <>
              <StatRow label="Serve win %">
                <Pct {...agg.serve} />
              </StatRow>
              <StatRow label="Receive win %">
                <Pct {...agg.receive} />
              </StatRow>
            </>
          ) : (
            <p className="py-2 text-xs text-zinc-500">
              Set who served first in your matches to split points by serve
              and receive.
            </p>
          )}
          <StatRow label="At 9+ in the game">
            <Pct {...agg.pressure} />
          </StatRow>
          <StatRow label="After losing a point">
            <Pct {...agg.bounceBack} />
          </StatRow>
          {deuceTotal > 0 && (
            <StatRow label="Games past 10-10">
              <Pair you={agg.deuceGames.won} them={agg.deuceGames.lost} />
            </StatRow>
          )}
          <StatRow label="Best run of points">
            <span className="text-zinc-200">{agg.longestStreak} in a row</span>
          </StatRow>
          <StatRow label="Points won–lost">
            <Pair you={agg.points.won} them={agg.points.lost} />
          </StatRow>
        </div>
      </Section>

      <Section
        title="Results"
        hint="Fully scored matches, most recent first"
      >
        {recent.length === 0 ? (
          <Empty>
            Finish scoring a match — every point decided — and its result
            lands here.
          </Empty>
        ) : (
          <>
            {recent.length > 1 && (
              <div className="mb-3 flex items-center gap-1.5">
                {recent
                  .slice(0, 10)
                  .reverse()
                  .map((r) => (
                    <span
                      key={r.id}
                      title={`${r.gamesYou}-${r.gamesThem}`}
                      className={`h-2 w-2 rounded-full ${
                        r.gamesYou > r.gamesThem
                          ? "bg-cyan-glow"
                          : "bg-magenta-glow/70"
                      }`}
                    />
                  ))}
                <span className="ml-1 text-[11px] text-zinc-500">
                  last {Math.min(recent.length, 10)}
                </span>
              </div>
            )}
            <div className="divide-y divide-edge/60">
              {shown.map((r) => (
                <Link
                  key={r.id}
                  href={`/match/${r.id}`}
                  className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:bg-surface-2/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-zinc-200">
                      {r.opponent ??
                        (r.match_type
                          ? MATCH_TYPE_LABEL[r.match_type]
                          : "Match")}
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      {formatDate(r.played_at)}
                      {r.opponent && r.match_type
                        ? ` · ${MATCH_TYPE_LABEL[r.match_type]}`
                        : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums">
                      <Pair you={r.gamesYou} them={r.gamesThem} />
                    </p>
                    <p className="text-[11px] tabular-nums text-zinc-500">
                      {r.ptsYou}–{r.ptsThem} pts
                    </p>
                  </div>
                </Link>
              ))}
            </div>
            {!showAll && recent.length > shown.length && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="mt-2 w-full rounded-xl border border-edge py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-surface-2"
              >
                Show all {recent.length}
              </button>
            )}
          </>
        )}
      </Section>

      {agg.opponents.length > 0 && (
        <Section title="Opponents" hint="Fully scored matches only">
          <div className="divide-y divide-edge/60">
            {agg.opponents.map((o) => (
              <StatRow key={o.name} label={o.name}>
                <Pair you={o.won} them={o.lost} />
              </StatRow>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- tactics */

function Tactics({ agg }: { agg: AggregateStats }) {
  const described = agg.serveMine.count + agg.serveTheirs.count;
  const maxError = Math.max(...agg.errors.map((e) => e.count), 0);
  const maxReason = Math.max(...agg.lossReasons.map((r) => r.count), 0);
  const maxDir = Math.max(
    ...agg.direction.won.map((d) => d.count),
    ...agg.direction.lost.map((d) => d.count),
    0
  );
  const nothing =
    described === 0 && agg.errors.length === 0 && agg.direction.total === 0;

  if (nothing) {
    return (
      <div className="mt-6 rounded-2xl border border-edge bg-surface p-6 text-center">
        <p className="text-sm text-zinc-300">No patterns yet.</p>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-zinc-500">
          Tactics build from the follow-ups on scored points: how each point
          ended, the serve&apos;s spin and length, and where the deciding
          ball went. Answer those on a few matches and the patterns show up
          here.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <Section
        title="My serves"
        hint={`Share of those points you won · ${agg.serveMine.count} described`}
      >
        {agg.serveMine.count === 0 ? (
          <Empty>
            No serves of yours described yet. They come from the serve
            question on points that turned on the serve.
          </Empty>
        ) : (
          <>
            {agg.serveMine.spins.map((r) => (
              <SplitBar key={r.label} row={r} />
            ))}
            {agg.serveMine.lengths.length > 0 && (
              <>
                <p className="mb-1 mt-4 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  By length
                </p>
                {agg.serveMine.lengths.map((r) => (
                  <SplitBar key={r.label} row={r} />
                ))}
              </>
            )}
          </>
        )}
      </Section>

      <Section
        title="Against their serves"
        hint={`Share of those points you won · ${agg.serveTheirs.count} described`}
      >
        {agg.serveTheirs.count === 0 ? (
          <Empty>
            Nothing described on their serves yet. Reading the spin is the
            skill — describe a few and see which ones trouble you.
          </Empty>
        ) : (
          agg.serveTheirs.spins.map((r) => <SplitBar key={r.label} row={r} />)
        )}
      </Section>

      <Section title="Mistakes" hint="Only points you lost, across every match">
        {agg.errors.length === 0 && agg.lossReasons.length === 0 ? (
          <Empty>
            Say how lost points ended, and why, and the pattern shows up
            here.
          </Empty>
        ) : (
          <>
            {agg.errors.length > 0 && (
              <>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Your misses
                </p>
                {agg.errors.map((r) => (
                  <CountBar key={r.label} row={r} max={maxError} />
                ))}
              </>
            )}
            {agg.lossReasons.length > 0 && (
              <>
                <p className="mb-1 mt-3 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Why, in your words
                </p>
                {agg.lossReasons.map((r) => (
                  <CountBar key={r.label} row={r} max={maxReason} />
                ))}
              </>
            )}
          </>
        )}
      </Section>

      <Section title="Placement" hint="Where the deciding ball went">
        {agg.direction.total === 0 ? (
          <Empty>
            No placements recorded yet. They come from the placement
            question on a point.
          </Empty>
        ) : (
          <>
            {agg.direction.won.length > 0 && (
              <>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  When you won the point
                </p>
                {agg.direction.won.map((r) => (
                  <CountBar key={r.label} row={r} max={maxDir} tone="cyan" />
                ))}
              </>
            )}
            {agg.direction.lost.length > 0 && (
              <>
                <p className="mb-1 mt-3 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  When you lost it
                </p>
                {agg.direction.lost.map((r) => (
                  <CountBar key={r.label} row={r} max={maxDir} />
                ))}
              </>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
