import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationUrl = new URL(
  "../../../supabase/migrations/20260915190000_canonical_scored_match_state.sql",
  import.meta.url
);
const commandsMigrationUrl = new URL(
  "../../../supabase/migrations/20260916120000_canonical_score_commands.sql",
  import.meta.url
);
const setupUrl = new URL(
  "../../../scripts/scoring/setup-local-db.mjs",
  import.meta.url
);

function migrationSql(): string {
  assert.equal(
    existsSync(migrationUrl),
    true,
    "canonical scored-match migration must exist"
  );
  return readFileSync(migrationUrl, "utf8");
}

function commandsMigrationSql(): string {
  assert.equal(
    existsSync(commandsMigrationUrl),
    true,
    "canonical score commands migration must exist"
  );
  return readFileSync(commandsMigrationUrl, "utf8");
}

test("projection, observation, and ledger tables are private and RLS protected", () => {
  const sql = migrationSql();
  for (const table of [
    "point_score_state",
    "match_score_state",
    "point_timing_observations",
    "match_score_mutations",
  ]) {
    assert.match(
      sql,
      new RegExp(`alter table public\\.${table} enable row level security`, "i")
    );
    assert.match(
      sql,
      new RegExp(
        `revoke all on (?:table )?public\\.${table} from public, anon, authenticated`,
        "i"
      )
    );
  }
});

test("projection rows are readable only through existing match access", () => {
  const sql = migrationSql();
  assert.match(
    sql,
    /create policy point_score_state_match_access[\s\S]*?for select[\s\S]*?to authenticated[\s\S]*?has_match_access\(match_id\)/i
  );
  assert.match(
    sql,
    /create policy match_score_state_match_access[\s\S]*?for select[\s\S]*?to authenticated[\s\S]*?has_match_access\(match_id\)/i
  );
  assert.match(
    sql,
    /grant select on (?:table )?public\.point_score_state, public\.match_score_state to authenticated/i
  );
});

test("client roles cannot execute internal projection or observation functions", () => {
  const sql = migrationSql();
  for (const signature of [
    "refresh_match_score_state(uuid)",
    "normalize_manual_cut_observations(uuid)",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `revoke all on function public\\.${signature.replace(/[()]/g, "\\$&")}\\s+from public, anon, authenticated`,
        "i"
      )
    );
  }
});

test("schema records revision, authority, provenance, and idempotency", () => {
  const sql = migrationSql();
  assert.match(sql, /add column if not exists score_revision bigint not null default 0/i);
  assert.match(sql, /add column if not exists timing_revision bigint not null default 0/i);
  assert.match(sql, /end_authority text not null default 'automatic'/i);
  assert.match(sql, /origin text not null[\s\S]*manual_cutter/i);
  assert.match(sql, /authority_scope text not null[\s\S]*owner_manual_boundary/i);
  assert.match(sql, /request_id uuid unique/i);
  assert.match(sql, /unique \(point_id, kind, origin, timing_revision\)/i);
});

test("only canonical owner inputs trigger shadow score refresh", () => {
  const sql = migrationSql();
  assert.match(
    sql,
    /after update of[\s\S]*?confirmed_winner[\s\S]*?confirmed_how[\s\S]*?is_let[\s\S]*?server_override[\s\S]*?game_end_override[\s\S]*?game_winner_override[\s\S]*?t0[\s\S]*?t1[\s\S]*?deleted[\s\S]*?on public\.points/i
  );
  assert.doesNotMatch(
    sql,
    /after update of[^;]*?(?:starred|suggestion|placement|clip_path)[^;]*?on public\.points/i
  );
  assert.match(
    sql,
    /after update of first_server, first_server_source, active_processing_version_id[\s\S]*?on public\.matches/i
  );
});

test("admin research labels cannot refresh owner score", () => {
  const sql = migrationSql();
  assert.doesNotMatch(
    sql,
    /(?:trigger|update)[\s\S]{0,160}fullmatch_labels[\s\S]{0,160}refresh_match_score_state/i
  );
  assert.doesNotMatch(
    sql,
    /refresh_match_score_state[\s\S]{0,160}fullmatch_labels/i
  );
});

test("shadow failures preserve legacy writes and record sanitized health", () => {
  const sql = migrationSql();
  assert.match(sql, /exception when others then/i);
  assert.match(sql, /score_projection_status\s*=\s*'error'/i);
  assert.match(sql, /left\(sqlerrm,\s*500\)/i);
  assert.doesNotMatch(sql, /raise;[\s\S]{0,120}score_projection_status\s*=\s*'error'/i);
});

