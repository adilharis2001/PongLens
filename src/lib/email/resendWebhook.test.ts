import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { handleResendWebhook } from "./resendWebhook.ts";
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
