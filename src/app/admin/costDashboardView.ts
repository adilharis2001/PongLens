import type {
  CostConfidence,
  CostDashboardData,
  ProviderCostCoefficient,
  SimulationBaseline,
} from "../../lib/costs/types.ts";

export const COST_SCALE_PRESETS = [
  { label: "10 users", users: 10 },
  { label: "100 users", users: 100 },
  { label: "5,000 users", users: 5000 },
] as const;

export interface VendorViewRow {
  provider: string;
  costUsd: number;
  share: number;
  confidence: CostConfidence;
  lastUpdatedAt: string | null;
  reportedCostUsd: number | null;
  discrepancyUsd: number | null;
  usageSummary: string[];
}

export interface ProviderCheckViewRow {
  provider: string;
  source:
    | "provider-reported"
    | "provider-usage"
    | "internal-meter"
    | "sync-error";
  reportedCostUsd: number | null;
  usageSummary: string[];
  fetchedAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface FeatureCostViewRow {
  feature: string;
  costUsd: number;
  providers: string[];
  operations: string[];
  usageSummary: string[];
}

const PROVIDER_CHECK_ORDER = [
  "OpenAI",
  "Deepgram",
  "Cloudflare",
  "Supabase",
  "Vercel",
] as const;

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function confidenceFor(
  data: CostDashboardData,
  provider: string,
): CostConfidence {
  const confidences = data.usage
    .filter((row) => row.provider === provider)
    .map((row) => row.confidence);
  if (confidences.includes("assumed")) return "assumed";
  if (confidences.includes("estimated")) return "estimated";
  if (confidences.includes("metered")) return "metered";
  return "estimated";
}

function compactQuantity(quantity: number, unit: string): string {
  if (unit.endsWith("_token")) {
    return `${new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(quantity)} ${unit.replaceAll("_", " ")}s`;
  }
  if (unit === "audio_second") {
    return `${(quantity / 60).toFixed(quantity >= 600 ? 0 : 1)} audio min`;
  }
  if (unit === "compute_second") {
    return `${(quantity / 3600).toFixed(1)} compute hr`;
  }
  if (unit === "gb_month") {
    return `${quantity.toFixed(1)} GB-month`;
  }
  return `${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(quantity)} ${unit.replaceAll("_", " ")}`;
}

function featureForOperation(operation: string): string {
  if (operation.startsWith("recollect_")) return "Recollect";
  const labels: Record<string, string> = {
    lesson_summary: "Lesson summaries",
    journal_ocr: "Journal photo reading",
    entry_image_validation: "Journal image checks",
    feedback_triage: "Feedback assistance",
  };
  return (
    labels[operation] ??
    operation
      .replaceAll("_", " ")
      .replace(/^\w/, (character) => character.toUpperCase())
  );
}

export function buildFeatureCostRows(
  data: CostDashboardData,
): FeatureCostViewRow[] {
  const groups = new Map<
    string,
    {
      costUsd: number;
      providers: Set<string>;
      operations: Set<string>;
      quantities: Map<string, number>;
    }
  >();

  for (const usage of data.usage) {
    if (!usage.operation) continue;
    const feature = featureForOperation(usage.operation);
    const group = groups.get(feature) ?? {
      costUsd: 0,
      providers: new Set<string>(),
      operations: new Set<string>(),
      quantities: new Map<string, number>(),
    };
    group.costUsd += Math.max(0, numeric(usage.cost_usd));
    group.providers.add(usage.provider);
    group.operations.add(usage.operation);
    group.quantities.set(
      usage.unit,
      (group.quantities.get(usage.unit) ?? 0) +
        Math.max(0, numeric(usage.quantity)),
    );
    groups.set(feature, group);
  }

  return [...groups]
    .map(([feature, group]) => ({
      feature,
      costUsd: group.costUsd,
      providers: [...group.providers].sort(),
      operations: [...group.operations].sort(),
      usageSummary: [...group.quantities]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([unit, quantity]) => compactQuantity(quantity, unit)),
    }))
    .sort(
      (a, b) => b.costUsd - a.costUsd || a.feature.localeCompare(b.feature),
    );
}

