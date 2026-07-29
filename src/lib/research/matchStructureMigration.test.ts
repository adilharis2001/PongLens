import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  "supabase/migrations/051_match_structure_evidence.sql",
  "utf8"
);

test("existing first servers become user authoritative", () => {
  assert.match(
    sql,
    /update public\.matches[\s\S]*first_server_source = 'user'[\s\S]*first_server is not null/i
  );
});

test("match structure and source values are constrained", () => {
  assert.match(sql, /add column if not exists match_structure jsonb/i);
  assert.match(
    sql,
    /first_server_source in \('user', 'detected'\)/i
  );
});
