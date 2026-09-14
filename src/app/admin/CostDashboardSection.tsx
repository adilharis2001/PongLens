"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCost, simulatePlatformCost } from "@/lib/costs/calculations";
import type { CostDashboardData, SimulationInputs } from "@/lib/costs/types";
import {
  buildBurnSummary,
  buildProviderKeySplit,
  buildFeatureCostRows,
  buildProviderCheckRows,
  buildSimulationBaseline,
  buildVendorRows,
  COST_SCALE_PRESETS,
  hasCostData,
} from "./costDashboardView";
import { CostBuildingTab } from "./CostBuildingTab";
import { CostPeopleTab } from "./CostPeopleTab";

/**
 * The cost page, in four tabs.
 *
 * It used to be one long scroll with a single total at the top, and that
 * total quietly answered the wrong question: it mixed what PongLens costs
 * to RUN (about twelve dollars a month, and it grows with players) with
 * what it costs to BUILD (about four hundred, and it does not). Whichever
 * way you read the one number, the other half was hidden inside it.
 *
 * So the split is the organising idea, not a filter on top of one:
 *
 *   Overview  the three figures, and the shape of the last N days
 *   Running   what serving players actually costs, by vendor and feature
 *   Building  every bill that is not metered, and where they are entered
 *   People    what each account costs
 *
 * The range selector refetches rather than filtering what is already
 * loaded. It costs one query per press and it means every tab — People
 * included — is talking about the same days, which a client-side filter
 * could not give, because cost per person is computed in the database.
 */

type RangeKey = "7d" | "30d" | "month" | "90d";
type TabKey = "overview" | "running" | "building" | "people";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
  { key: "90d", label: "90 days" },
];

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "running", label: "Running" },
  { key: "building", label: "Building" },
  { key: "people", label: "People" },
];

const INITIAL_SIMULATION: SimulationInputs = {
  registeredUsers: 100,
  activeUserRate: 0.4,
  matchesPerActiveUser: 2,
  videoMinutesPerMatch: 25,
  pointsPerMatch: 40,
  voiceMinutesPerActiveUser: 0.5,
  aiNotesPerActiveUser: 3,
  retainedGbPerActiveUser: 1.5,
  dashboardActivityMultiplier: 1,
  cloudWorkerHourlyUsd: 1.5,
  cloudWorkerUtilization: 0.65,
  includeFixedCosts: true,
};

