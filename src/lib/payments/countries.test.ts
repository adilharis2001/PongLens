import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PAYOUT_COUNTRIES,
  isPayoutCountry,
  payoutCountryName,
} from "./countries.ts";

const migration = (name: string) =>
  readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8");

/**
 * The list exists twice: here for the signup picker, and in SQL as
 * stripe_connect_supported() for the outreach pipeline's payments_supported
 * column. They must agree, or marketing chases a country the signup then
 * refuses, which is the worst of both.
 */
test("the picker and the SQL agree on which countries can be paid", () => {
  const sql = migration("105_outreach_country.sql");
  const body = sql.slice(
    sql.indexOf("function public.stripe_connect_supported"),
    sql.indexOf("function public.outreach_region"),
  );
  const inSql = new Set(
    [...body.matchAll(/'([A-Z]{2})'/g)].map((m) => m[1]),
  );
  const inTs = new Set(PAYOUT_COUNTRIES.map((c) => c.code));

  assert.deepEqual(
    [...inTs].filter((c) => !inSql.has(c)),
    [],
    "in the picker but not in SQL",
  );
  assert.deepEqual(
    [...inSql].filter((c) => !inTs.has(c)),
    [],
    "in SQL but not in the picker",
  );
});

test("India stays out on purpose, and so does anything unnamed", () => {
  // Stripe operates in India but restricts cross-border payouts to Indian
  // connected accounts, which is the whole reason this list is an allow-list.
  assert.equal(isPayoutCountry("IN"), false);
  assert.equal(isPayoutCountry("NG"), false);
  assert.equal(isPayoutCountry("ZZ"), false);
  assert.equal(isPayoutCountry(""), false);
  assert.equal(isPayoutCountry(null), false);
  assert.equal(isPayoutCountry(undefined), false);
});

test("the countries the outreach list is aimed at can actually be paid", () => {
  for (const code of ["US", "GB", "DE", "FR", "ES", "IT", "PL", "SE", "NL"]) {
    assert.equal(isPayoutCountry(code), true, code);
  }
  assert.equal(isPayoutCountry("us"), true, "case should not matter");
  assert.equal(payoutCountryName("de"), "Germany");
  assert.equal(payoutCountryName("IN"), null);
});

test("every entry is a distinct ISO code with a readable name", () => {
  const codes = PAYOUT_COUNTRIES.map((c) => c.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const country of PAYOUT_COUNTRIES) {
    assert.match(country.code, /^[A-Z]{2}$/);
    assert.ok(country.name.length > 2, country.code);
  }
});

test("the country is asked before the account and frozen after it", () => {
  const sql = migration("107_coach_payout_country.sql");
  // Existing accounts were created as US; that is a fact about Stripe's
  // records, so it is written down rather than left to be re-derived.
  assert.match(sql, /set payout_country = 'US'\s+where stripe_account_id is not null/);
  assert.match(sql, /payout country cannot change once a Stripe account exists/);
  assert.match(sql, /create trigger coach_profiles_freeze_payout_country/);
  // UPDATE on this table is column-scoped for `authenticated`. Without its
  // own grant the picker 403s and the row never changes, which looked
  // exactly like a successful save.
  assert.match(sql, /grant update \(payout_country\) on public\.coach_profiles to authenticated/);

  const route = readFileSync(
    new URL("../../app/api/reviews/connect/route.ts", import.meta.url),
    "utf8",
  );
  // No default: a wrong country cannot be corrected later, only abandoned.
  assert.match(route, /if \(!isPayoutCountry\(profile\.payout_country\)\)/);
  assert.match(route, /code: "country_required"/);
  assert.doesNotMatch(route, /createConnectAccount\([^)]*"US"/);
});

test("payouts leave in the currency the charge settled in", () => {
  const gateway = readFileSync(
    new URL("./stripeGateway.ts", import.meta.url),
    "utf8",
  );
  // A German coach's balance transaction is in EUR. Paying its `net` out as
  // USD would be rejected, or pay the wrong sum.
  assert.doesNotMatch(gateway, /currency: "usd", expand/);
  assert.match(gateway, /amount: net, currency, expand/);
  assert.match(gateway, /typeof txn\.currency === "string"/);
  assert.doesNotMatch(gateway, /country: "US"/);
});
