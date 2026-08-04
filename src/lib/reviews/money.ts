/**
 * Money display and fee math. Mirrors review_fee_for() in migration 073 —
 * the database snapshot is the truth at purchase; this exists so the
 * offering editor can show a coach what they would receive under the
 * current config without a round trip.
 */

export type ReviewFeeMode = "percent" | "fixed";

export interface ReviewFeeConfig {
  mode: ReviewFeeMode;
  percent: number;
  fixedCents: number;
}

export const DEFAULT_FEE_CONFIG: ReviewFeeConfig = {
  mode: "percent",
  percent: 15,
  fixedCents: 500,
};

/** Same clamping and rounding as the SQL. */
export function platformFeeCents(
  priceCents: number,
  cfg: ReviewFeeConfig,
): number {
  if (cfg.mode === "fixed") {
    return Math.min(Math.max(cfg.fixedCents, 0), priceCents);
  }
  const fee = Math.round((priceCents * cfg.percent) / 100);
  return Math.min(Math.max(fee, 0), priceCents);
}

export function coachShareCents(
  priceCents: number,
  cfg: ReviewFeeConfig,
): number {
  return priceCents - platformFeeCents(priceCents, cfg);
}

/** "$25" for whole dollars, "$25.50" otherwise. */
export function formatUsd(cents: number): string {
  const dollars = cents / 100;
  if (Number.isInteger(dollars)) return `$${dollars}`;
  return `$${dollars.toFixed(2)}`;
}

/** Parse a user-typed dollar amount into cents; null when unusable. */
export function parseUsd(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}