test("manual-cutter source boundaries normalize idempotently without repurposing legacy taps", () => {
  const sql = migrationSql();
  const normalizer = sql.match(
    /create or replace function public\.normalize_manual_cut_observations\(p_match_id uuid\)[\s\S]*?\n\$\$;/i
  )?.[0];
  assert.ok(normalizer, "manual-cutter normalizer must be defined");
  assert.match(normalizer, /hand_cut_drafts/i);
  assert.match(normalizer, /cut_source\s*<>\s*'manual'/i);
  assert.match(normalizer, /manual cut mark\/point count mismatch/i);
  assert.match(normalizer, /manual cut mark\/point timing mismatch/i);
  assert.match(normalizer, /'serve_start'[\s\S]*?mark->>'t0'/i);
  assert.match(normalizer, /'point_end'[\s\S]*?mark->>'t1'/i);
  assert.match(normalizer, /'manual_cutter'/i);
  assert.match(normalizer, /'owner_manual_boundary'/i);
  assert.match(normalizer, /'raw_start_tap_s'/i);
  assert.match(normalizer, /'playback_rate'/i);
  assert.match(normalizer, /on conflict \(point_id, kind, origin, timing_revision\) do update/i);
  assert.doesNotMatch(normalizer, /(?:update|insert into)[\s\S]{0,80}(?:scored_at_cut_s|serve_start_at_cut_s|rally_end_cut_s)/i);
});

test("existing manual matches are offered to the normalizer without blocking migration", () => {
  const sql = migrationSql();
  assert.match(
    sql,
    /cut_source\s*=\s*'manual'[\s\S]{0,500}normalize_manual_cut_observations/i
  );
  assert.match(
    sql,
    /normalize_manual_cut_observations[\s\S]{0,300}exception when others/i
  );
});

test("database setup waits for the requested database, not only the server socket", () => {
  const setup = readFileSync(setupUrl, "utf8");
  assert.match(
    setup,
    /"exec", CONTAINER, "psql", "-At", "-U", "postgres", "-d", DATABASE,\s*"-c", "select 1"/
  );
  assert.doesNotMatch(setup, /pg_isready/);
});

test("canonical score commands start disabled and use the approved account rollout grammar", () => {
  const sql = commandsMigrationSql();
  assert.match(
    sql,
    /insert into public\.app_config\s*\(\s*key\s*,\s*value\s*\)[\s\S]*?'canonical_score_commands'\s*,\s*'off'/i
  );
  assert.match(
    sql,
    /create or replace function public\.canonical_score_commands_enabled\(\)[\s\S]*?public\.is_admin\(\)[\s\S]*?c\.value\s*=\s*'on'[\s\S]*?'user:'[\s\S]*?'users:%'/i
  );
});

test("canonical command helpers are private and the capability is authenticated only", () => {
  const sql = commandsMigrationSql();
  for (const signature of [
    "_canonical_score_snapshot(uuid)",
    "_canonical_score_command_context(uuid,uuid,bigint,text)",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `revoke all on function public\\.${signature.replace(/[()]/g, "\\$&")}\\s+from public, anon, authenticated`,
        "i"
      )
    );
  }
  assert.match(
    sql,
    /revoke all on function public\.canonical_score_commands_enabled\(\)\s+from public, anon, authenticated/i
  );
  assert.match(
    sql,
    /grant execute on function public\.canonical_score_commands_enabled\(\)\s+to authenticated/i
  );
});

test("command context locks the match and distinguishes duplicate, conflict, and new work", () => {
  const sql = commandsMigrationSql();
  const context = sql.match(
    /create or replace function public\._canonical_score_command_context\([\s\S]*?\n\$\$;/i
  )?.[0];
  assert.ok(context, "command context must be defined");
  assert.match(context, /from public\.matches[\s\S]*?for update/i);
  assert.match(context, /from public\.match_score_mutations[\s\S]*?request_id\s*=\s*p_request_id/i);
  assert.match(context, /'duplicate'/i);
  assert.match(context, /'score_conflict'/i);
  assert.match(context, /'new'/i);
});

test("typed score commands share one atomic finalizer and narrow client grants", () => {
  const commandMigration = commandsMigrationSql();
  for (const name of [
    "set_point_outcome_v2",
    "set_first_server_v2",
    "set_server_override_v2",
    "set_game_boundary_v2",
  ]) {
    assert.match(commandMigration, new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b`, "i"));
    assert.match(commandMigration, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}[^;]+to\\s+authenticated`, "is"));
    assert.match(commandMigration, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}[^;]+from\\s+public\\s*,\\s*anon`, "is"));
  }
  assert.match(commandMigration, /create\s+or\s+replace\s+function\s+public\._canonical_score_finish_command\b/i);
  assert.match(commandMigration, /insert\s+into\s+public\.match_score_mutations/i);
});

test("typed structural commands are present and authenticated-only", () => {
  const commandMigration = commandsMigrationSql();
  for (const name of [
    "set_point_visibility_v2",
    "split_point_v2",
    "unsplit_point_v2",
    "merge_points_v2",
    "adjust_point_v2",
    "insert_point_v2",
    "reset_match_score_v2",
  ]) {
    assert.match(commandMigration, new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b`, "i"));
    assert.match(commandMigration, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}[^;]+to\\s+authenticated`, "is"));
    assert.match(commandMigration, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}[^;]+from\\s+public\\s*,\\s*anon`, "is"));
  }
});
