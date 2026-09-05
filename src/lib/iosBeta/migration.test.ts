import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

test(
  "clean local migration preserves legacy outcomes and enforces concurrent service leases",
  { skip: process.env.BETA_LOCAL_DB_TEST !== "1" },
  async () => {
    // New database inside the one designated isolated container; never a project URL.
    const database = `beta_intake_migration_${process.pid}`;
    const args = (db: string) => [
      "exec",
      "-i",
      "ponglens-beta-intake-test-db",
      "psql",
      "-U",
      "postgres",
      "-d",
      db,
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ];
    function sql(query: string, db = database) {
      return execFileSync("docker", args(db), {
        input: query,
        encoding: "utf8",
      }).trim();
    }
    function concurrent(query: string): Promise<string> {
      return new Promise((resolve, reject) => {
        const child = execFile(
          "docker",
          args(database),
          (error, stdout, stderr) =>
            error ? reject(new Error(stderr)) : resolve(stdout),
        );
        child.stdin?.end(query);
      });
    }
    sql(`create database ${database}`, "postgres");
    try {
      sql(`create schema auth;
      create table auth.users(id uuid primary key,email text);
      create function auth.jwt() returns jsonb language sql as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function public.is_admin() returns boolean language sql as $$ select coalesce(auth.jwt()->>'email','') in ('adilharis2001@gmail.com','aber97@gmail.com') $$;
      grant usage on schema public to anon,authenticated,service_role;`);
      for (const migration of [
        "104_email_suppression.sql",
        "169_ios_beta_requests.sql",
      ])
        sql(
          readFileSync(
            new URL(
              `../../../supabase/migrations/${migration}`,
              import.meta.url,
            ),
            "utf8",
          ),
        );
      sql(`insert into ios_beta_requests(email,created_at,invite_sent_at,admin_notified_at) values ('legacy-sent@example.com','2026-09-04T12:00:00Z','2026-09-04T12:01:00Z','2026-09-04T12:01:00Z');
      insert into ios_beta_requests(email,created_at,invite_suppressed_at,admin_suppressed_at) values ('legacy-suppressed@example.com','2026-09-04T12:00:00Z','2026-09-04T12:01:00Z','2026-09-04T12:01:00Z');
      insert into ios_beta_requests(email,created_at) values ('legacy-unknown@example.com','2026-09-04T12:00:00Z');`);
      sql(
        readFileSync(
          new URL(
            "../../../supabase/migrations/20260905220000_beta_intake_delivery.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      assert.equal(
        sql(
          "select string_agg(delivery_state,',' order by email) from ios_beta_requests",
        ),
        "sent,suppressed,needs_attention",
      );
      assert.equal(
        sql(
          "select count(*) from ios_beta_deliveries where kind='admin_anton'",
        ),
        "0",
      );
      assert.equal(
        sql(
          "select bool_and(form_version is null and feedback_choice='unanswered' and answers_at is null and scheduled_at='2026-09-05T11:00:00Z') from ios_beta_requests",
        ),
        "t",
      );
      assert.equal(
        sql(
          "select to_char(invite_sent_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS') from ios_beta_requests where email='legacy-sent@example.com'",
        ),
        "2026-09-04 12:01:00",
      );
      sql(
        "set role service_role; select * from claim_ios_beta_request('concurrent@example.com',repeat('e',64)); reset role;",
      );
      sql(
        "insert into ios_beta_requests(email) values ('deployment-overlap@example.com'); update ios_beta_requests set invite_sent_at=now(), admin_notified_at=now() where email='deployment-overlap@example.com'",
      );
      assert.equal(
        sql(
          "select string_agg(state,',' order by kind) from ios_beta_deliveries where request_id=(select id from ios_beta_requests where email='deployment-overlap@example.com')",
        ),
        "sent,pending,sent",
      );
      const job = sql(
        "select id from ios_beta_deliveries where recipient='concurrent@example.com'",
      );
      const results = await Promise.all([
        concurrent(
          `begin; set role service_role; select 'acquired='||(lease_ios_beta_delivery('${job}','11111111-1111-4111-8111-111111111111') is not null); select pg_sleep(0.2); commit;`,
        ),
        concurrent(
          `begin; set role service_role; select 'acquired='||(lease_ios_beta_delivery('${job}','22222222-2222-4222-8222-222222222222') is not null); select pg_sleep(0.2); commit;`,
        ),
      ]);
      assert.equal(
        results.filter((x) => x.includes("acquired=true")).length,
        1,
      );
      assert.equal(
        results.filter((x) => x.includes("acquired=false")).length,
        1,
      );
      // Lease expiry changes worker ownership, never the immutable provider attempt.
      sql(
        `update ios_beta_deliveries set lease_until=now()-interval '1 second',create_payload='{"subject":"original"}',first_attempt_at=now()-interval '1 hour',state='unknown' where id='${job}';`,
      );
      sql(
        `select lease_ios_beta_delivery('${job}','33333333-3333-4333-8333-333333333333');`,
      );
      assert.equal(
        sql(
          `select finish_ios_beta_delivery('${job}','11111111-1111-4111-8111-111111111111','sent','wrong-provider',null)`,
        ),
        "f",
      );
      assert.equal(
        sql(`select create_payload from ios_beta_deliveries where id='${job}'`),
        '{"subject":"original"}',
      );
      assert.throws(
        () =>
          sql(
            `select prepare_ios_beta_delivery('${job}','33333333-3333-4333-8333-333333333333','{"subject":"changed"}')`,
          ),
        /beta payload changed/,
      );
      sql(
        `update ios_beta_deliveries set first_attempt_at=now()-interval '24 hours' where id='${job}'`,
      );
      assert.throws(
        () =>
          sql(
            `select prepare_ios_beta_delivery('${job}','33333333-3333-4333-8333-333333333333','{"subject":"original"}')`,
          ),
        /beta idempotency expired/,
      );
      for (const role of ["anon", "authenticated"]) {
        assert.throws(
          () => sql(`set role ${role}; select * from ios_beta_requests`),
          /permission denied/,
        );
        assert.throws(
          () =>
            sql(
              `set role ${role}; select lease_ios_beta_delivery('${job}','44444444-4444-4444-8444-444444444444')`,
            ),
          /permission denied/,
        );
      }
      const requestId = sql(
        "select id from ios_beta_requests where email='concurrent@example.com'",
      );
      assert.throws(
        () =>
          sql(
            `select request_ios_beta_early_send('${requestId}','55555555-5555-4555-8555-555555555555')`,
          ),
        /admin required/,
      );
      sql(
        "insert into auth.users(id,email) values('55555555-5555-4555-8555-555555555555','adilharis2001@gmail.com'),('66666666-6666-4666-8666-666666666666','aber97@gmail.com')",
      );
      sql(
        `select request_ios_beta_early_send('${requestId}','55555555-5555-4555-8555-555555555555'); select request_ios_beta_early_send('${requestId}','66666666-6666-4666-8666-666666666666');`,
      );
      assert.equal(
        sql(
          `select early_send_actor from ios_beta_requests where id='${requestId}'`,
        ),
        "55555555-5555-4555-8555-555555555555",
      );
    } finally {
      sql(`drop database ${database}`, "postgres");
    }
  },
);
