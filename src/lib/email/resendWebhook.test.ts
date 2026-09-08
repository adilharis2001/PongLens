import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { handleResendWebhook } from "./resendWebhook.ts";
import { reconcileIosBetaCancellations } from "./iosBetaEmails.ts";
import type { BetaEmailDependencies } from "../iosBeta/storage.ts";
import type { BetaJob } from "../iosBeta/scheduledDelivery.ts";
const secret =
  "whsec_" + Buffer.from("local-webhook-test-secret").toString("base64");
function signed(body: string, signature = true) {
  const stamp = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", Buffer.from("local-webhook-test-secret"))
    .update(`evt_test.${stamp}.${body}`)
    .digest("base64");
  return new Request("https://www.ponglens.com/api/webhooks/resend", {
    method: "POST",
    body,
    headers: {
      "svix-id": "evt_test",
      "svix-timestamp": stamp,
      "svix-signature": signature ? `v1,${sig}` : "v1,bad",
    },
  });
}
test("only a signed raw body reaches transactional beta/suppression ingestion", async () => {
  let applied = 0;
  const deps = {
    secret,
    async apply(id: string, event: unknown) {
      assert.equal(id, "evt_test");
      assert.deepEqual(event, {
        type: "email.sent",
        data: { email_id: "provider-1" },
      });
      applied++;
      return { data: [], error: null };
    },
    async reconcile() {},
  };
  const raw = '{ "type": "email.sent", "data": {"email_id":"provider-1"} }';
  assert.equal(
    (await handleResendWebhook(signed(raw, false), deps)).status,
    400,
  );
  assert.equal(applied, 0);
  assert.equal((await handleResendWebhook(signed(raw), deps)).status, 200);
  assert.equal(applied, 1);
});
test("Supabase errors returned as values produce retryable failure, not a poisoned seen-set", async () => {
  const response = await handleResendWebhook(
    signed('{"type":"email.delivered"}'),
    {
      secret,
      async apply() {
        return { data: null, error: { message: "failed SQL write" } };
      },
      async reconcile() {},
    },
  );
  assert.equal(response.status, 500);
});
test("post-suppression cancellation failure requests webhook retry", async () => {
  const response = await handleResendWebhook(
    signed('{"type":"email.complained"}'),
    {
      secret,
      async apply() {
        return { data: ["request-1"], error: null };
      },
      async reconcile() {
        throw new Error("cancel busy");
      },
    },
  );
  assert.equal(response.status, 500);
});

test("signed suppression and replay finish for confirmed failures but retry ambiguous failures", async () => {
  for (const kind of ["invite", "admin_adil"] as const) {
    for (const providerId of ["failed-provider-id", null]) {
      const job: BetaJob = {
        id: "failed-job",
        request_id: "request-1",
        kind,
        recipient: "failed@example.com",
        state: "failed",
        provider_email_id: providerId,
        idempotency_key: "failed-key",
        create_payload: "{}",
        first_attempt_at: new Date(Date.now() - 60_000).toISOString(),
        error_code: "provider_failed",
        early_target_at: null,
        early_applied_at: null,
        cancel_requested: true,
      };
      let networkCalls = 0;
      const unexpectedNetwork = async () => {
        networkCalls++;
        throw new Error("must not create or cancel");
      };
      const dependencies: BetaEmailDependencies = {
        async jobs() {
          return [job];
        },
        async pending() {
          return [job.request_id];
        },
        async requestEarly() {
          return false;
        },
        delivery: {
          now: Date.now,
          async lease() {
            return { ...job };
          },
          async read() {
            return { ...job };
          },
          async prepare() {
            throw new Error("must not prepare");
          },
          async payload() {
            throw new Error("must not render");
          },
          async finish(_job, _token, result) {
            Object.assign(job, { state: result.state });
            return true;
          },
          async isSuppressed() {
            return true;
          },
          provider: {
            create: unexpectedNetwork,
            retrieve: unexpectedNetwork,
            update: unexpectedNetwork,
            cancel: unexpectedNetwork,
          },
        },
      };
      const webhookDependencies = {
        secret,
        async apply() {
          return { data: [job.request_id], error: null };
        },
        async reconcile(id: string) {
          if (!(await reconcileIosBetaCancellations(id, dependencies)))
            throw new Error("cancellation unresolved");
        },
      };
      for (let replay = 0; replay < 2; replay++) {
        const response = await handleResendWebhook(
          signed('{"type":"email.complained"}'),
          webhookDependencies,
        );
        assert.equal(
          response.status,
          providerId ? 200 : 500,
          `${kind}, confirmed=${!!providerId}, replay=${replay}`,
        );
      }
      assert.equal(job.state, providerId ? "failed" : "needs_attention");
      assert.equal(networkCalls, 0);
    }
  }
});
