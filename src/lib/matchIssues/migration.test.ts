import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260907210000_match_processing_feedback.sql",
);

const sql = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

test("the private match issue lifecycle is installed", () => {
  for (const table of [
    "match_processing_feedback",
    "match_processing_feedback_events",
    "match_issue_email_deliveries",
  ]) {
    assert.match(sql, new RegExp(`create table public\\.${table}`), table);
  }

  for (const fn of [
    "match_issue_state",
    "submit_match_issue",
    "cancel_match_issue",
    "admin_match_issue_list",
    "admin_match_issue_detail",
    "admin_refund_match_issue",
    "finish_match_issue_email_delivery",
    "cancel_queued_processing",
  ]) {
    assert.match(
      sql,
      new RegExp(`create or replace function public\\.${fn}\\(`),
      fn,
    );
  }
});

test("queued cancellation and worker failure share the spend reversal identity", () => {
  const cancel = sql.slice(sql.indexOf("create or replace function public.cancel_queued_processing("));
  assert.match(cancel, /purchase_id, note, reverses_id/);
  assert.match(cancel, /'cancelled before processing', spend\.id/);
  assert.match(cancel, /on conflict \(reverses_id\) where kind = 'refund' do nothing/);
});

test("clients cannot choose protected ownership or refund facts", () => {
  const submitSignature = sql.match(
    /create or replace function public\.submit_match_issue\(([^)]*)\)/i,
  )?.[1] ?? "";

  assert.doesNotMatch(submitSignature, /owner|job|minute|amount|funding/i);
  assert.match(sql, /where m\.id = p_match_id\s+and m\.user_id = v_me/i);
  assert.match(sql, /from public\.processing_ledger[\s\S]*kind = 'spend'/i);
  assert.match(sql, /funding = 'personal'/i);
});

test("one active remedy and one exact reversal survive concurrent admins", () => {
  assert.match(
    sql,
    /create unique index match_processing_feedback_active_remedy_idx[\s\S]*where kind in \('reprocess', 'refund'\)[\s\S]*status in/i,
  );
  assert.match(sql, /add column reverses_id bigint/i);
  assert.match(
    sql,
    /references public\.processing_ledger \(id\)[\s\S]*on delete restrict/i,
  );
  assert.match(
    sql,
    /create unique index processing_ledger_one_reversal_idx[\s\S]*where kind = 'refund'/i,
  );
  assert.match(sql, /from public\.match_processing_feedback[\s\S]*for update/i);
  assert.match(sql, /from public\.processing_ledger[\s\S]*for update/i);
});

test("request permissions separate owner remedies from coach reports", () => {
  assert.match(sql, /kind in \('positive', 'problem', 'reprocess', 'refund'\)/i);
  assert.match(sql, /public\.has_match_access\(p_match_id\)/i);
  assert.match(
    sql,
    /p_kind in \('positive', 'reprocess', 'refund'\) and not v_is_owner/i,
  );
  assert.match(sql, /v_match\.status <> 'ready'/i);
  assert.match(sql, /raise exception 'not authorized'.*errcode = '42501'/i);
});

test("refund resolution is append-only and preserves match content", () => {
  const refund = sql.slice(sql.indexOf("admin_refund_match_issue"));
  assert.match(refund, /insert into public\.processing_ledger/i);
  assert.match(refund, /-v_spend\.minutes/i);
  assert.match(refund, /v_spend\.billing_mode/i);
  assert.match(refund, /v_spend\.funding/i);
  assert.doesNotMatch(refund, /delete\s+from\s+public\.(matches|points|notes|point_tags|share_links)/i);
});

test("submission creates durable admin notification and email work", () => {
  assert.match(sql, /insert into public\.notifications/i);
  assert.match(sql, /insert into public\.match_issue_email_deliveries/i);
  assert.match(sql, /'match_issue_reported'/i);
  for (const kind of [
    "match_issue_reported",
    "match_issue_updated",
    "match_reprocess_ready",
    "match_reprocess_failed",
  ]) {
    assert.match(sql, new RegExp(`''${kind}''`), kind);
  }
});

test("only the service role can finish retryable email deliveries", () => {
  const finish = sql.slice(sql.indexOf("finish_match_issue_email_delivery"));
  assert.match(finish, /auth\.role\(\)[\s\S]*service_role/i);
  assert.match(finish, /attempt_count = attempt_count \+ 1/i);
  assert.match(
    finish,
    /p_state[\s\S]*not in \('accepted', 'suppressed', 'failed'\)/i,
  );
  assert.match(
    finish,
    /grant execute on function public\.finish_match_issue_email_delivery\(uuid, text, text\) to service_role/i,
  );
});

test("tables are private and RPC grants are explicit", () => {
  for (const table of [
    "match_processing_feedback",
    "match_processing_feedback_events",
    "match_issue_email_deliveries",
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(sql, /revoke all on public\.match_issue_email_deliveries from anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.submit_match_issue\(uuid, text, text, uuid\) to authenticated/i);
  assert.match(sql, /grant execute on function public\.admin_refund_match_issue\(uuid, text, text\) to authenticated/i);
});