function rangeStart(range: RangeKey, now: Date): Date {
  const start = new Date(now);
  if (range === "month") {
    start.setUTCDate(1);
  } else {
    start.setUTCDate(start.getUTCDate() - (range === "7d" ? 7 : range === "30d" ? 30 : 90) + 1);
  }
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

export function CostDashboardSection() {
  const [data, setData] = useState<CostDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>("30d");
  const [tab, setTab] = useState<TabKey>("overview");
  const [simulationInputs, setSimulationInputs] =
    useState<SimulationInputs>(INITIAL_SIMULATION);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const end = new Date();
    const supabase = createClient();
    const { data: payload, error: rpcError } = await supabase.rpc(
      "get_platform_cost_dashboard",
      {
        p_start: rangeStart(range, end).toISOString(),
        p_end: end.toISOString(),
      },
    );
    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }
    setData(payload as CostDashboardData);
    setLoading(false);
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const burn = useMemo(() => (data ? buildBurnSummary(data) : null), [data]);
  const vendorRows = useMemo(
    () => (data ? buildVendorRows(data) : []),
    [data],
  );
  const providerCheckRows = useMemo(
    () => (data ? buildProviderCheckRows(data) : []),
    [data],
  );
  const featureRows = useMemo(
    () => (data ? buildFeatureCostRows(data) : []),
    [data],
  );
  const keySplit = useMemo(
    () => (data ? buildProviderKeySplit(data) : null),
    [data],
  );
  const simulation = useMemo(() => {
    if (!data) return null;
    return simulatePlatformCost(
      buildSimulationBaseline(data),
      simulationInputs,
    );
  }, [data, simulationInputs]);

  const daily = data?.daily ?? [];
  const maxDaily = Math.max(
    0.000001,
    ...daily.map((point) => Number(point.cost_usd || 0)),
  );

  return (
    <section aria-label="Platform costs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* A grid on phones so all four sit on one line at 393px. Wrapping
            put "People" alone on a second row, which reads as a mistake and
            costs a third of the header to say nothing. */}
        <div className="grid w-full grid-cols-4 gap-1 rounded-full border border-edge p-1 sm:flex sm:w-auto">
          {TABS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setTab(option.key)}
              className={`rounded-full px-2 py-1.5 text-sm transition-colors sm:px-4 ${
                tab === option.key
                  ? "bg-zinc-100 text-zinc-950"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-full border border-edge p-1">
            {RANGES.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setRange(option.key)}
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  range === option.key
                    ? "bg-zinc-100 text-zinc-950"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:text-white disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
          <p className="text-sm text-red-300">
            Cost data could not be loaded: {error}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            The rest of the admin portal is unaffected.
          </p>
        </div>
      )}

      {loading && !data ? (
        <div className="mt-4 h-32 animate-pulse rounded-2xl border border-edge bg-surface" />
      ) : data && burn && !hasCostData(data) ? (
        <div className="mt-4 rounded-2xl border border-edge bg-surface p-6">
          <p className="text-sm font-medium text-zinc-200">
            The cost meter is ready.
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            Totals will appear as newly instrumented API calls and worker jobs
            run. Historical backfill and provider connections can be added
            without changing this dashboard.
          </p>
        </div>
      ) : data && burn ? (
        <>
          {tab === "overview" && (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Running"
                  value={formatCost(burn.runUsd)}
                  detail={`Serving players over ${burn.days} ${
                    burn.days === 1 ? "day" : "days"
                  }`}
                />
                <MetricCard
                  label="Building"
                  value={formatCost(burn.buildUsd)}
                  detail="Subscriptions and tools that make the product"
                />
                <MetricCard
                  label="Total burn"
                  value={formatCost(burn.totalUsd)}
                  detail="Everything, for the selected period"
                />
                <MetricCard
                  label="A month at this rate"
                  value={formatCost(burn.monthlyAtThisRateUsd)}
                  detail={`${formatCost(burn.runPerDayUsd)}/day running, plus ${formatCost(
                    burn.monthlyBuildFixedUsd,
                  )} building`}
                  accent
                />
              </div>

              <div className="mt-6 rounded-2xl border border-edge bg-surface p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold text-zinc-200">
                    Running cost per day
                  </h3>
                  <p className="text-xs text-zinc-500">
                    The dim part of each bar is the recurring floor; the bright
                    part is what the day itself spent.
                  </p>
                </div>
                <div
                  className="mt-5 flex h-40 items-end gap-px border-b border-edge/70"
                  role="img"
                  aria-label="Running cost per day"
                >
                  {daily.map((point) => {
                    const total = Number(point.cost_usd || 0);
                    const variable = Number(point.variable_usd || 0);
                    return (
                      <div
                        key={point.day}
                        className="group relative flex min-w-0 flex-1 flex-col justify-end"
                        style={{ height: "100%" }}
                        title={`${point.day}: ${formatCost(total)} (${formatCost(
                          variable,
                        )} metered)`}
                      >
                        <div
                          className="w-full rounded-t-sm bg-cyan-glow/70 transition-colors group-hover:bg-cyan-glow"
                          style={{
                            height: `${
                              (Math.min(variable, total) / maxDaily) * 100
                            }%`,
                          }}
                        />
                        <div
                          className="w-full bg-cyan-glow/20"
                          style={{
                            height: `${
                              (Math.max(0, total - variable) / maxDaily) * 100
                            }%`,
                          }}
                        />
                        <span className="sr-only">
                          {point.day}: {formatCost(total)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex justify-between text-[11px] text-zinc-600">
                  <span>{daily[0]?.day ?? "No activity"}</span>
                  <span>{daily.at(-1)?.day ?? ""}</span>
                </div>
              </div>

              <div className="mt-6 overflow-hidden rounded-2xl border border-edge bg-surface">
                <div className="border-b border-edge px-5 py-4">
                  <h3 className="text-sm font-semibold text-zinc-200">
                    Where the running cost went
                  </h3>
                </div>
                {vendorRows.length > 0 ? (
                  <ul className="divide-y divide-edge/60">
                    {vendorRows.slice(0, 6).map((row) => (
                      <li
                        key={row.provider}
                        className="flex items-center gap-4 px-5 py-3"
                      >
                        <span className="w-28 shrink-0 truncate text-sm text-zinc-200">
                          {row.provider}
                        </span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                          <span
                            className="block h-full rounded-full bg-cyan-glow/70"
                            style={{ width: `${Math.max(1, row.share * 100)}%` }}
                          />
                        </span>
                        <span className="w-20 shrink-0 text-right text-sm tabular-nums text-zinc-300">
                          {formatCost(row.costUsd)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-5 py-6 text-sm text-zinc-500">
                    Nothing metered in this period.
                  </p>
                )}
              </div>
            </>
          )}

          {tab === "running" && (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <MetricCard
                  label="Metered"
                  value={formatCost(burn.runUsd - data.period.run_fixed_usd)}
                  detail="Charged per call, per minute, per byte"
                />
                <MetricCard
                  label="Recurring"
                  value={formatCost(data.period.run_fixed_usd)}
                  detail={`${formatCost(burn.monthlyRunFixedUsd)} a month`}
                />
                <MetricCard
                  label="Running, total"
                  value={formatCost(burn.runUsd)}
                  detail={`${formatCost(burn.runPerDayUsd)} a day`}
                />
              </div>

              {keySplit && keySplit.totalUsd > 0 && (
                <div className="mt-6 overflow-hidden rounded-2xl border border-edge bg-surface">
                  <div className="border-b border-edge px-5 py-4">
                    <h3 className="text-sm font-semibold text-zinc-200">
                      What each OpenAI key spent
                    </h3>
                    <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-500">
                      Reported by OpenAI, not by our meter. This is the only
                      reading that separates research from production, and the
                      only one that sees spend the meter never recorded.
                    </p>
                    {(() => {
                      const at = data.health.provider_keys_fetched_at;
                      const days = at
                        ? (Date.now() - Date.parse(at)) / 86_400_000
                        : Infinity;
                      // The job that writes this runs from a sealed worker
                      // release. It can stop without anything failing, so the
                      // page says when it last ran rather than presenting old
                      // numbers as current.
                      return (
                        <p
                          className={`mt-2 text-xs ${
                            days > 2 ? "text-amber-300" : "text-zinc-600"
                          }`}
                        >
                          {at
                            ? `Last collected ${new Date(at).toLocaleString()}${
                                days > 2
                                  ? " — stale, so these figures are not current"
                                  : ""
                              }`
                            : "Never collected"}
                        </p>
                      );
                    })()}
                  </div>
                  <div className="grid gap-px bg-edge/60 sm:grid-cols-2 lg:grid-cols-4">
                    <KeyFigure label="Running" value={keySplit.runUsd} />
                    <KeyFigure label="Building" value={keySplit.buildUsd} />
                    <KeyFigure
                      label="Cannot be split"
                      value={keySplit.mixedUsd}
                      detail="Keys that served several purposes at once"
                    />
                    <KeyFigure
                      label="Not described yet"
                      value={keySplit.unmappedUsd}
                      detail={
                        keySplit.unmappedRows.length > 0
                          ? `${keySplit.unmappedRows.length} key(s) need a label`
                          : "None"
                      }
                      warning={keySplit.unmappedUsd > 0}
                    />
                  </div>
                  <ul className="divide-y divide-edge/60 border-t border-edge">
                    {keySplit.rows.map((row) => (
                      <li
                        key={row.key_id}
                        className="flex flex-wrap items-center gap-3 px-5 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-200">
                            {row.label}
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[11px] ${
                                row.category === "build"
                                  ? "border-cyan-glow/30 text-cyan-glow"
                                  : row.category === "run"
                                    ? "border-edge text-zinc-400"
                                    : "border-amber-500/40 text-amber-300"
                              }`}
                            >
                              {row.category === "run"
                                ? "Running"
                                : row.category === "build"
                                  ? "Building"
                                  : row.category === "mixed"
                                    ? "Mixed"
                                    : "Not described"}
                            </span>
                            {row.product !== "PongLens" && row.mapped && (
                              <span className="rounded-full border border-edge px-2 py-0.5 text-[11px] text-zinc-500">
                                {row.product}
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 font-mono text-[11px] text-zinc-600">
                            {row.key_id}
                          </p>
                        </div>
                        <p className="shrink-0 text-sm tabular-nums text-zinc-200">
                          {formatCost(row.cost_usd)}
                        </p>
                      </li>
                    ))}
                  </ul>
                  {keySplit.otherProductUsd > 0 && (
                    <p className="border-t border-edge px-5 py-3 text-xs text-zinc-500">
                      {formatCost(keySplit.otherProductUsd)} on keys belonging
                      to other products, excluded from PongLens totals.
                    </p>
                  )}
                </div>
              )}

              <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.6fr)]">
                <div className="overflow-hidden rounded-2xl border border-edge bg-surface">
                  <div className="border-b border-edge px-5 py-4">
                    <h3 className="text-sm font-semibold text-zinc-200">
                      Vendor breakdown
                    </h3>
                  </div>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[660px] text-left text-sm">
                      <thead className="text-xs text-zinc-500">
                        <tr>
                          <th className="px-5 py-3 font-medium">Vendor</th>
                          <th className="px-3 py-3 font-medium">Estimated</th>
                          <th className="px-3 py-3 font-medium">Share</th>
                          <th className="px-3 py-3 font-medium">
                            Primary usage
                          </th>
                          <th className="px-5 py-3 text-right font-medium">
                            Confidence
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-edge/60">
                        {vendorRows.map((row) => (
                          <tr key={row.provider}>
                            <td className="px-5 py-3 font-medium text-zinc-200">
                              {row.provider}
                              {row.reportedCostUsd != null && (
                                <span className="mt-0.5 block text-[11px] font-normal text-zinc-600">
                                  Provider: {formatCost(row.reportedCostUsd)}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3 tabular-nums text-zinc-200">
                              {formatCost(row.costUsd)}
                            </td>
                            <td className="px-3 py-3 tabular-nums text-zinc-400">
                              {(row.share * 100).toFixed(1)}%
                            </td>
                            <td className="max-w-xs px-3 py-3 text-xs text-zinc-500">
                              {row.usageSummary.join(" · ") ||
                                "Fixed or estimated"}
                            </td>
                            <td className="px-5 py-3 text-right">
                              <ConfidenceBadge confidence={row.confidence} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <ul className="divide-y divide-edge/60 md:hidden">
                    {vendorRows.map((row) => (
                      <li key={row.provider} className="space-y-3 px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-zinc-200">
                              {row.provider}
                            </p>
                            <p className="mt-0.5 text-xs text-zinc-500">
                              {row.usageSummary.join(" · ") ||
                                "Fixed or estimated"}
                            </p>
                          </div>
                          <p className="shrink-0 tabular-nums text-zinc-200">
                            {formatCost(row.costUsd)}
                          </p>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs tabular-nums text-zinc-500">
                            {(row.share * 100).toFixed(1)}% of estimate
                          </span>
                          <ConfidenceBadge confidence={row.confidence} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-2xl border border-edge bg-surface p-5">
                  <h3 className="text-sm font-semibold text-zinc-200">
                    Data health
                  </h3>
                  <dl className="mt-4 space-y-3 text-sm">
                    <HealthRow
                      label="Latest usage"
                      value={
                        data.health.last_event_at
                          ? new Date(data.health.last_event_at).toLocaleString()
                          : "Waiting for first event"
                      }
                    />
                    <HealthRow
                      label="Storage snapshot"
                      value={
                        data.health.latest_storage_snapshot_at
                          ? new Date(
                              data.health.latest_storage_snapshot_at,
                            ).toLocaleString()
                          : "Not collected yet"
                      }
                    />
                    <HealthRow
                      label="Unpriced usage"
                      value={
                        data.health.unmapped_count > 0
                          ? `${data.health.unmapped_count} event(s)`
                          : "None"
                      }
                      warning={data.health.unmapped_count > 0}
                    />
                    <HealthRow
                      label="Knows who caused it"
                      value={`${Math.round(burn.attributedShare * 100)}% of metered spend`}
                    />
                  </dl>
                </div>
              </div>

              <div className="mt-6 overflow-hidden rounded-2xl border border-edge bg-surface">
                <div className="border-b border-edge px-5 py-4">
                  <h3 className="text-sm font-semibold text-zinc-200">
                    Feature breakdown
                  </h3>
                </div>
                {featureRows.length > 0 ? (
                  <ul className="divide-y divide-edge/60">
                    {featureRows.map((row) => (
                      <li
                        key={row.feature}
                        className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-zinc-200">
                            {row.feature}
                          </p>
                          <p className="mt-1 truncate text-xs text-zinc-500">
                            {row.providers.join(", ")} ·{" "}
                            {row.usageSummary.join(" · ")}
                          </p>
                        </div>
                        <p className="shrink-0 text-sm font-medium tabular-nums text-zinc-200">
                          {formatCost(row.costUsd)}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-5 py-6 text-sm text-zinc-500">
                    Feature costs will appear after the first metered request.
                  </p>
                )}
              </div>

              <div className="mt-6 overflow-hidden rounded-2xl border border-edge bg-surface">
                <div className="border-b border-edge px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-200">
                        Provider reconciliation
                      </h3>
                      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-500">
                        Dollar totals are used when a provider supplies them.
                        Otherwise PongLens prices provider-metered usage. Daily
                        checks may lag recent activity.
                      </p>
                    </div>
                    <span className="rounded-full border border-edge px-2.5 py-1 text-[11px] text-zinc-500">
                      No double counting
                    </span>
                  </div>
                </div>
                <ul className="grid gap-px bg-edge/60 md:grid-cols-2 xl:grid-cols-3">
                  {providerCheckRows.map((row) => (
                    <ProviderCheckCard key={row.provider} row={row} />
                  ))}
                </ul>
              </div>

              <Simulator
                inputs={simulationInputs}
                setInputs={setSimulationInputs}
                result={simulation}
              />
            </>
          )}

          {tab === "building" && (
            <CostBuildingTab
              fixedItems={data.fixed_items}
              oneTimeItems={data.one_time_items}
              monthlyBuildUsd={burn.monthlyBuildFixedUsd}
              monthlyRunUsd={burn.monthlyRunFixedUsd}
              onChanged={() => void load()}
            />
          )}

          {tab === "people" && (
            <CostPeopleTab
              data={data}
              attributedShare={burn.attributedShare}
            />
          )}
        </>
      ) : null}
    </section>
  );
}

function KeyFigure({
  label,
  value,
  detail,
  warning,
}: {
  label: string;
  value: number;
  detail?: string;
  warning?: boolean;
}) {
  return (
    <div className="bg-surface p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          warning ? "text-amber-300" : "text-zinc-100"
        }`}
      >
        {formatCost(value)}
      </p>
      {detail && <p className="mt-1 text-[11px] text-zinc-600">{detail}</p>}
    </div>
  );
}

function ProviderCheckCard({
  row,
}: {
  row: ReturnType<typeof buildProviderCheckRows>[number];
}) {
  const status = {
    "provider-reported": {
      label: "Provider reported",
      tone: "text-emerald-400",
    },
    "provider-usage": {
      label: "Provider usage",
      tone: "text-sky-400",
    },
    "internal-meter": {
      label: "Internal meter",
      tone: "text-zinc-500",
    },
    "sync-error": {
      label: "Sync error",
      tone: "text-red-400",
    },
  }[row.source];
  const period =
    row.periodStart && row.periodEnd
      ? `${new Date(row.periodStart).toLocaleDateString()}–${new Date(
          row.periodEnd,
        ).toLocaleDateString()}`
      : null;

  return (
    <li className="min-w-0 bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-zinc-200">{row.provider}</p>
        <span className={`shrink-0 text-[11px] ${status.tone}`}>
          {status.label}
        </span>
      </div>
      {row.reportedCostUsd != null && (
        <p className="mt-3 text-xl font-semibold tabular-nums text-zinc-100">
          {formatCost(row.reportedCostUsd)}
        </p>
      )}
      {row.usageSummary.length > 0 && (
        <p className="mt-2 break-words text-xs leading-relaxed text-zinc-500">
          {row.usageSummary.join(" · ")}
        </p>
      )}
      {(row.fetchedAt || period) && (
        <p className="mt-3 text-[11px] text-zinc-600">
          {row.fetchedAt
            ? `Checked ${new Date(row.fetchedAt).toLocaleString()}`
            : "Waiting for first check"}
          {period ? ` · ${period}` : ""}
        </p>
      )}
    </li>
  );
}

function MetricCard({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        accent
          ? "border-cyan-glow/30 bg-cyan-glow/5"
          : "border-edge bg-surface"
      }`}
    >
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">
        {value}
      </p>
      <p className="mt-1 text-xs text-zinc-600">{detail}</p>
    </div>
  );
}

function ConfidenceBadge({
  confidence,
}: {
  confidence: string;
}) {
  const tone =
    confidence === "metered"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : confidence === "stale"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
        : confidence === "assumed"
          ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
          : "border-sky-500/30 bg-sky-500/10 text-sky-300";
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] capitalize ${tone}`}
    >
      {confidence.replace("-", " ")}
    </span>
  );
}

function HealthRow({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-zinc-500">{label}</dt>
      <dd
        className={`text-right text-xs ${
          warning ? "text-amber-300" : "text-zinc-300"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function Simulator({
  inputs,
  setInputs,
  result,
}: {
  inputs: SimulationInputs;
  setInputs: React.Dispatch<React.SetStateAction<SimulationInputs>>;
  result: ReturnType<typeof simulatePlatformCost> | null;
}) {
  const setNumber = (key: keyof SimulationInputs, value: string) => {
    const number = Number(value);
    setInputs((current) => ({
      ...current,
      [key]: Number.isFinite(number) ? number : 0,
    }));
  };

  return (
    <div className="mt-6 rounded-2xl border border-edge bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">
            Scale simulator
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-500">
            Reprices aggregate platform behavior at a future scale. Cloud
            compute uses measured worker time when available and is always
            labeled synthetic.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {COST_SCALE_PRESETS.map((preset) => (
            <button
              key={preset.users}
              type="button"
              onClick={() =>
                setInputs((current) => ({
                  ...current,
                  registeredUsers: preset.users,
                }))
              }
              className={`rounded-full border px-3 py-1 text-xs ${
                inputs.registeredUsers === preset.users
                  ? "border-cyan-glow/50 text-cyan-glow"
                  : "border-edge text-zinc-400"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
        <NumberField
          label="Registered users"
          value={inputs.registeredUsers}
          onChange={(value) => setNumber("registeredUsers", value)}
          min={1}
        />
        <NumberField
          label="Active users"
          value={inputs.activeUserRate * 100}
          onChange={(value) =>
            setNumber("activeUserRate", String(Number(value) / 100))
          }
          min={0}
          max={100}
          suffix="%"
        />
        <NumberField
          label="Matches / active user"
          value={inputs.matchesPerActiveUser}
          onChange={(value) => setNumber("matchesPerActiveUser", value)}
          min={0}
          step={0.5}
        />
        <NumberField
          label="Video minutes / match"
          value={inputs.videoMinutesPerMatch}
          onChange={(value) => setNumber("videoMinutesPerMatch", value)}
          min={0}
        />
        <NumberField
          label="Points / match"
          value={inputs.pointsPerMatch}
          onChange={(value) => setNumber("pointsPerMatch", value)}
          min={0}
        />
        <NumberField
          label="Voice min / active user"
          value={inputs.voiceMinutesPerActiveUser}
          onChange={(value) =>
            setNumber("voiceMinutesPerActiveUser", value)
          }
          min={0}
          step={0.5}
        />
        <NumberField
          label="AI notes / active user"
          value={inputs.aiNotesPerActiveUser}
          onChange={(value) => setNumber("aiNotesPerActiveUser", value)}
          min={0}
        />
        <NumberField
          label="Retained GB / active user"
          value={inputs.retainedGbPerActiveUser}
          onChange={(value) => setNumber("retainedGbPerActiveUser", value)}
          min={0}
          step={0.5}
        />
        <NumberField
          label="Dashboard activity"
          value={inputs.dashboardActivityMultiplier}
          onChange={(value) =>
            setNumber("dashboardActivityMultiplier", value)
          }
          min={0}
          step={0.25}
          suffix="×"
        />
        <NumberField
          label="Cloud worker / hour"
          value={inputs.cloudWorkerHourlyUsd}
          onChange={(value) => setNumber("cloudWorkerHourlyUsd", value)}
          min={0}
          step={0.1}
          prefix="$"
        />
        <NumberField
          label="Worker utilization"
          value={inputs.cloudWorkerUtilization * 100}
          onChange={(value) =>
            setNumber("cloudWorkerUtilization", String(Number(value) / 100))
          }
          min={1}
          max={100}
          suffix="%"
        />
        <label className="flex items-end">
          <span className="flex h-10 w-full items-center gap-2 rounded-xl border border-edge bg-surface-2/30 px-3 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={inputs.includeFixedCosts}
              onChange={(event) =>
                setInputs((current) => ({
                  ...current,
                  includeFixedCosts: event.target.checked,
                }))
              }
              className="accent-cyan-glow"
            />
            Include fixed costs
          </span>
        </label>
      </div>

      {result && (
        <div className="mt-6 grid gap-5 border-t border-edge pt-5 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-xs text-zinc-500">Estimated monthly cost</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-zinc-100">
              {formatCost(result.monthlyTotalUsd)}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <ResultMetric
                label="Per registered user"
                value={formatCost(result.costPerRegisteredUserUsd)}
              />
              <ResultMetric
                label="Per active user"
                value={formatCost(result.costPerActiveUserUsd)}
              />
              <ResultMetric
                label="Per match"
                value={formatCost(result.costPerMatchUsd)}
              />
              <ResultMetric
                label="Cloud compute"
                value={formatCost(result.syntheticComputeUsd)}
              />
            </dl>
            {result.assumptions.length > 0 && (
              <p className="mt-4 text-[11px] leading-relaxed text-violet-300/80">
                Assumed inputs: {result.assumptions.join(", ")}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-500">
              Scenario by vendor
            </p>
            <ul className="mt-2 divide-y divide-edge/60 rounded-xl border border-edge/70">
              {result.byProvider.map((row) => (
                <li
                  key={row.provider}
                  className="flex items-center gap-3 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate text-zinc-300">
                    {row.provider}
                  </span>
                  <ConfidenceBadge confidence={row.confidence} />
                  <span className="w-20 text-right tabular-nums text-zinc-200">
                    {formatCost(row.costUsd)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  prefix,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <label>
      <span className="block text-xs text-zinc-500">{label}</span>
      <span className="mt-1 flex h-10 items-center rounded-xl border border-edge bg-surface-2/30 px-3 focus-within:border-cyan-glow/50">
        {prefix && <span className="text-xs text-zinc-600">{prefix}</span>}
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent px-1 text-sm tabular-nums text-zinc-200 outline-none"
        />
        {suffix && <span className="text-xs text-zinc-600">{suffix}</span>}
      </span>
    </label>
  );
}

function ResultMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2/40 p-3">
      <dt className="text-zinc-600">{label}</dt>
      <dd className="mt-1 font-medium tabular-nums text-zinc-300">{value}</dd>
    </div>
  );
}
