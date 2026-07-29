/**
 * Feature flags.
 *
 * PAYMENTS_ENABLED gates every billing/plan/credits code path. It defaults
 * to off and the env var is intentionally set nowhere; nothing user-visible
 * exists while it is false. The matching database side (plans /
 * subscriptions / credits_ledger, migration 010) is equally dormant:
 * RLS-locked tables with inactive seed rows. Do not flip this on before
 * launch clearance.
 */
export const PAYMENTS_ENABLED =
  process.env.NEXT_PUBLIC_PAYMENTS_ENABLED === "true";

/** Application gates are intentionally independent from worker generation.
 * Evidence can be generated and audited before either behavior is exposed. */
export const RTMPOSE_FIRST_SERVER_ENABLED =
  process.env.NEXT_PUBLIC_RTMPOSE_FIRST_SERVER_ENABLED === "true";
export const RTMPOSE_BOUNDARIES_ENABLED =
  process.env.NEXT_PUBLIC_RTMPOSE_BOUNDARIES_ENABLED === "true";
