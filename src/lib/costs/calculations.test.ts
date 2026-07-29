import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCost,
  projectMonthEnd,
  simulatePlatformCost,
} from "./calculations.ts";
import type {
  CostDailyPoint,
  SimulationBaseline,
  SimulationInputs,
} from "./types.ts";

test("month projection uses the trailing seven complete days", () => {
  const daily: CostDailyPoint[] = Array.from({ length: 10 }, (_, index) => ({
    day: `2026-07-${String(index + 19).padStart(2, "0")}`,
    cost_usd: index < 3 ? 2 : 7,
    by_provider: {},
  }));

  const result = projectMonthEnd(daily, new Date("2026-07-29T16:00:00Z"));

  // MTD is 55. The seven complete days Jul 22-28 average $7 and there are
  // two days after Jul 29.
  assert.equal(result.monthToDateUsd, 55);
  assert.equal(result.trailingDailyAverageUsd, 7);
  assert.equal(result.projectedMonthEndUsd, 69);
});

test("simulation scales variable usage without scaling fixed items", () => {
  const result = simulatePlatformCost(
    baseline(),
    inputs({ registeredUsers: 100, activeUserRate: 0.5 }),
  );

  // 50 active users: $50 active-user variable + $20 fixed.
  assert.equal(result.monthlyTotalUsd, 70);
  assert.equal(result.costPerRegisteredUserUsd, 0.7);
  assert.equal(
    result.byProvider.find((row) => row.provider === "Supabase")?.costUsd,
    20,
  );
});

test("cloud paid hours divide workload by bounded utilization", () => {
  const result = simulatePlatformCost(
    baseline({
      coefficients: [],
      computeSecondsPerVideoMinute: 60,
      computeSecondsPerPoint: 0,
    }),
    inputs({
      registeredUsers: 10,
      activeUserRate: 1,
      matchesPerActiveUser: 1,
      videoMinutesPerMatch: 60,
      pointsPerMatch: 0,
      cloudWorkerHourlyUsd: 2,
      cloudWorkerUtilization: 0.5,
    }),
  );

  // Ten one-hour workloads become 20 paid hours at 50% utilization.
  assert.equal(result.syntheticComputeUsd, 40);
  assert.equal(result.monthlyTotalUsd, 40);
});

test("historical total excludes synthetic compute", () => {
  const result = simulatePlatformCost(
    baseline({
      historicalMonthlyUsd: 123,
      coefficients: [],
      computeSecondsPerVideoMinute: 60,
    }),
    inputs({
      registeredUsers: 1,
      activeUserRate: 1,
      matchesPerActiveUser: 1,
      videoMinutesPerMatch: 60,
      pointsPerMatch: 0,
      cloudWorkerHourlyUsd: 3,
      cloudWorkerUtilization: 1,
    }),
  );

  assert.equal(result.historicalMonthlyUsd, 123);
  assert.equal(result.syntheticComputeUsd, 3);
  assert.equal(result.monthlyTotalUsd, 3);
});

test("missing coefficients remain assumed and visible", () => {
  const result = simulatePlatformCost(
    baseline({
      coefficients: [
        {
          provider: "OpenAI",
          perActiveUserUsd: 0.2,
          confidence: "assumed",
        },
      ],
    }),
    inputs({ registeredUsers: 10, activeUserRate: 1 }),
  );

  assert.equal(result.byProvider[0]?.confidence, "assumed");
  assert.deepEqual(result.assumptions, ["OpenAI"]);
});

test("currency formatting preserves sub-cent costs", () => {
  assert.equal(formatCost(12.345), "$12.35");
  assert.equal(formatCost(0.0042), "$0.0042");
  assert.equal(formatCost(0), "$0.00");
});

function baseline(
  overrides: Partial<SimulationBaseline> = {},
): SimulationBaseline {
  return {
    historicalMonthlyUsd: 10,
    coefficients: [
      {
        provider: "Vercel",
        perActiveUserUsd: 1,
        confidence: "estimated",
      },
      {
        provider: "Supabase",
        fixedMonthlyUsd: 20,
        confidence: "estimated",
      },
    ],
    computeSecondsPerVideoMinute: 0,
    computeSecondsPerPoint: 0,
    ...overrides,
  };
}

function inputs(overrides: Partial<SimulationInputs> = {}): SimulationInputs {
  return {
    registeredUsers: 10,
    activeUserRate: 0.5,
    matchesPerActiveUser: 0,
    videoMinutesPerMatch: 0,
    pointsPerMatch: 0,
    voiceMinutesPerActiveUser: 0,
    aiNotesPerActiveUser: 0,
    retainedGbPerActiveUser: 0,
    dashboardActivityMultiplier: 1,
    cloudWorkerHourlyUsd: 0,
    cloudWorkerUtilization: 1,
    includeFixedCosts: true,
    ...overrides,
  };
}
