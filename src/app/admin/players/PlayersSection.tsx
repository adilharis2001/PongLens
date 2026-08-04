"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCost } from "@/lib/costs/calculations";
import { countLabel, gbLabel, type PlayerOverviewRow } from "./playersView";

/**
 * Every account, heaviest uploader first (admin_player_overview, 068).
 * Each row opens the player's own page. Cost is the estimated allocation
 * from _admin_user_cost_allocation, so the column sums to platform spend.
 */

export function PlayersSection() {
  const router = useRouter();
  const [rows, setRows] = useState<PlayerOverviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void supabase.rpc("admin_player_overview").then(({ data, error }) => {
      if (error) setError(error.message);
      else setRows((data as PlayerOverviewRow[]) ?? []);
    });
  }, []);

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }
  if (rows === null) {
    return (
      <div className="h-40 animate-pulse rounded-2xl border border-edge bg-surface" />
    );
  }
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500">No players yet.</p>;
  }

  return (
    <>
      {/* Wide: one table row per player */}
      <div className="hidden overflow-hidden rounded-2xl border border-edge bg-surface md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="px-5 py-3 font-medium">Player</th>
                <th className="px-3 py-3 font-medium">Matches</th>
                <th className="px-3 py-3 font-medium">Points</th>
                <th className="px-3 py-3 font-medium">Stars</th>
                <th className="px-3 py-3 font-medium">Notes</th>
                <th className="px-3 py-3 font-medium">Exports</th>
                <th className="px-3 py-3 font-medium">Storage</th>
                <th className="px-5 py-3 text-right font-medium">Est. cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge/60">
              {rows.map((row) => (
                <tr
                  key={row.user_id}
                  onClick={() => router.push(`/admin/players/${row.user_id}`)}
                  className="group cursor-pointer transition-colors hover:bg-surface-2/40"
                >
                  <td className="px-5 py-3">
                    <Link
                      href={`/admin/players/${row.user_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium text-zinc-200 group-hover:text-cyan-glow"
                    >
                      {row.name || row.email}
                    </Link>
                    <span className="mt-0.5 block text-xs text-zinc-600">
                      {row.email}
                    </span>
                  </td>
                  <td className="px-3 py-3 tabular-nums text-zinc-200">
                    {row.matches}
                    {row.matches_scored > 0 && (
                      <span className="mt-0.5 block text-xs font-normal text-zinc-600">
                        {row.matches_scored} scored
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-zinc-300">
                    {row.points}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-zinc-300">
                    {row.starred}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-zinc-300">
                    {row.notes}
                    {row.voice_notes > 0 && (
                      <span className="mt-0.5 block text-xs text-zinc-600">
                        {row.voice_notes} voice
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-zinc-300">
                    {row.exports}
                    {row.share_links > 0 && (
                      <span className="mt-0.5 block text-xs text-zinc-600">
                        {row.share_links} shares
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-zinc-300">
                    {gbLabel(row.used_bytes)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-zinc-200">
                    {formatCost(row.est_cost_usd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Narrow: one card per player */}
      <ul className="divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface md:hidden">
        {rows.map((row) => (
          <li key={row.user_id}>
            <Link
              href={`/admin/players/${row.user_id}`}
              className="block px-4 py-3 transition-colors hover:bg-surface-2/40"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-medium text-zinc-200">
                  {row.name || row.email}
                </p>
                <p className="shrink-0 text-sm tabular-nums text-zinc-300">
                  {formatCost(row.est_cost_usd)}
                </p>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {countLabel(row.matches, "match", "matches")} ·{" "}
                {row.matches_scored} scored ·{" "}
                {countLabel(row.points, "point")} ·{" "}
                {countLabel(row.starred, "star")}
              </p>
              <p className="mt-0.5 text-xs text-zinc-600">
                {countLabel(row.notes, "note")} ·{" "}
                {countLabel(row.exports, "export")} ·{" "}
                {gbLabel(row.used_bytes)}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-zinc-600">
        Cost is an estimated split of platform spend by each player&apos;s
        storage and activity.
      </p>
    </>
  );
}
