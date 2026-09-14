export type CostConfidence =
  | "metered"
  | "estimated"
  | "provider-reported"
  | "assumed"
  | "stale";

export type CostUnit =
  | "input_token"
  | "cached_input_token"
  // An input token that missed the cache on a model that charges extra to
  // write one. See migration 114 and the note in meter.ts.
  | "cache_write_token"
  | "output_token"
  | "audio_second"
  | "gb_month"
  | "storage_byte_snapshot"
  | "class_a_operation"
  | "class_b_operation"
  | "email_recipient"
  | "compute_second"
  | "request"
  | "monthly_subscription"
  // A vendor-reported charge in cents, priced at $0.01 per unit. For fees
  // the provider computes for us (Stripe), where a percentage in a rate row
  // would be a guess and the exact number is already on the invoice.
  | "usd_cent";

export interface CostDailyPoint {
  day: string;
  /** Run cost for the day: metered spend plus the day's share of the
   *  recurring costs of keeping PongLens up. Build costs are not in here,
   *  because a subscription is a flat line and plotting it teaches
   *  nothing while swamping the spend that actually moves. */
  cost_usd: number;
  variable_usd: number;
  fixed_usd: number;
  /** The day's share of what it costs to BUILD the product. Reported so a
   *  reader can see the two side by side, never added into cost_usd. */
  build_usd: number;
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

/** Running PongLens for the people using it, or building it. Kept apart
 *  everywhere: adding a Claude subscription to a Deepgram minute destroys
 *  the only number that scales with users. */
export type CostCategory = "run" | "build";

export interface CostFixedItem {
  id: string;
  provider: string;
  label: string;
  /** The figure on the invoice, at whatever interval it arrives. */
  amount_usd: number;
  recurrence: "monthly" | "annual";
  /** Derived from amount and recurrence, so an annual bill is entered as
   *  the annual number and divided once, in the database. */
  monthly_cost_usd: number;
  category: CostCategory;
  note: string | null;
  effective_from: string;
  effective_to: string | null;
  enabled: boolean;
}

/** A domain, a device, a paid dataset. Never smeared across the months as
 *  though it recurs, so a month that contains one reads as more expensive
 *  than a month that does not, which is the truth. */
export interface CostOneTimeItem {
  id: string;
  provider: string;
  label: string;
  amount_usd: number;
  incurred_on: string;
  category: CostCategory;
  note: string | null;
}

/** What one account cost over the period.
 *
 *  `attributed_usd` is money we know that person caused, because the call
 *  that spent it said so. `allocated_usd` is their share of everything
 *  with no single owner, divided by how much of the product they used.
 *  The two are reported apart so the reader can see how much of the
 *  number is a fact. */
export interface CostPersonRow {
  user_id: string;
  email: string;
  name: string | null;
  is_coach: boolean;
  attributed_usd: number;
  /** Share of pooled METERED spend, weighted by work done — video seconds
   *  and stored bytes, not a count of events. Counting let a failed
   *  eight-second upload draw the same share as a 45-minute match. */
  variable_usd: number;
  /** Share of recurring infrastructure. Amortisation rather than
   *  causation: Supabase does not cost more because somebody uploaded. */
  fixed_usd: number;
  allocated_usd: number;
  cost_usd: number;
  matches: number;
  lesson_videos: number;
  storage_bytes: number;
}

/**
 * What the PROVIDER says one API key spent over the period.
 *
 * A second, independent reading of the same money. Our ledger records the
 * code that made a call and never the credential it used, so it cannot tell
 * a corpus run from a player's upload — both reach the same function. Since
 * each purpose got its own key the provider can answer that, and it answers
 * for spend the meter never saw at all.
 *
 * `mapped` false means this key has never been described. It is still shown,
 * under its raw id: a cost that silently belongs to nobody is the problem
 * this exists to surface, so the ugliness is the notification.
 */
export interface CostProviderKeyRow {
  key_id: string;
  label: string;
  product: string;
  /** 'mixed' is the honest answer for a key that served several purposes
   *  and can never be untangled. It counts toward neither bucket. */
  category: "run" | "build" | "mixed" | "unmapped";
  mapped: boolean;
  cost_usd: number;
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
    /** Everything: what it costs to run PongLens and what it costs to
     *  build it. The burn rate. */
    total_usd: number;
    variable_usd: number;
    fixed_usd: number;
    /** Serving the people who use PongLens. */
    run_usd: number;
    run_variable_usd: number;
    run_fixed_usd: number;
    /** Making PongLens. Never divided across players: nobody's upload
     *  caused a subscription. */
    build_usd: number;
    build_fixed_usd: number;
    one_time_run_usd: number;
    one_time_build_usd: number;
  };
  daily: CostDailyPoint[];
  providers: CostProviderRow[];
  services: CostServiceRow[];
  usage: CostUsageRow[];
  fixed_items: CostFixedItem[];
  one_time_items: CostOneTimeItem[];
  provider_keys: CostProviderKeyRow[];
  people: CostPersonRow[];
  provider_snapshots: CostProviderSnapshot[];
  unmapped: CostUnmappedRow[];
  health: {
    first_event_at: string | null;
    last_event_at: string | null;
    latest_storage_snapshot_at: string | null;
    unmapped_count: number;
    /** How much of the metered spend knows who caused it. This is what
     *  says how far to trust the People tab, and it climbs on its own as
     *  more call sites learn to name a subject. */
    attributed_usd: number;
    unattributed_usd: number;
    /** When the per-key provider costs were last written. The job that
     *  fills them runs from a sealed worker release, not from main, so it
     *  can stop without anything failing — and a split that has quietly
     *  stopped moving is worse than one that is missing. */
    provider_keys_fetched_at: string | null;
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
