/**
 * Where a coach can be paid.
 *
 * Stripe fixes a Connect account's country when the account is created and
 * it can never be changed. Get it wrong and the coach's only route back is
 * a new account, so this is asked once, before anything is created, and
 * frozen the moment an account exists.
 *
 * The same list lives in SQL as stripe_connect_supported() (105), which is
 * what decides `payments_supported` on the outreach pipeline. The test
 * beside this file reads the migration and asserts the two agree, because a
 * marketing list that promises a country the signup then refuses is the
 * worst of both.
 *
 * Conservative by design: anything absent is unsupported. India is left out
 * on purpose despite Stripe operating there, since cross-border payouts to
 * Indian connected accounts are restricted.
 */

export interface PayoutCountry {
  readonly code: string;
  readonly name: string;
}

export const PAYOUT_COUNTRIES: readonly PayoutCountry[] = [
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "GB", name: "United Kingdom" },
  { code: "IE", name: "Ireland" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "PT", name: "Portugal" },
  { code: "NL", name: "Netherlands" },
  { code: "BE", name: "Belgium" },
  { code: "LU", name: "Luxembourg" },
  { code: "AT", name: "Austria" },
  { code: "CH", name: "Switzerland" },
  { code: "LI", name: "Liechtenstein" },
  { code: "DK", name: "Denmark" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "FI", name: "Finland" },
  { code: "PL", name: "Poland" },
  { code: "CZ", name: "Czechia" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "HR", name: "Croatia" },
  { code: "HU", name: "Hungary" },
  { code: "RO", name: "Romania" },
  { code: "BG", name: "Bulgaria" },
  { code: "GR", name: "Greece" },
  { code: "CY", name: "Cyprus" },
  { code: "MT", name: "Malta" },
  { code: "EE", name: "Estonia" },
  { code: "LV", name: "Latvia" },
  { code: "LT", name: "Lithuania" },
  { code: "AU", name: "Australia" },
  { code: "NZ", name: "New Zealand" },
  { code: "JP", name: "Japan" },
  { code: "SG", name: "Singapore" },
  { code: "HK", name: "Hong Kong" },
  { code: "MY", name: "Malaysia" },
  { code: "TH", name: "Thailand" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "MX", name: "Mexico" },
  { code: "BR", name: "Brazil" },
];

export function isPayoutCountry(code: string | null | undefined): boolean {
  if (!code) return false;
  const upper = code.toUpperCase();
  return PAYOUT_COUNTRIES.some((c) => c.code === upper);
}

export function payoutCountryName(code: string | null | undefined): string | null {
  if (!code) return null;
  const upper = code.toUpperCase();
  return PAYOUT_COUNTRIES.find((c) => c.code === upper)?.name ?? null;
}
