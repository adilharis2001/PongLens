import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

let sql = "";
try {
  sql = readFileSync(
    new URL(
      "../../../supabase/migrations/056_journal_hardening.sql",
      import.meta.url,
    ),
    "utf8",
  ).toLowerCase();
} catch {
  // Empty during the TDD red phase so contract failures stay explicit.
}

test("journal image accounting is owner-scoped and idempotent", () => {
  assert.match(sql, /'entry_image'/);
  assert.match(
    sql,
    /create or replace function public\.ledger_append_entry_image/,
  );
  assert.match(
    sql,
    /create or replace function public\.ledger_negate_entry_image/,
  );
  assert.match(
    sql,
    /r2:\/\/ponglens-media\/entry\/['"]?\s*\|\|\s*auth\.uid\(\)\s*\|\|\s*'\/%'/,
  );
  assert.match(sql, /public\._ledger_negate_keys\(array\[p_key\]\)/);
  assert.match(
    sql,
    /revoke execute on function public\.ledger_append_entry_image/,
  );
  assert.match(
    sql,
    /grant execute on function public\.ledger_negate_entry_image[\s\S]*to authenticated/,
  );
  assert.match(
    sql,
    /exists\s*\(\s*select 1\s+from public\.lessons[\s\S]*image_path = p_key[\s\S]*user_id = auth\.uid\(\)/,
  );
});

test("journal hardening indexes recent notes", () => {
  assert.match(
    sql,
    /create index if not exists notes_created_at_idx\s+on public\.notes \(created_at desc\)/,
  );
});
