import assert from "node:assert/strict";
import test from "node:test";

import { betaInvitationEmail } from "./catalog.ts";
import {
  sendTransactionalEmail,
  type EmailDeliveryDependencies,
} from "./send.ts";
import * as sender from "./send.ts";

const message = betaInvitationEmail(
  "https://testflight.apple.com/join/H9XdnySg",
);

test("delivery sends one complete multipart transactional request", async () => {
  let request: { url: string; init: RequestInit } | undefined;
  const metered: string[] = [];
  const dependencies: EmailDeliveryDependencies = {
    apiKey: "re_test",
    async isSuppressed() {
      return false;
    },
    async fetch(url, init) {
      request = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
    },
    async record(messageId) {
      metered.push(messageId);
    },
  };

  const result = await sendTransactionalEmail(
    {
      to: "player@example.com",
      message,
      idempotencyKey: "preview-beta-invite",
      operation: "ios_beta_invite_email",
    },
    dependencies,
  );

  assert.equal(result, "sent");
  assert.equal(request?.url, "https://api.resend.com/emails");
  const payload = JSON.parse(String(request?.init.body));
  assert.equal(payload.from, "PongLens <support@ponglens.com>");
  assert.equal(payload.reply_to, "support@ponglens.com");
  assert.equal(payload.subject, "Your PongLens iPhone beta is ready");
  assert.match(payload.html, /prefers-color-scheme:\s*dark/);
  assert.match(payload.text, /Install PongLens beta/);
  assert.deepEqual(payload.headers, {
    "X-PongLens-Template-Id": "beta.invitation",
    "X-PongLens-Template-Version": "2",
  });
  assert.equal(
    new Headers(request?.init.headers).get("Idempotency-Key"),
    "preview-beta-invite",
  );
  assert.deepEqual(metered, ["email_123"]);
});

test("suppression stops customer delivery before the provider call", async () => {
  let calls = 0;
  const result = await sendTransactionalEmail(
    {
      to: "player@example.com",
      message,
      idempotencyKey: "preview-beta-suppressed",
      operation: "ios_beta_invite_email",
    },
    {
      apiKey: "re_test",
      async isSuppressed() {
        return true;
      },
      async fetch() {
        calls += 1;
        return new Response(null, { status: 200 });
      },
      async record() {},
    },
  );
  assert.equal(result, "suppressed");
  assert.equal(calls, 0);
});

test("a provider failure remains best effort and is not metered", async () => {
  let metered = false;
  const result = await sendTransactionalEmail(
    {
      to: "player@example.com",
      message,
      idempotencyKey: "preview-beta-failed",
      operation: "ios_beta_invite_email",
    },
    {
      apiKey: "re_test",
      async isSuppressed() {
        return false;
      },
      async fetch() {
        return new Response("provider unavailable", { status: 503 });
      },
      async record() {
        metered = true;
      },
      reportError() {},
    },
  );
  assert.equal(result, "failed");
  assert.equal(metered, false);
});

test("invalid idempotency keys and missing credentials never make a request", async () => {
  let calls = 0;
  const dependencies: EmailDeliveryDependencies = {
    apiKey: "",
    async isSuppressed() {
      return false;
    },
    async fetch() {
      calls += 1;
      return new Response(null, { status: 200 });
    },
    async record() {},
  };
  assert.equal(
    await sendTransactionalEmail(
      {
        to: "player@example.com",
        message,
        idempotencyKey: "missing-key",
        operation: "test",
      },
      dependencies,
    ),
    "failed",
  );
  assert.equal(calls, 0);
  await assert.rejects(
    sendTransactionalEmail(
      {
        to: "player@example.com",
        message,
        idempotencyKey: "x".repeat(257),
        operation: "test",
      },
      { ...dependencies, apiKey: "re_test" },
    ),
    /idempotency key/,
  );
});

test("accepted provider receipts survive metering failure and carry durable webhook correlation", async () => {
  assert.equal(typeof sender.sendTransactionalEmailWithReceipt, "function");
  let payload: Record<string, unknown> = {};
  const result = await sender.sendTransactionalEmailWithReceipt({
    to: "player@example.com", message, idempotencyKey: "match-issue-receipt", operation: "test",
    tags: [{ name: "match_issue_delivery_id", value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
  }, {
    apiKey: "re_test", async isSuppressed() { return false; },
    async fetch(_url, init) {
      payload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "accepted-provider-id" }), { status: 200 });
    },
    async record() { throw new Error("meter unavailable after provider accepted"); },
    reportError() {},
  });
  assert.deepEqual(result, { state: "sent", providerEmailId: "accepted-provider-id" });
  assert.deepEqual(payload.tags, [{ name: "match_issue_delivery_id", value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }]);
});

test("a retry sends the frozen provider bytes instead of rerendering a newer message", async () => {
  const frozen = '{"to":["player@example.com"],"subject":"Previously prepared"}';
  let bytes = "";
  const receipt = await sender.sendTransactionalEmailWithReceipt({
    to: "player@example.com", message, idempotencyKey: "frozen-send", operation: "test", preparedPayload: frozen,
  }, {
    apiKey: "re_test", async isSuppressed() { return false; },
    async fetch(_url, init) { bytes = String(init?.body); return new Response('{"id":"frozen-provider"}'); },
    async record() {},
  });
  assert.equal(bytes, frozen);
  assert.deepEqual(receipt, { state: "sent", providerEmailId: "frozen-provider" });
});
