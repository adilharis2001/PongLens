import assert from "node:assert/strict";
import test from "node:test";
import type { CostDashboardData } from "../../lib/costs/types.ts";
import {
  buildProviderCheckRows,
  buildSimulationBaseline,
  buildVendorRows,
  COST_SCALE_PRESETS,
  hasCostData,
} from "./costDashboardView.ts";

test("provider checks summarize aggregate provider usage", () => {
  const rows = buildProviderCheckRows(
    data({
      provider_snapshots: [
        providerSnapshot("OpenAI", {
          reported_cost_usd: 0.1224501,
        }),
        providerSnapshot("Deepgram", {
          usage: {
            requests: 2,
            billable_hours: 0.00252361,
            total_hours: 0.00252361,
          },
        }),
        providerSnapshot("Cloudflare", {
          usage: {
            objects: 1588,
            storage_bytes: 7_416_098_890,
            operation_requests: 4535,
          },
        }),
        providerSnapshot("Supabase", {
          usage: {
            auth_requests: 4,
            rest_requests: 12,
            realtime_requests: 3,
            storage_requests: 7,
          },
        }),
      ],
    }),
  );

  assert.deepEqual(
    rows.map((row) => row.provider),
    ["OpenAI", "Deepgram", "Cloudflare", "Supabase", "Resend"],
  );
  assert.equal(rows[0]?.source, "provider-reported");
  assert.equal(rows[0]?.reportedCostUsd, 0.1224501);
  assert.deepEqual(rows[1]?.usageSummary, [
    "2 requests",
    "0.2 billable audio min",
  ]);
  assert.deepEqual(rows[2]?.usageSummary, [
    "7.4 GB stored",
    "1.6K objects",
    "4.5K operations",
  ]);
  assert.deepEqual(rows[3]?.usageSummary, [
    "4 Auth",
    "12 REST",
    "3 Realtime",
    "7 Storage",
  ]);
  assert.equal(rows[4]?.source, "internal-meter");
});

test("unavailable Vercel is omitted but a configured snapshot is shown", () => {
  const unavailable = buildProviderCheckRows(data());
  assert.equal(
    unavailable.some((row) => row.provider === "Vercel"),
    false,
  );

  const configured = buildProviderCheckRows(
    data({
      provider_snapshots: [
        providerSnapshot("Vercel", {
          reported_cost_usd: 1.25,
        }),
      ],
    }),
  );
  assert.equal(configured[0]?.provider, "Vercel");
  assert.equal(configured[0]?.source, "provider-reported");
});

test("vendor rows sort by descending estimated cost", () => {
  const rows = buildVendorRows(
    data({
      providers: [
        { provider: "OpenAI", cost_usd: 2, last_event_at: "2026-07-29T00:00:00Z" },
        { provider: "Cloudflare", cost_usd: 5, last_event_at: "2026-07-29T00:00:00Z" },
      ],
    }),
    new Date("2026-07-29T12:00:00Z"),
  );

  assert.deepEqual(
    rows.map((row) => row.provider),
    ["Cloudflare", "OpenAI"],
  );
  assert.equal(rows[0]?.share, 5 / 7);
});

test("stale sources are surfaced without hiding their estimate", () => {
  const rows = buildVendorRows(
    data({
      providers: [
        { provider: "OpenAI", cost_usd: 3, last_event_at: "2026-07-20T00:00:00Z" },
      ],
    }),
    new Date("2026-07-29T12:00:00Z"),
  );

  assert.equal(rows[0]?.confidence, "stale");
  assert.equal(rows[0]?.costUsd, 3);
});

test("provider reconciliation is never added to internal total", () => {
  const rows = buildVendorRows(
    data({
      period: {
        start: "2026-07-01T00:00:00Z",
        end: "2026-07-30T00:00:00Z",
        total_usd: 4,
        variable_usd: 4,
        fixed_usd: 0,
      },
      providers: [
        { provider: "OpenAI", cost_usd: 4, last_event_at: "2026-07-29T00:00:00Z" },
      ],
      provider_snapshots: [
        {
          provider: "OpenAI",
          period_start: "2026-07-01T00:00:00Z",
          period_end: "2026-07-30T00:00:00Z",
          reported_cost_usd: 9,
          usage: {},
          status: "success",
          error_code: null,
          fetched_at: "2026-07-30T01:00:00Z",
        },
      ],
    }),
    new Date("2026-07-30T12:00:00Z"),
  );

  assert.equal(rows[0]?.costUsd, 4);
  assert.equal(rows[0]?.reportedCostUsd, 9);
});

test("10 100 and 5000 user presets produce labeled scenarios", () => {
  assert.deepEqual(COST_SCALE_PRESETS, [
    { label: "10 users", users: 10 },
    { label: "100 users", users: 100 },
    { label: "5,000 users", users: 5000 },
  ]);
});

test("empty data produces a ready-to-meter state", () => {
  assert.equal(hasCostData(data()), false);
  assert.equal(
    hasCostData(
      data({
        providers: [
          { provider: "OpenAI", cost_usd: 0.01, last_event_at: null },
        ],
      }),
    ),
    true,
  );
});

test("simulation baseline keeps fixed costs fixed and compute synthetic", () => {
  const baseline = buildSimulationBaseline(
    data({
      providers: [
        { provider: "OpenAI", cost_usd: 3, last_event_at: null },
        { provider: "Supabase", cost_usd: 25, last_event_at: null },
      ],
      fixed_items: [
        {
          id: "fixed-1",
          provider: "Supabase",
          label: "Pro",
          monthly_cost_usd: 25,
          effective_from: "2026-07-01",
          effective_to: null,
          enabled: true,
        },
      ],
      simulation_baseline: {
        registered_users: 9,
        active_users: 3,
        completed_matches: 6,
        retained_points: 300,
        observed_cost_usd: 28,
        compute_seconds: 600,
        storage_bytes: 10_000_000_000,
      },
    }),
  );

  assert.equal(
    baseline.coefficients.find((row) => row.provider === "Supabase")
      ?.fixedMonthlyUsd,
    25,
  );
  assert.ok(baseline.computeSecondsPerPoint > 0);
  assert.equal(
    baseline.coefficients.some(
      (row) => row.provider === "Synthetic cloud compute",
    ),
    false,
  );
});

function data(
  overrides: Partial<CostDashboardData> = {},
): CostDashboardData {
  return {
    period: {
      start: "2026-07-01T00:00:00Z",
      end: "2026-07-30T00:00:00Z",
      total_usd: 0,
      variable_usd: 0,
      fixed_usd: 0,
    },
    daily: [],
    providers: [],
    services: [],
    usage: [],
    fixed_items: [],
    provider_snapshots: [],
    unmapped: [],
    health: {
      first_event_at: null,
      last_event_at: null,
      latest_storage_snapshot_at: null,
      unmapped_count: 0,
    },
    simulation_baseline: {
      registered_users: 0,
      active_users: 0,
      completed_matches: 0,
      retained_points: 0,
      observed_cost_usd: 0,
      compute_seconds: 0,
      storage_bytes: 0,
    },
    ...overrides,
  };
}

function providerSnapshot(
  provider: string,
  overrides: Partial<CostDashboardData["provider_snapshots"][number]> = {},
): CostDashboardData["provider_snapshots"][number] {
  return {
    provider,
    period_start: "2026-07-28T00:00:00Z",
    period_end: "2026-07-29T00:00:00Z",
    reported_cost_usd: null,
    usage: {},
    status: "success",
    error_code: null,
    fetched_at: "2026-07-29T01:00:00Z",
    ...overrides,
  };
}
