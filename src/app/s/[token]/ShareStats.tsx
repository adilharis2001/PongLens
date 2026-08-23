"use client";

import {
  MomentumChart,
  Pair,
  Pct,
  StatRow,
} from "@/app/match/[id]/AnalysisCards";
import type { MatchAnalysis } from "@/app/match/[id]/matchAnalysis";
import type { MatchStats } from "@/app/match/[id]/matchStats";

/**
 * The match, in numbers, on the public page.
 *
 * Every row here is derived from the confirmed winners and the ITTF serve
 * rotation — facts a viewer could reconstruct from the footage the link
 * already plays. What is NOT here is deliberate: the owner's self-reported
 * reasons for losing points, and their serve tagging. Those are notes a
 * player wrote about themselves, they are not in the video, and nobody
 * who was sent a link needs them.
 *
 * Two cards rather than the app's swipeable deck: with the private cards
 * gone there are only ever two, and a carousel with two cards and a dot
 * pager is a control doing less than the plain grid underneath it.
 */
export function ShareStats({
  stats,
  momentum,
  you,
  them,
}: {
  stats: MatchStats;
  momentum: MatchAnalysis["momentum"];
  you: string;
  them: string;
}) {
  if (!stats.hasData) return null;

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">Match analysis</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 sm:gap-4">
        <div className="rounded-2xl border border-edge bg-surface p-4">
          <h3 className="text-sm font-semibold text-zinc-100">
            How it swung
          </h3>
          {momentum.steps.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Point differential
              </p>
              <MomentumChart momentum={momentum} />
            </div>
          )}
          <div className="mt-2 divide-y divide-edge/60">
            {momentum.bestRun && (
              <StatRow label="Best run">
                <span
                  className={
                    momentum.bestRun.who === "user"
                      ? "text-cyan-glow"
                      : "text-magenta-soft"
                  }
                >
                  {momentum.bestRun.len} in a row
                  <span className="ml-1.5 text-[11px] font-normal text-zinc-500">
                    {momentum.bestRun.who === "user" ? you : them}
                  </span>
                </span>
              </StatRow>
            )}
            <StatRow label="Furthest ahead / behind">
              <Pair you={momentum.peak} them={-momentum.trough} />
            </StatRow>
            <StatRow label="Lead changes">
              <span className="text-zinc-200">{momentum.leadChanges}</span>
            </StatRow>
            <StatRow label="Points won–lost">
              <Pair you={stats.won} them={stats.lost} />
            </StatRow>
          </div>
        </div>

        <div className="rounded-2xl border border-edge bg-surface p-4">
          <h3 className="text-sm font-semibold text-zinc-100">
            {you}&apos;s numbers
          </h3>
          <div className="mt-3 divide-y divide-edge/60">
            {stats.serverKnown && (
              <>
                <StatRow label="Serve win %">
                  <Pct {...stats.serve} />
                </StatRow>
                <StatRow label="Receive win %">
                  <Pct {...stats.receive} />
                </StatRow>
              </>
            )}
            <StatRow label="At 9+ in the game">
              <Pct {...stats.pressure} />
            </StatRow>
            <StatRow label="After losing a point">
              <Pct {...stats.bounceBack} />
            </StatRow>
            {stats.gamesYou + stats.gamesThem > 0 && (
              <StatRow label="Games won">
                <Pair you={stats.gamesYou} them={stats.gamesThem} />
              </StatRow>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
