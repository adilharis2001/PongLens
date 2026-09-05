import assert from "node:assert/strict";
import test from "node:test";
import { betaInvitationEmail } from "./catalog.ts";
import {
  betaProviderPayload,
  createBetaProvider,
} from "../iosBeta/provider.ts";

test("beta payload uses shared rendered HTML/text and keeps provider schedule and correlation private", () => {
  const payload = JSON.parse(
    betaProviderPayload({
      to: "p@example.com",
      message: betaInvitationEmail("https://testflight.apple.com/join/Ab12"),
      deliveryId: "job",
      scheduledAt: "2026-09-06T11:00:00.000Z",
    }),
  );
  assert.equal(payload.scheduled_at, "2026-09-06T11:00:00.000Z");
  assert.equal(payload.reply_to, "support@ponglens.com");
  assert.deepEqual(payload.to, ["p@example.com"]);
  assert.match(payload.html, /TestFlight/);
  assert.match(payload.text, /TestFlight/);
  assert.deepEqual(payload.tags, [{ name: "beta_delivery_id", value: "job" }]);
});
test("create needs a valid provider ID, preserves exact payload/key, and meters accepted scheduling", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const meters: string[] = [];
  const provider = createBetaProvider({
    apiKey: "test-key",
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({ id: "provider-1" });
    },
    async record(id) {
      meters.push(id);
    },
  });
  const payload = '{"scheduled_at":"2026-09-06T11:00:00.000Z"}';
  assert.deepEqual(await provider.create(payload, "stable-key"), {
    state: "scheduled",
    id: "provider-1",
  });
  assert.equal(calls[0].init?.body, payload);
  assert.equal(
    new Headers(calls[0].init?.headers).get("Idempotency-Key"),
    "stable-key",
  );
  assert.deepEqual(meters, ["provider-1"]);
});
test("unconfirmed acceptance stays unknown, explicit rejection is failed, missing configuration makes no network call", async () => {
  for (const [response, state] of [
    [Response.json({}), "unknown"],
    [Response.json({}, { status: 500 }), "unknown"],
    [Response.json({}, { status: 422 }), "failed"],
  ] as const) {
    const p = createBetaProvider({
      apiKey: "test",
      fetch: async () => response,
      async record() {},
    });
    assert.equal((await p.create("{}", "key")).state, state);
  }
  let calls = 0;
  const missing = createBetaProvider({
    apiKey: "",
    fetch: async () => {
      calls++;
      throw new Error("not allowed");
    },
    async record() {},
  });
  assert.equal((await missing.create("{}", "key")).state, "failed");
  assert.equal(calls, 0);
});
test("retrieve, early update and cancellation operate on the existing provider ID", async () => {
  const calls: string[] = [];
  const p = createBetaProvider({
    apiKey: "test",
    fetch: async (url, init) => {
      calls.push(`${init?.method}:${url}:${init?.body ?? ""}`);
      return Response.json(
        init?.method === "GET"
          ? {
              id: "provider-1",
              last_event: "delivered",
              scheduled_at: "2026-09-06T11:00:00Z",
            }
          : { id: "provider-1" },
      );
    },
    async record() {},
  });
  assert.equal((await p.retrieve("provider-1")).state, "delivered");
  assert.equal(
    (await p.update("provider-1", "2026-09-05T12:01:00Z")).state,
    "sending",
  );
  assert.equal((await p.cancel("provider-1")).state, "canceled");
  assert.deepEqual(calls, [
    "GET:https://api.resend.com/emails/provider-1:",
    'PATCH:https://api.resend.com/emails/provider-1:{"scheduled_at":"2026-09-05T12:01:00Z"}',
    "POST:https://api.resend.com/emails/provider-1/cancel:",
  ]);
});
