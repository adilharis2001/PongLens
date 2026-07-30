import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