function compactCount(value: unknown): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(numeric(value));
}

function providerUsageSummary(
  provider: string,
  usage: CostDashboardData["provider_snapshots"][number]["usage"],
): string[] {
  if (provider === "Deepgram") {
    return [
      `${compactCount(usage.requests)} requests`,
      `${(numeric(usage.billable_hours) * 60).toFixed(1)} billable audio min`,
    ];
  }
  if (provider === "Cloudflare") {
    return [
      `${(numeric(usage.storage_bytes) / 1_000_000_000).toFixed(1)} GB stored`,
      `${compactCount(usage.objects)} objects`,
      `${compactCount(usage.operation_requests)} operations`,
    ];
  }
  if (provider === "Supabase") {
    return [
      `${compactCount(usage.auth_requests)} Auth`,
      `${compactCount(usage.rest_requests)} REST`,
      `${compactCount(usage.realtime_requests)} Realtime`,
      `${compactCount(usage.storage_requests)} Storage`,
    ];
  }
  if (provider === "Vercel") {
    return [`${compactCount(usage.charges)} charge records`];
  }
  return [];
}

export function buildProviderCheckRows(
  data: CostDashboardData,
): ProviderCheckViewRow[] {
  const snapshots = new Map(
    data.provider_snapshots.map((snapshot) => [
      snapshot.provider,
      snapshot,
    ]),
  );
  const rows: ProviderCheckViewRow[] = [];

  for (const provider of PROVIDER_CHECK_ORDER) {
    const snapshot = snapshots.get(provider);
    if (!snapshot) continue;
    const reportedCostUsd =
      snapshot.reported_cost_usd == null
        ? null
        : Math.max(0, numeric(snapshot.reported_cost_usd));
    rows.push({
      provider,
      source:
        snapshot.status === "error"
          ? "sync-error"
          : reportedCostUsd != null
            ? "provider-reported"
            : "provider-usage",
      reportedCostUsd,
      usageSummary:
        snapshot.status === "error"
          ? [
              snapshot.error_code
                ? `Sync failed (${snapshot.error_code})`
                : "Provider sync failed",
            ]
          : providerUsageSummary(provider, snapshot.usage),
      fetchedAt: snapshot.fetched_at,
      periodStart: snapshot.period_start,
      periodEnd: snapshot.period_end,
    });
  }

  rows.push({
    provider: "Resend",
    source: "internal-meter",
    reportedCostUsd: null,
    usageSummary: ["Recipient usage is metered inside PongLens"],
    fetchedAt: data.health.last_event_at,
    periodStart: null,
    periodEnd: null,
  });
  return rows;
}

export function buildVendorRows(
  data: CostDashboardData,
  now = new Date(),
): VendorViewRow[] {
  const total = data.providers.reduce(
    (sum, row) => sum + Math.max(0, numeric(row.cost_usd)),
    0,
  );
  const staleBefore = now.getTime() - 72 * 60 * 60 * 1000;

  return data.providers
    .map((provider) => {
      const costUsd = Math.max(0, numeric(provider.cost_usd));
      const snapshot = data.provider_snapshots.find(
        (row) => row.provider === provider.provider && row.status === "success",
      );
      const reportedCostUsd =
        snapshot?.reported_cost_usd == null
          ? null
          : numeric(snapshot.reported_cost_usd);
      const lastUpdatedAt = provider.last_event_at;
      const stale =
        lastUpdatedAt != null &&
        new Date(lastUpdatedAt).getTime() < staleBefore;
      const usageSummary = data.usage
        .filter((row) => row.provider === provider.provider)
        .sort((a, b) => numeric(b.cost_usd) - numeric(a.cost_usd))
        .slice(0, 3)
        .map((row) => compactQuantity(numeric(row.quantity), row.unit));

      return {
        provider: provider.provider,
        costUsd,
        share: total > 0 ? costUsd / total : 0,
        confidence: stale
          ? ("stale" as const)
          : confidenceFor(data, provider.provider),
        lastUpdatedAt,
        reportedCostUsd,
        discrepancyUsd:
          reportedCostUsd == null ? null : reportedCostUsd - costUsd,
        usageSummary,
      };
    })
    .sort(
      (a, b) => b.costUsd - a.costUsd || a.provider.localeCompare(b.provider),
    );
}

