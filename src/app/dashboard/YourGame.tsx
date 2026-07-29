"use client";

import Link from "next/link";
import { Pair, Pct } from "@/app/match/[id]/AnalysisCards";
import type { AggregateStats } from "@/app/stats/aggregate";
import { useAggregateStats } from "@/app/stats/useAggregate";

/**
 * Home's "Your game" card — the staged window into /stats. It only ever
 * shows what the data has earned, because a percentage over three points
 * reads as fake:
 *
 *   hidden      until 3 fully scored matches — the card is a reward for
 *               players invested enough to score, never a greeting for
 *               new users (and it renders BELOW Recent matches: footage
 *               is the value prop, stats are the bonus);
 *   base        form dots + matches / games record;
 *   stage 2     + serve & receive win % — needs 20 serve-known points;
 *   stage 3     + one tactics insight line, picked by sample size times
 *               distance from 50% — needs 30 described/tactical samples
 *               and a candidate with at least 8 points behind it.
 *
 * Below each threshold the card simply shows less. No locked rows, no
 * progress bars begging for data.
 */

const STAGE2_MATCHES = 3;
const STAGE2_SERVE_KNOWN = 20;
const STAGE3_SAMPLES = 30;
const INSIGHT_MIN_N = 8;

interface Insight {
  text: string;
  /** sample size × |win rate − 0.5| — bigger is more worth saying */
  weight: number;
}

function insightFrom(agg: AggregateStats): string | null {
  const samples =
    agg.serveMine.count + agg.serveTheirs.count + agg.direction.total;
  if (samples < STAGE3_SAMPLES) return null;
  const candidates: Insight[] = [];
  const consider = (
    label: string,
    won: number,
    lost: number,
    phrase: (pct: number, won: number, n: number) => string
  ) => {
    const n = won + lost;
    if (n < INSIGHT_MIN_N) return;
    const rate = won / n;
    candidates.push({
      text: phrase(Math.round(rate * 100), won, n),
      weight: n * Math.abs(rate - 0.5),
    });
  };
  for (const t of agg.serveMine.spins) {
    consider(t.label, t.won, t.lost, (pct, won, n) =>
      pct >= 50
        ? `${t.label} serves are winning ${won} of ${n} for you.`
        : `${t.label} serves are only winning ${won} of ${n} — worth a look.`
    );
  }
  for (const t of agg.serveMine.lengths) {
    consider(t.label, t.won, t.lost, (pct, won, n) =>
      pct >= 50
        ? `${t.label} serves are winning ${won} of ${n} for you.`
        : `${t.label} serves are only winning ${won} of ${n} — worth a look.`
    );
  }
  for (const t of agg.serveTheirs.spins) {
    consider(t.label, t.won, t.lost, (pct, won, n) =>
      pct >= 50
        ? `You take ${won} of ${n} points against ${t.label.toLowerCase()} serves.`
        : `${t.label} serves against you: ${won} of ${n} won. Practice the read.`
    );
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.weight - a.weight);
  return candidates[0].text;
}

export function YourGame({
  userId,
  accountName,
}: {
  userId: string;
  accountName: string | null;
}) {
  const agg = useAggregateStats(userId, accountName);
  // Loading and not-earned-yet look the same: nothing. Three fully
  // scored matches is the bar — below it this card would front-load a
  // stats promise the data can't keep yet.
  if (!agg || agg.results.length < STAGE2_MATCHES) return null;

  const matchesWon = agg.results.filter((r) => r.gamesYou > r.gamesThem).length;
  const matchesLost = agg.results.filter(
    (r) => r.gamesThem > r.gamesYou
  ).length;
  const recent = [...agg.results].slice(-10);
  const stage2 = agg.serve.played + agg.receive.played >= STAGE2_SERVE_KNOWN;
  const insight = insightFrom(agg);

  return (
    <section>
      {/* Same heading row every Home section uses — the card itself is
          all numbers, the section chrome lives out here. */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Your game</h2>
        <Link
          href="/stats"
          className="inline-flex items-center gap-1 text-sm font-medium text-cyan-glow transition-colors hover:text-white"
        >
          My stats
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
          </svg>
        </Link>
      </div>

      <Link
        href="/stats"
        className="mt-4 block rounded-2xl border border-edge bg-surface p-4 transition-colors hover:border-cyan-glow/40"
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {/* form guide, oldest → newest */}
          <span className="flex items-center gap-1.5">
            {recent.map((r) => (
              <span
                key={r.id}
                className={`h-2 w-2 rounded-full ${
                  r.gamesYou > r.gamesThem
                    ? "bg-cyan-glow"
                    : "bg-magenta-glow/70"
                }`}
              />
            ))}
          </span>
          <span className="text-sm font-semibold tabular-nums">
            <Pair you={matchesWon} them={matchesLost} />
            <span className="ml-1.5 text-[11px] font-normal text-zinc-500">
              matches
            </span>
          </span>
          <span className="text-sm font-semibold tabular-nums">
            <Pair you={agg.games.you} them={agg.games.them} />
            <span className="ml-1.5 text-[11px] font-normal text-zinc-500">
              games
            </span>
          </span>
        </div>

        {stage2 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-edge/60 pt-3 text-xs">
            <span className="text-zinc-400">
              Serve{" "}
              <span className="font-semibold tabular-nums">
                <Pct {...agg.serve} />
              </span>
            </span>
            <span className="text-zinc-400">
              Receive{" "}
              <span className="font-semibold tabular-nums">
                <Pct {...agg.receive} />
              </span>
            </span>
          </div>
        )}

        {insight && (
          <p className="mt-3 flex items-start gap-2 border-t border-edge/60 pt-3 text-sm leading-snug text-zinc-200">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-glow" />
            {insight}
          </p>
        )}
      </Link>
    </section>
  );
}
