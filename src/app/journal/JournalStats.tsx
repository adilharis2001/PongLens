"use client";

import Link from "next/link";
import { MyStats } from "@/app/stats/StatsView";
import { useAggregateStats } from "@/app/stats/useAggregate";

/**
 * The Journal's Stats tab: the same "My stats" panel /stats renders, on
 * the page where the numbers were always going to be looked for.
 *
 * Mounted only while the tab is open, so opening the Journal never pays
 * for it. The walk itself is shared with /stats and Home (see
 * useAggregate), which is why coming back to this tab is instant.
 */
export function JournalStats({
  userId,
  accountName,
}: {
  userId: string;
  accountName: string | null;
}) {
  const agg = useAggregateStats(userId, accountName);

  if (agg === null) {
    return (
      <div className="mt-4">
        <p className="text-sm text-zinc-500">Counting points…</p>
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-edge bg-surface"
            />
          ))}
        </div>
      </div>
    );
  }

  if (agg.matchesWithScores === 0) {
    return (
      <div className="mt-4 rounded-2xl border border-edge bg-surface p-6 text-center">
        <p className="text-sm text-zinc-300">Nothing to count yet.</p>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-zinc-500">
          Score the points in your matches and this tab builds itself: serve
          and receive, pressure points, patterns across every match.
        </p>
        <Link
          href="/matches"
          className="mt-4 inline-block rounded-full bg-cyan-glow px-4 py-2 text-sm font-semibold text-ink"
        >
          Go to matches
        </Link>
      </div>
    );
  }

  return (
    <>
      <MyStats agg={agg} />
      <p className="mt-6 text-xs text-zinc-500">
        <Link href="/stats?view=tactics" className="hover:text-zinc-300">
          Tactics, and the same numbers on their own page
        </Link>
      </p>
    </>
  );
}