export function hasCostData(data: CostDashboardData): boolean {
  return (
    data.providers.length > 0 ||
    data.usage.length > 0 ||
    data.fixed_items.length > 0
  );
}

function observedDays(data: CostDashboardData): number {
  const start = new Date(data.period.start).getTime();
  const end = new Date(data.period.end).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 30;
  }
  return Math.max(1, (end - start) / (24 * 60 * 60 * 1000));
}

function providerConfidence(
  data: CostDashboardData,
  provider: string,
): CostConfidence {
  return confidenceFor(data, provider);
}

export function buildSimulationBaseline(
  data: CostDashboardData,
): SimulationBaseline {
  const days = observedDays(data);
  const monthFactor = 30 / days;
  const activeUsers = Math.max(1, data.simulation_baseline.active_users);
  const completedMatches = Math.max(
    1,
    data.simulation_baseline.completed_matches,
  );
  const retainedPoints = Math.max(
    1,
    data.simulation_baseline.retained_points,
  );
  const fixedByProvider = new Map<string, number>();
  for (const item of data.fixed_items) {
    if (!item.enabled) continue;
    fixedByProvider.set(
      item.provider,
      (fixedByProvider.get(item.provider) ?? 0) +
        Math.max(0, numeric(item.monthly_cost_usd)),
    );
  }

  const coefficients: ProviderCostCoefficient[] = data.providers.map((row) => {
    const provider = row.provider;
    const fixedMonthlyUsd = fixedByProvider.get(provider) ?? 0;
    const monthlyObserved = Math.max(0, numeric(row.cost_usd)) * monthFactor;
    const variableMonthly = Math.max(0, monthlyObserved - fixedMonthlyUsd);
    const common = {
      provider,
      fixedMonthlyUsd: fixedMonthlyUsd || undefined,
      confidence: providerConfidence(data, provider),
    };

    if (provider === "OpenAI") {
      return {
        ...common,
        perMatchUsd: variableMonthly / (completedMatches * monthFactor),
      };
    }
    if (provider === "Deepgram") {
      const rate = data.usage.find(
        (usage) =>
          usage.provider === provider && usage.unit === "audio_second",
      )?.price_per_unit_usd;
      return {
        ...common,
        perVoiceMinuteUsd:
          rate == null || numeric(rate) <= 0
            ? variableMonthly / activeUsers
            : numeric(rate) * 60,
      };
    }
    if (provider === "Cloudflare") {
      const retainedGb =
        Math.max(0, data.simulation_baseline.storage_bytes) / 1_000_000_000;
      return {
        ...common,
        perRetainedGbUsd:
          retainedGb > 0 ? variableMonthly / retainedGb : 0.015,
      };
    }
    return {
      ...common,
      perActiveUserUsd: variableMonthly / activeUsers,
    };
  });

  for (const [provider, fixedMonthlyUsd] of fixedByProvider) {
    if (coefficients.some((row) => row.provider === provider)) continue;
    coefficients.push({
      provider,
      fixedMonthlyUsd,
      confidence: "estimated",
    });
  }

  const computeSeconds = Math.max(
    0,
    numeric(data.simulation_baseline.compute_seconds),
  );
  const estimatedVideoMinutes = completedMatches * 24;

  return {
    historicalMonthlyUsd:
      Math.max(0, numeric(data.period.total_usd)) * monthFactor,
    coefficients,
    computeSecondsPerVideoMinute:
      computeSeconds > 0
        ? (computeSeconds * 0.8) / estimatedVideoMinutes
        : 45,
    computeSecondsPerPoint:
      computeSeconds > 0
        ? (computeSeconds * 0.2) / retainedPoints
        : 5,
  };
}
