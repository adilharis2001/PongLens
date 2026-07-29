import type {
  CostDailyPoint,
  ProviderCostCoefficient,
  SimulationBaseline,
  SimulationInputs,
  SimulationResult,
} from "./types.ts";

export interface MonthProjection {
  monthToDateUsd: number;
  trailingDailyAverageUsd: number;
  projectedMonthEndUsd: number;
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function nonnegative(value: number): number {
  return Math.max(0, finite(value));
}

function boundedRate(value: number): number {
  return Math.min(1, Math.max(0.01, finite(value, 1)));
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}`;
}

export function projectMonthEnd(
  daily: CostDailyPoint[],
  now = new Date(),
): MonthProjection {
  const currentMonth = monthKey(now);
  const today = now.toISOString().slice(0, 10);
  const monthRows = daily
    .filter((point) => point.day.slice(0, 7) === currentMonth)
    .sort((a, b) => a.day.localeCompare(b.day));
  const monthToDateUsd = monthRows.reduce(
    (sum, point) => sum + nonnegative(Number(point.cost_usd)),
    0,
  );
  const completeDays = monthRows
    .filter((point) => point.day < today)
    .slice(-7);
  const trailingDailyAverageUsd =
    completeDays.length === 0
      ? 0
      : completeDays.reduce(
          (sum, point) => sum + nonnegative(Number(point.cost_usd)),
          0,
        ) / completeDays.length;
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const remainingDays = Math.max(0, daysInMonth - now.getUTCDate());

  return {
    monthToDateUsd,
    trailingDailyAverageUsd,
    projectedMonthEndUsd:
      monthToDateUsd + trailingDailyAverageUsd * remainingDays,
  };
}

function coefficientCost(
  coefficient: ProviderCostCoefficient,
  activity: {
    activeUsers: number;
    matches: number;
    videoMinutes: number;
    points: number;
    voiceMinutes: number;
    aiNotes: number;
    retainedGb: number;
    dashboardMultiplier: number;
  },
  includeFixedCosts: boolean,
): number {
  return (
    nonnegative(coefficient.perActiveUserUsd ?? 0) *
      activity.activeUsers *
      activity.dashboardMultiplier +
    nonnegative(coefficient.perMatchUsd ?? 0) * activity.matches +
    nonnegative(coefficient.perVideoMinuteUsd ?? 0) * activity.videoMinutes +
    nonnegative(coefficient.perPointUsd ?? 0) * activity.points +
    nonnegative(coefficient.perVoiceMinuteUsd ?? 0) * activity.voiceMinutes +
    nonnegative(coefficient.perAiNoteUsd ?? 0) * activity.aiNotes +
    nonnegative(coefficient.perRetainedGbUsd ?? 0) * activity.retainedGb +
    (includeFixedCosts
      ? nonnegative(coefficient.fixedMonthlyUsd ?? 0)
      : 0)
  );
}

export function simulatePlatformCost(
  baseline: SimulationBaseline,
  rawInputs: SimulationInputs,
): SimulationResult {
  const registeredUsers = Math.min(
    1_000_000,
    Math.max(1, Math.round(nonnegative(rawInputs.registeredUsers))),
  );
  const activeUserRate = Math.min(
    1,
    Math.max(0, finite(rawInputs.activeUserRate)),
  );
  const activeUsers = registeredUsers * activeUserRate;
  const matches =
    activeUsers * nonnegative(rawInputs.matchesPerActiveUser);
  const videoMinutes =
    matches * nonnegative(rawInputs.videoMinutesPerMatch);
  const points = matches * nonnegative(rawInputs.pointsPerMatch);
  const voiceMinutes =
    activeUsers * nonnegative(rawInputs.voiceMinutesPerActiveUser);
  const aiNotes =
    activeUsers * nonnegative(rawInputs.aiNotesPerActiveUser);
  const retainedGb =
    activeUsers * nonnegative(rawInputs.retainedGbPerActiveUser);
  const dashboardMultiplier = nonnegative(
    rawInputs.dashboardActivityMultiplier,
  );

  const byProvider = baseline.coefficients
    .map((coefficient) => ({
      provider: coefficient.provider,
      costUsd: coefficientCost(
        coefficient,
        {
          activeUsers,
          matches,
          videoMinutes,
          points,
          voiceMinutes,
          aiNotes,
          retainedGb,
          dashboardMultiplier,
        },
        rawInputs.includeFixedCosts,
      ),
      confidence: coefficient.confidence,
    }))
    .filter((row) => row.costUsd > 0);

  const computeSeconds =
    videoMinutes * nonnegative(baseline.computeSecondsPerVideoMinute) +
    points * nonnegative(baseline.computeSecondsPerPoint);
  const paidComputeHours =
    computeSeconds / 3600 / boundedRate(rawInputs.cloudWorkerUtilization);
  const syntheticComputeUsd =
    paidComputeHours * nonnegative(rawInputs.cloudWorkerHourlyUsd);
  if (syntheticComputeUsd > 0) {
    byProvider.push({
      provider: "Synthetic cloud compute",
      costUsd: syntheticComputeUsd,
      confidence: "assumed",
    });
  }

  byProvider.sort(
    (a, b) => b.costUsd - a.costUsd || a.provider.localeCompare(b.provider),
  );
  const monthlyTotalUsd = byProvider.reduce(
    (sum, row) => sum + row.costUsd,
    0,
  );
  const assumptions = [
    ...new Set(
      byProvider
        .filter((row) => row.confidence === "assumed")
        .map((row) => row.provider),
    ),
  ];

  return {
    monthlyTotalUsd,
    historicalMonthlyUsd: nonnegative(baseline.historicalMonthlyUsd),
    costPerRegisteredUserUsd: monthlyTotalUsd / registeredUsers,
    costPerActiveUserUsd:
      activeUsers > 0 ? monthlyTotalUsd / activeUsers : 0,
    costPerMatchUsd: matches > 0 ? monthlyTotalUsd / matches : 0,
    syntheticComputeUsd,
    byProvider,
    assumptions,
  };
}

export function formatCost(value: number): string {
  const amount = nonnegative(value);
  if (amount > 0 && amount < 0.01) {
    return `$${amount.toFixed(4)}`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

