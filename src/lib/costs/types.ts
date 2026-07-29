export type CostConfidence =
  | "metered"
  | "estimated"
  | "provider-reported"
  | "assumed"
  | "stale";

export interface CostDailyPoint {
  day: string;
  cost_usd: number;
  by_provider: Record<string, number>;
}

export interface CostProviderRow {
  provider: string;
  cost_usd: number;
  last_event_at: string | null;
}

export interface CostServiceRow {
  provider: string;
  service: string;
  cost_usd: number;
}

export interface CostUsageRow {
  provider: string;
  service: string;
  operation: string;
  sku: string;
  unit: string;
  quantity: number;
  cost_usd: number;
  price_per_unit_usd: number | null;
  source_url: string | null;
  source_label: string | null;
  confidence: CostConfidence;
}

export interface CostFixedItem {
  id: string;
  provider: string;
  label: string;
  monthly_cost_usd: number;
  effective_from: string;
  effective_to: string | null;
  enabled: boolean;
}

export interface CostProviderSnapshot {
  provider: string;
  period_start: string;
  period_end: string;
  reported_cost_usd: number | null;
  usage: Record<string, number | string | boolean | null>;
  status: "success" | "error";
  error_code: string | null;
  fetched_at: string;
}

export interface CostUnmappedRow {
  provider: string;
  service: string;
  sku: string;
  unit: string;
  quantity: number;
}

export interface CostDashboardData {
  period: {
    start: string;
    end: string;
    total_usd: number;
    variable_usd: number;
    fixed_usd: number;
  };
  daily: CostDailyPoint[];
  providers: CostProviderRow[];
  services: CostServiceRow[];
  usage: CostUsageRow[];
  fixed_items: CostFixedItem[];
  provider_snapshots: CostProviderSnapshot[];
  unmapped: CostUnmappedRow[];
  health: {
    first_event_at: string | null;
    last_event_at: string | null;
    latest_storage_snapshot_at: string | null;
    unmapped_count: number;
  };
  simulation_baseline: {
    registered_users: number;
    active_users: number;
    completed_matches: number;
    retained_points: number;
    observed_cost_usd: number;
    compute_seconds: number;
    storage_bytes: number;
  };
}

export interface SimulationInputs {
  registeredUsers: number;
  activeUserRate: number;
  matchesPerActiveUser: number;
  videoMinutesPerMatch: number;
  pointsPerMatch: number;
  voiceMinutesPerActiveUser: number;
  aiNotesPerActiveUser: number;
  retainedGbPerActiveUser: number;
  dashboardActivityMultiplier: number;
  cloudWorkerHourlyUsd: number;
  cloudWorkerUtilization: number;
  includeFixedCosts: boolean;
}

export interface ProviderCostCoefficient {
  provider: string;
  perActiveUserUsd?: number;
  perMatchUsd?: number;
  perVideoMinuteUsd?: number;
  perPointUsd?: number;
  perVoiceMinuteUsd?: number;
  perAiNoteUsd?: number;
  perRetainedGbUsd?: number;
  fixedMonthlyUsd?: number;
  confidence: CostConfidence;
}

export interface SimulationBaseline {
  historicalMonthlyUsd: number;
  coefficients: ProviderCostCoefficient[];
  computeSecondsPerVideoMinute: number;
  computeSecondsPerPoint: number;
}

export interface SimulationResult {
  monthlyTotalUsd: number;
  historicalMonthlyUsd: number;
  costPerRegisteredUserUsd: number;
  costPerActiveUserUsd: number;
  costPerMatchUsd: number;
  syntheticComputeUsd: number;
  byProvider: {
    provider: string;
    costUsd: number;
    confidence: CostConfidence;
  }[];
  assumptions: string[];
}

