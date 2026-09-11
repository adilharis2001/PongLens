import assert from "node:assert/strict";
import test from "node:test";
import type {
  CostDashboardData,
  CostPersonRow,
} from "../../lib/costs/types.ts";
import {
  buildBurnSummary,
  buildFeatureCostRows,
  buildPeopleRows,
  buildProviderCheckRows,
  buildSimulationBaseline,
  buildVendorRows,
  COST_SCALE_PRESETS,
  formatStoredBytes,
  hasCostData,
} from "./costDashboardView.ts";

test("feature costs combine both metered Recollect operations", () => {
  const rows = buildFeatureCostRows(
    data({
      usage: [
        usage("recollect_extraction", "input_token", 1200, 0.0012),
        usage("recollect_extraction", "output_token", 200, 0.0008),
        usage("recollect_validation", "input_token", 500, 0.0005),
        usage("lesson_summary", "input_token", 900, 0.0009),
      ],
    }),
  );

  const recollect = rows.find((row) => row.feature === "Recollect");
  assert.equal(recollect?.costUsd, 0.0025);
  assert.deepEqual(recollect?.operations, [
    "recollect_extraction",
    "recollect_validation",
  ]);
  assert.deepEqual(recollect?.providers, ["OpenAI"]);
});

test("the three Stripe fees read as one cost of selling a review", () => {
  const stripe = (
    operation: string,
    quantity: number,
    cost_usd: number,
  ): CostDashboardData["usage"][number] => ({
    provider: "Stripe",
    service: "Payments",
    operation,
    sku: "stripe-fee",
    unit: "usd_cent",
    quantity,
    cost_usd,
    price_per_unit_usd: 0.01,
    source_url: null,
    source_label: null,
    confidence: "metered",
  });

  const rows = buildFeatureCostRows(
    data({
      usage: [
        stripe("review_charge", 175, 1.75),
        stripe("coach_payout", 37, 0.37),
        stripe("connect_active_account", 200, 2),
      ],
    }),
  );

  const payments = rows.find(
    (row) => row.feature === "Coach review payments",
  );
  assert.equal(payments?.costUsd, 4.12);
  assert.deepEqual(payments?.operations, [
    "coach_payout",
    "connect_active_account",
    "review_charge",
  ]);
  // Money, not a count of 412 things.
  assert.deepEqual(payments?.usageSummary, ["$4.12 in fees"]);
});

