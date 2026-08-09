import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/050_platform_costs.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();
const patchSql = readFileSync(
  new URL(
    "../../../supabase/migrations/052_platform_cost_rate_patch.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();
const rpcPatchSql = readFileSync(
  new URL(
    "../../../supabase/migrations/053_platform_cost_dashboard_alias.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();
const stripeSql = readFileSync(
  new URL(
    "../../../supabase/migrations/085_stripe_and_ask_costs.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();

/**
 * Every migration, concatenated. The model-rate check below asks "does a
 * price for this exist anywhere", and a rate added in some future
 * migration should satisfy it without anyone editing this file.
 */
const migrationsDir = fileURLToPath(
  new URL("../../../supabase/migrations/", import.meta.url),
);
const allMigrationSql = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => readFileSync(join(migrationsDir, name), "utf8"))
  .join("\n")
  .toLowerCase();

const srcDir = fileURLToPath(new URL("../../", import.meta.url));

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The models the app actually calls, read from source. Matches the house
 * naming for these constants (MODEL, ASK_MODEL, DISTILL_MODEL, ...) — if
 * a call site ever stops declaring one, the emptiness assertion in the
 * test fires rather than the check silently passing over nothing.
 */
function modelConstantsInSource(): Set<string> {
  const models = new Set<string>();
  const files = readdirSync(srcDir, { recursive: true, encoding: "utf8" });
  for (const relative of files) {
    if (!relative.endsWith(".ts") && !relative.endsWith(".tsx")) continue;
    if (relative.endsWith(".test.ts") || relative.endsWith(".test.tsx")) {
      continue;
    }
    const source = readFileSync(join(srcDir, relative), "utf8");
    for (const match of source.matchAll(
      /\b[A-Z_]*MODEL[A-Z_]*\s*=\s*"([^"]+)"/g,
    )) {
      models.add(match[1].toLowerCase());
    }
  }
  return models;
}
let alertSql = "";
try {
  alertSql = readFileSync(
    new URL(
      "../../../supabase/migrations/055_platform_cost_alerts.sql",
      import.meta.url,
    ),
    "utf8",
  ).toLowerCase();
} catch {
  // Kept empty so the contract assertions fail clearly before migration 055
  // exists, rather than aborting the whole test module during TDD.
}

test("cost tables are private and usage is idempotent", () => {
  for (const table of [
    "cost_usage_events",
    "cost_rates",
    "cost_fixed_items",
    "cost_provider_snapshots",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `alter table public\\.${table} enable row level security`,
      ),
    );
    assert.match(
      sql,
      new RegExp(
        `revoke all on public\\.${table} from anon, authenticated`,
      ),
    );
  }
  assert.match(sql, /idempotency_key text not null unique/);
  assert.match(sql, /quantity numeric not null check \(quantity >= 0\)/);
});

test("dashboard RPC rechecks owner and applies effective-dated rates", () => {
  assert.match(
    sql,
    /create or replace function public\.get_platform_cost_dashboard/,
  );
  assert.match(sql, /if not public\.is_admin\(\)/);
  assert.match(sql, /r\.effective_from <= e\.occurred_at/);
  assert.match(
    sql,
    /r\.effective_to is null or e\.occurred_at < r\.effective_to/,
  );
});

test("seed rates cover every production vendor SKU", () => {
  for (const sku of [
    "gpt-5-nano",
    "gpt-5-mini",
    "gpt-5.6-sol",
    "nova-3",
    "r2-standard",
  ]) {
    assert.match(sql, new RegExp(`'${sku}'`));
  }
});

test("every model the app calls has a rate, so nothing bills as unmapped", () => {
  // Shipping a model constant without its rate row is SILENT: the usage
  // meters fine, finds no price, and lands in the dashboard's unmapped
  // bucket reading $0 — indistinguishable from free. Two features shipped
  // against gpt-5.6-luna and did exactly that.
  //
  // So this does not hold a list to keep in step by hand. It reads the
  // model constants out of the app and the rate rows out of every
  // migration, and fails on the next one that arrives without a price.
  const models = modelConstantsInSource();
  assert.ok(
    models.size > 0,
    "found no model constants — the scan regex has drifted from the code",
  );

  for (const model of [...models].sort()) {
    for (const unit of ["input_token", "cached_input_token", "output_token"]) {
      assert.match(
        allMigrationSql,
        new RegExp(`'${escapeForRegExp(model)}',\\s*'${unit}'`),
        `${model} is called in the app but has no ${unit} rate in any ` +
          `migration — its spend will read as $0`,
      );
    }
  }
});

test("vendor-reported money has a unit and an identity rate", () => {
  // Both places that enumerate the unit vocabulary have to agree, or the
  // table accepts a row the RPC refuses (or worse, the other way round).
  const unitLists = stripeSql.match(/'usd_cent'/g) ?? [];
  assert.ok(
    unitLists.length >= 3,
    "usd_cent must be in the table check, the RPC check, and the rate seed",
  );
  assert.match(stripeSql, /add constraint cost_usage_events_unit_check/);
  assert.match(
    stripeSql,
    /create or replace function public\.record_cost_usage/,
  );
  // $0.01 per cent: the rate is a unit conversion, never a percentage we
  // would have to keep in step with Stripe's card rates.
  assert.match(stripeSql, /'stripe', 'payments', 'stripe-fee', 'usd_cent',\s*\n?\s*0\.01/);
});

test("the cost RPCs are unreachable from a browser session", () => {
  const guardSql = readFileSync(
    new URL(
      "../../../supabase/migrations/086_cost_rpc_guard.sql",
      import.meta.url,
    ),
    "utf8",
  ).toLowerCase();

  // Layer 1: reachability. `revoke ... from public` revokes the PUBLIC
  // pseudo-role, which is NOT the anon/authenticated roles Supabase grants
  // EXECUTE to by default — 050 did only the former, so both roles kept it.
  for (const fn of [
    "record_cost_usage",
    "claim_platform_cost_alert",
    "complete_platform_cost_alert",
  ]) {
    assert.match(
      guardSql,
      new RegExp(`revoke all on function public\\.${fn}[^;]*from anon, authenticated`),
      `${fn} must have EXECUTE revoked from anon and authenticated by name`,
    );
  }
  assert.match(guardSql, /grant execute on function public\.record_cost_usage\(jsonb\) to service_role/);

  // Layer 2: the guard body. current_user is ALWAYS the owner inside a
  // SECURITY DEFINER function, so keying off it can never refuse anyone.
  assert.match(guardSql, /auth\.role\(\) is not null and auth\.role\(\) <> 'service_role'/);
  // Comments stripped first: this migration quotes the broken guard while
  // explaining it, and the header explaining a bug must not read as the bug.
  const executable = guardSql.replace(/^\s*--.*$/gm, "");
  assert.doesNotMatch(
    executable,
    /current_user not in \('postgres', 'service_role'\)/,
    "the replacement guard must not reuse the current_user check that cannot fire",
  );
});

test("deployed cost schema has a forward-only rate patch", () => {
  assert.match(patchSql, /update public\.cost_rates/);
  assert.match(patchSql, /'gpt-5\.6-sol'/);
  assert.match(patchSql, /'storage_byte_snapshot'/);
  assert.match(patchSql, /on conflict \(provider, service, sku, unit, effective_from\)/);
});

test("usage ingestion accepts only trusted server callers", () => {
  assert.match(
    sql,
    /coalesce\(auth\.role\(\), ''\) <> 'service_role'/,
  );
  assert.match(sql, /current_user not in \('postgres', 'service_role'\)/);
  assert.match(sql, /on conflict \(idempotency_key\) do nothing/);
});

test("fixed costs can only be changed through an owner-checked RPC", () => {
  assert.match(
    sql,
    /create or replace function public\.admin_upsert_cost_fixed_item/,
  );
  assert.match(sql, /if not public\.is_admin\(\)/);
  assert.doesNotMatch(
    sql,
    /create policy[\s\S]*cost_fixed_items[\s\S]*for (insert|update)/,
  );
});

test("unmapped dimensions are grouped before the JSON aggregate", () => {
  assert.match(sql, /unmapped_rollup as \(/);
  assert.match(sql, /from unmapped_rollup u/);
});

test("daily rollup sums the provider-cost alias exposed by its subquery", () => {
  assert.doesNotMatch(sql, /sum\(c\.cost_usd\)/);
  assert.match(sql, /sum\(c\.provider_cost\)/);
  assert.match(rpcPatchSql, /replace\(/);
  assert.match(rpcPatchSql, /sum\(c\.provider_cost\)/);
});

test("simulation baseline counts PongLens' non-deleted points", () => {
  assert.doesNotMatch(sql, /p\.deleted_at is null/);
  assert.match(sql, /not p\.deleted/);
});

test("cost alert ledger is private and monthly thresholds are idempotent", () => {
  assert.match(
    alertSql,
    /create table public\.platform_cost_alert_deliveries/,
  );
  assert.match(alertSql, /unique \(period_start, threshold_usd\)/);
  assert.match(
    alertSql,
    /alter table public\.platform_cost_alert_deliveries enable row level security/,
  );
  assert.match(
    alertSql,
    /revoke all on public\.platform_cost_alert_deliveries from anon, authenticated/,
  );
});

test("cost alert claims are aggregate trusted-server operations", () => {
  assert.match(
    alertSql,
    /create or replace function public\.claim_platform_cost_alert/,
  );
  assert.match(alertSql, /provider_costs/);
  assert.match(alertSql, /for update skip locked/);
  assert.match(
    alertSql,
    /create or replace function public\.complete_platform_cost_alert/,
  );
  assert.match(alertSql, /service role required/);
  assert.doesNotMatch(alertSql, /grant execute[\s\S]*to authenticated/);
});
