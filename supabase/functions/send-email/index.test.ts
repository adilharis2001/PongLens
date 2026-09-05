import assert from "node:assert/strict";
import test from "node:test";

import {
  handleSendEmailHook,
  type AuthEmailDelivery,
  type AuthHookPayload,
} from "./index.ts";

const basePayload: AuthHookPayload = {
  user: { email: "maya.chen@example.com" },
  email_data: {
    token: "248613",
    token_hash: "preview-token-hash",
    redirect_to: "https://www.ponglens.com/auth/confirm?next=%2Fmatches",
    email_action_type: "magiclink",
  },
};

function request(headers: Record<string, string> = {}) {
  return { method: "POST", rawBody: "signed payload", headers };
}

test("an invalid signature sends nothing", async () => {
  const deliveries: AuthEmailDelivery[] = [];
  const response = await handleSendEmailHook(request(), {
    verify: () => { throw new Error("bad signature"); },
    deliver: async (delivery) => { deliveries.push(delivery); },
  });

  assert.equal(response.status, 401);
  assert.deepEqual(deliveries, []);
});

test("magic-link mail maps the verified token and preserves the destination", async () => {
  const deliveries: AuthEmailDelivery[] = [];
  const response = await handleSendEmailHook(
    request({ "webhook-id": "msg_preview_magic" }),
    {
      verify: () => basePayload,
      deliver: async (delivery) => { deliveries.push(delivery); },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].to, "maya.chen@example.com");
  assert.equal(deliveries[0].subject, "Your PongLens sign-in link");
  assert.match(deliveries[0].html, /token_hash=preview-token-hash/);
  assert.match(deliveries[0].html, /next=%2Fmatches/);
  assert.match(deliveries[0].html, /type=email/);
  assert.match(deliveries[0].text, /248613/);
  assert.equal(deliveries[0].idempotencyKey, "msg_preview_magic");
  assert.equal(deliveries[0].headers["X-PongLens-Template-Id"], "auth.magic-link");
});

test("signup mail uses the confirmation copy", async () => {
  const deliveries: AuthEmailDelivery[] = [];
  const response = await handleSendEmailHook(
    request({ "webhook-id": "msg_preview_signup" }),
    {
      verify: () => ({
        ...basePayload,
        email_data: { ...basePayload.email_data, email_action_type: "signup" },
      }),
      deliver: async (delivery) => { deliveries.push(delivery); },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(deliveries[0].subject, "Confirm your email for PongLens");
  assert.equal(deliveries[0].headers["X-PongLens-Template-Id"], "auth.confirm-account");
});

test("unknown and secure-email-change actions fail closed", async () => {
  for (const email_action_type of ["email_change", "recovery", "unexpected"]) {
    let delivered = false;
    const response = await handleSendEmailHook(request(), {
      verify: () => ({
        ...basePayload,
        email_data: { ...basePayload.email_data, email_action_type },
      }),
      deliver: async () => { delivered = true; },
    });
    assert.equal(response.status, 400);
    assert.equal(delivered, false);
  }
});

test("provider errors remain visible to Supabase Auth", async () => {
  const response = await handleSendEmailHook(
    request({ "webhook-id": "msg_preview_failure" }),
    {
      verify: () => basePayload,
      deliver: async () => { throw new Error("provider unavailable"); },
    },
  );

  assert.equal(response.status, 502);
  const body = await response.json() as { error: { message: string } };
  assert.equal(body.error.message, "The authentication email could not be sent.");
});

test("non-POST requests are rejected before verification", async () => {
  let verified = false;
  const response = await handleSendEmailHook(
    { method: "GET", rawBody: "", headers: {} },
    {
      verify: () => { verified = true; return basePayload; },
      deliver: async () => {},
    },
  );
  assert.equal(response.status, 405);
  assert.equal(verified, false);
});