test("review emails are their own feature, not a write-up tool", () => {
  const rows = buildFeatureCostRows(
    data({
      usage: [
        usage("review_tidy", "input_token", 900, 0.0004),
        usage("review_check", "input_token", 600, 0.0002),
        {
          provider: "Resend",
          service: "Email",
          operation: "review_email_order_paid",
          sku: "resend-email",
          unit: "email_recipient",
          quantity: 3,
          cost_usd: 0,
          price_per_unit_usd: 0,
          source_url: null,
          source_label: null,
          confidence: "metered",
        },
      ],
    }),
  );

  const tools = rows.find((row) => row.feature === "Review write-up tools");
  assert.ok(Math.abs((tools?.costUsd ?? 0) - 0.0006) < 1e-9);
  // review_email_* shares the review_ prefix and must not fall in with it.
  const emails = rows.find((row) => row.feature === "Review emails");
  assert.deepEqual(emails?.operations, ["review_email_order_paid"]);
});

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
        run_usd: 4,
        run_variable_usd: 4,
        run_fixed_usd: 0,
        build_usd: 0,
        build_fixed_usd: 0,
        one_time_run_usd: 0,
        one_time_build_usd: 0,
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
          amount_usd: 25,
          recurrence: "monthly" as const,
          monthly_cost_usd: 25,
          category: "run" as const,
          note: null,
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
      run_usd: 0,
      run_variable_usd: 0,
      run_fixed_usd: 0,
      build_usd: 0,
      build_fixed_usd: 0,
      one_time_run_usd: 0,
      one_time_build_usd: 0,
    },
    daily: [],
    providers: [],
    services: [],
    usage: [],
    fixed_items: [],
    one_time_items: [],
    people: [],
    provider_snapshots: [],
    unmapped: [],
    health: {
      first_event_at: null,
      last_event_at: null,
      latest_storage_snapshot_at: null,
      unmapped_count: 0,
      attributed_usd: 0,
      unattributed_usd: 0,
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

function usage(
  operation: string,
  unit: string,
  quantity: number,
  cost_usd: number,
): CostDashboardData["usage"][number] {
  return {
    provider: "OpenAI",
    service: "api",
    operation,
    sku: "gpt-5-mini",
    unit,
    quantity,
    cost_usd,
    price_per_unit_usd: null,
    source_url: null,
    source_label: null,
    confidence: "metered",
  };
}

function person(over: Partial<CostPersonRow> = {}): CostPersonRow {
  return {
    user_id: "u-1",
    email: "a@example.com",
    name: null,
    is_coach: false,
    attributed_usd: 0,
    allocated_usd: 0,
    cost_usd: 0,
    matches: 0,
    lesson_videos: 0,
    storage_bytes: 0,
    ...over,
  };
}

test("run and build costs are reported apart and never summed into one", () => {
  const summary = buildBurnSummary(
    data({
      period: {
        start: "2026-09-01T00:00:00Z",
        end: "2026-09-11T00:00:00Z",
        total_usd: 172,
        variable_usd: 12,
        fixed_usd: 160,
        run_usd: 32,
        run_variable_usd: 12,
        run_fixed_usd: 20,
        build_usd: 140,
        build_fixed_usd: 140,
        one_time_run_usd: 0,
        one_time_build_usd: 0,
      },
    }),
  );
  assert.equal(summary.runUsd, 32);
  assert.equal(summary.buildUsd, 140);
  assert.equal(summary.totalUsd, 172);
  assert.equal(summary.days, 10);
  assert.equal(summary.runPerDayUsd, 3.2);
});

test("an annual bill counts as its monthly twelfth in the recurring total", () => {
  // Entered as the number on the invoice; divided once, in the database.
  const summary = buildBurnSummary(
    data({
      fixed_items: [
        {
          id: "f-1",
          provider: "Apple",
          label: "Developer Program",
          amount_usd: 99,
          recurrence: "annual" as const,
          monthly_cost_usd: 8.25,
          category: "build" as const,
          note: null,
          effective_from: "2026-07-11",
          effective_to: null,
          enabled: true,
        },
        {
          id: "f-2",
          provider: "Supabase",
          label: "Plan",
          amount_usd: 50,
          recurrence: "monthly" as const,
          monthly_cost_usd: 50,
          category: "run" as const,
          note: null,
          effective_from: "2026-07-11",
          effective_to: null,
          enabled: true,
        },
      ],
    }),
  );
  assert.equal(summary.monthlyBuildFixedUsd, 8.25);
  assert.equal(summary.monthlyRunFixedUsd, 50);
  assert.equal(summary.monthlyFixedUsd, 58.25);
});

test("a disabled recurring cost stops counting", () => {
  const summary = buildBurnSummary(
    data({
      fixed_items: [
        {
          id: "f-1",
          provider: "OpenAI",
          label: "ChatGPT",
          amount_usd: 200,
          recurrence: "monthly" as const,
          monthly_cost_usd: 200,
          category: "build" as const,
          note: null,
          effective_from: "2026-07-11",
          effective_to: null,
          enabled: false,
        },
      ],
    }),
  );
  assert.equal(summary.monthlyBuildFixedUsd, 0);
});

test("the attributed share says how much of the People tab is measured", () => {
  const summary = buildBurnSummary(
    data({
      health: {
        first_event_at: null,
        last_event_at: null,
        latest_storage_snapshot_at: null,
        unmapped_count: 0,
        attributed_usd: 3,
        unattributed_usd: 1,
      },
    }),
  );
  assert.equal(summary.attributedShare, 0.75);
});

test("nothing metered yet reads as nothing attributed, not as a divide by zero", () => {
  const summary = buildBurnSummary(data());
  assert.equal(summary.attributedShare, 0);
  assert.ok(Number.isFinite(summary.runPerDayUsd));
});

test("people are listed dearest first and can be split by workspace", () => {
  const payload = data({
    people: [
      person({ user_id: "p", email: "p@x.com", cost_usd: 2 }),
      person({ user_id: "c", email: "c@x.com", cost_usd: 9, is_coach: true }),
    ],
  });
  assert.deepEqual(
    buildPeopleRows(payload).map((row) => row.user_id),
    ["c", "p"],
  );
  assert.deepEqual(
    buildPeopleRows(payload, "coaches").map((row) => row.user_id),
    ["c"],
  );
  assert.deepEqual(
    buildPeopleRows(payload, "players").map((row) => row.user_id),
    ["p"],
  );
});

test("stored bytes read in the units a person uses", () => {
  assert.equal(formatStoredBytes(0), "None");
  assert.equal(formatStoredBytes(250_000), "250 KB");
  assert.equal(formatStoredBytes(4_500_000), "5 MB");
  assert.equal(formatStoredBytes(2_400_000_000), "2.4 GB");
});

test("narrowing to a few days re-adds the totals from those days only", () => {
  const day = (
    d: string,
    cost: number,
    variable: number,
    build: number,
  ) => ({
    day: d,
    cost_usd: cost,
    variable_usd: variable,
    fixed_usd: cost - variable,
    build_usd: build,
    by_provider: {},
  });
  const payload = data({
    period: {
      start: "2026-09-01T00:00:00Z",
      end: "2026-09-04T00:00:00Z",
      total_usd: 999,
      variable_usd: 999,
      fixed_usd: 0,
      run_usd: 999,
      run_variable_usd: 999,
      run_fixed_usd: 0,
      build_usd: 999,
      build_fixed_usd: 999,
      one_time_run_usd: 0,
      one_time_build_usd: 0,
    },
    daily: [
      day("2026-09-01", 3, 1, 13),
      day("2026-09-02", 4, 2, 13),
      day("2026-09-03", 5, 3, 13),
    ],
    one_time_items: [
      {
        id: "o-1",
        provider: "Namecheap",
        label: "Domain",
        amount_usd: 12,
        incurred_on: "2026-09-02",
        category: "build" as const,
        note: null,
      },
      {
        id: "o-2",
        provider: "Apple",
        label: "Outside the window",
        amount_usd: 500,
        incurred_on: "2026-08-02",
        category: "build" as const,
        note: null,
      },
    ],
  });
  const summary = buildBurnSummary(payload, payload.daily.slice(1));
  assert.equal(summary.days, 2);
  assert.equal(summary.runUsd, 9);
  // 13 + 13 of subscription, plus the domain bought inside the window and
  // not the one bought before it.
  assert.equal(summary.buildUsd, 38);
  assert.equal(summary.totalUsd, 47);
});

test("the burn rate carries the run rate forward and adds the cost of building", () => {
  const summary = buildBurnSummary(
    data({
      period: {
        start: "2026-09-01T00:00:00Z",
        end: "2026-09-11T00:00:00Z",
        total_usd: 0,
        variable_usd: 0,
        fixed_usd: 0,
        run_usd: 20,
        run_variable_usd: 20,
        run_fixed_usd: 0,
        build_usd: 0,
        build_fixed_usd: 0,
        one_time_run_usd: 0,
        one_time_build_usd: 0,
      },
      fixed_items: [
        {
          id: "f-1",
          provider: "Anthropic",
          label: "Claude Max",
          amount_usd: 200,
          recurrence: "monthly" as const,
          monthly_cost_usd: 200,
          category: "build" as const,
          note: null,
          effective_from: "2026-07-11",
          effective_to: null,
          enabled: true,
        },
      ],
    }),
  );
  // $2/day over ten days, carried to thirty, plus the subscription.
  assert.equal(summary.monthlyAtThisRateUsd, 260);
});
