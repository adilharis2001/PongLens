"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatCost } from "@/lib/costs/calculations";
import type { CostDashboardData } from "@/lib/costs/types";
import {
  buildPeopleRows,
  formatStoredBytes,
  type PeopleFilter,
} from "./costDashboardView";

/**
 * What each account costs to serve.
 *
 * Two numbers make one, and they are shown apart on purpose. **Measured**
 * is money the spending call itself attributed to that person. **Shared**
 * is their slice of everything with no single owner — stored bytes, the
 * database plan, the mailbox — divided by how much of the product they
 * used.
 *
 * The old page had only the second kind and did not say so, which made a
 * guess look like a reading. Worse, the division had gone stale: lesson
 * videos were not one of the things it counted, and lesson videos are now
 * the heaviest thing in the product, so a coach running twenty recaps
 * showed as nearly free while a player who left a single voice note
 * absorbed their transcription bill.
 *
 * Building costs are not here at all. Nobody's upload caused a
 * subscription, and charging one to a player would make the cheapest
 * account look expensive in the month a tool was bought.
 */

const FILTERS: { key: PeopleFilter; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "coaches", label: "Coaches" },
  { key: "players", label: "Players" },
];

export function CostPeopleTab({
  data,
  attributedShare,
}: {
  data: CostDashboardData;
  attributedShare: number;
}) {
  const [filter, setFilter] = useState<PeopleFilter>("all");
  const rows = useMemo(() => buildPeopleRows(data, filter), [data, filter]);
  const total = rows.reduce((sum, row) => sum + Number(row.cost_usd || 0), 0);
  const measured = Math.round(attributedShare * 100);

  return (
    <div className="mt-6 space-y-6">
      <div className="rounded-2xl border border-edge bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-zinc-300">
              {measured}% of metered spend in this period knows which account
              caused it. The rest is shared out by how much of the product
              each person used.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">
              Attribution started on 11 September 2026, so older periods are
              shared out entirely. Match processing on the Mac worker does
              not name an account yet, which is the largest remaining gap.
            </p>
          </div>
          <div className="flex gap-1 rounded-full border border-edge p-1">
            {FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setFilter(option.key)}
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  filter === option.key
                    ? "bg-zinc-100 text-zinc-950"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-edge bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-5 py-4">
          <h3 className="text-sm font-semibold text-zinc-200">
            {rows.length} {rows.length === 1 ? "account" : "accounts"}
          </h3>
          <p className="text-sm tabular-nums text-zinc-400">
            {formatCost(total)} between them
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-zinc-500">
            Nobody has cost anything in this period.
          </p>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs text-zinc-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Account</th>
                    <th className="px-3 py-3 text-right font-medium">Cost</th>
                    <th className="px-3 py-3 text-right font-medium">
                      Measured
                    </th>
                    <th className="px-3 py-3 text-right font-medium">Shared</th>
                    <th className="px-3 py-3 text-right font-medium">
                      Matches
                    </th>
                    <th className="px-3 py-3 text-right font-medium">Recaps</th>
                    <th className="px-5 py-3 text-right font-medium">Stored</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge/60">
                  {rows.map((row) => (
                    <tr key={row.user_id}>
                      <td className="px-5 py-3">
                        <Link
                          href={`/admin/players/${row.user_id}`}
                          className="font-medium text-zinc-200 transition-colors hover:text-white"
                        >
                          {row.name ?? row.email}
                        </Link>
                        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-600">
                          {row.name ? row.email : null}
                          {row.is_coach && (
                            <span className="rounded-full border border-cyan-glow/30 px-2 py-0.5 text-cyan-glow">
                              Coach
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums text-zinc-200">
                        {formatCost(row.cost_usd)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-zinc-400">
                        {Number(row.attributed_usd) > 0
                          ? formatCost(row.attributed_usd)
                          : "—"}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-zinc-500">
                        {formatCost(row.allocated_usd)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-zinc-500">
                        {row.matches || "—"}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-zinc-500">
                        {row.lesson_videos || "—"}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-zinc-500">
                        {formatStoredBytes(row.storage_bytes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-edge/60 md:hidden">
              {rows.map((row) => (
                <li key={row.user_id} className="space-y-3 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/admin/players/${row.user_id}`}
                        className="block truncate font-medium text-zinc-200"
                      >
                        {row.name ?? row.email}
                      </Link>
                      <p className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-600">
                        {row.is_coach && (
                          <span className="rounded-full border border-cyan-glow/30 px-2 py-0.5 text-cyan-glow">
                            Coach
                          </span>
                        )}
                        {formatStoredBytes(row.storage_bytes)} stored
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-medium tabular-nums text-zinc-200">
                      {formatCost(row.cost_usd)}
                    </p>
                  </div>
                  <p className="text-xs tabular-nums text-zinc-500">
                    {Number(row.attributed_usd) > 0
                      ? `${formatCost(row.attributed_usd)} measured · `
                      : ""}
                    {formatCost(row.allocated_usd)} shared
                    {row.matches > 0 ? ` · ${row.matches} matches` : ""}
                    {row.lesson_videos > 0
                      ? ` · ${row.lesson_videos} recaps`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
