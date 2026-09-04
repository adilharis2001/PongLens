import assert from "node:assert/strict";
import test from "node:test";

import {
  handleIosBetaRequest,
  type BetaRequestHandlerDependencies,
} from "../../../lib/iosBeta/request.ts";

const claim = {
  id: "50aa4d45-9570-4d9b-90d6-79768994ce80",
  email: "player@example.com",
  requestedAt: "2026-09-04T14:30:00.000Z",
  inviteNeeded: true,
  adminNoticeNeeded: true,
  rateLimited: false,
};

function dependencies(
  over: Partial<BetaRequestHandlerDependencies> = {},
): BetaRequestHandlerDependencies {
  return {
    testFlightUrl: "https://testflight.apple.com/join/Ab12Cd34",
    serviceSecret: "service-secret",
    async claim() {
      return claim;
    },
    async deliver() {
      return { invite: "sent", admin: "sent" };
    },
    ...over,
  };
}

function request(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://www.ponglens.com/api/ios-beta", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function responseJson(response: Response) {
  return (await response.json()) as { ok: boolean; code?: string };
}

test("valid requests normalize the address and send through a non-reversible source hash", async () => {
  let receivedEmail = "";
  let receivedHash = "";
  const response = await handleIosBetaRequest(
    request(
      { email: "  Player@Example.COM ", company: "" },
      { "x-forwarded-for": "203.0.113.4, 10.0.0.1" },
    ),
    dependencies({
      async claim(email, ipHash) {
        receivedEmail = email;
        receivedHash = ipHash;
        return claim;
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), { ok: true });
  assert.equal(receivedEmail, "player@example.com");
  assert.equal(receivedHash.length, 64);
  assert.doesNotMatch(receivedHash, /203\.0\.113\.4/);
});

test("already delivered requests get the same success response", async () => {
  const response = await handleIosBetaRequest(
    request({ email: "player@example.com" }),
    dependencies({
      async claim() {
        return { ...claim, inviteNeeded: false, adminNoticeNeeded: false };
      },
      async deliver() {
        return { invite: "already_sent", admin: "already_sent" };
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), { ok: true });
});

test("invalid email is corrected before any database claim", async () => {
  let claims = 0;
  const response = await handleIosBetaRequest(
    request({ email: "not-an-email" }),
    dependencies({
      async claim() {
        claims += 1;
        return claim;
      },
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await responseJson(response), {
    ok: false,
    code: "invalid_email",
  });
  assert.equal(claims, 0);
});

test("honeypot submissions receive quiet success and create no request", async () => {
  let claims = 0;
  const response = await handleIosBetaRequest(
    request({ email: "bot@example.com", company: "Pong Corp" }),
    dependencies({
      testFlightUrl: undefined,
      async claim() {
        claims += 1;
        return claim;
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), { ok: true });
  assert.equal(claims, 0);
});

test("missing or unsafe server configuration fails closed", async () => {
  for (const configuration of [
    { testFlightUrl: undefined },
    { testFlightUrl: "https://example.com/not-testflight" },
    { serviceSecret: undefined },
  ]) {
    const response = await handleIosBetaRequest(
      request({ email: "player@example.com" }),
      dependencies(configuration),
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await responseJson(response), {
      ok: false,
      code: "temporarily_unavailable",
    });
  }
});

test("source rate limits and visitor delivery failures have actionable statuses", async () => {
  const limited = await handleIosBetaRequest(
    request({ email: "player@example.com" }),
    dependencies({
      async claim() {
        return {
          id: null,
          email: null,
          requestedAt: null,
          inviteNeeded: false,
          adminNoticeNeeded: false,
          rateLimited: true,
        };
      },
    }),
  );
  assert.equal(limited.status, 429);
  assert.deepEqual(await responseJson(limited), {
    ok: false,
    code: "rate_limited",
  });

  const failed = await handleIosBetaRequest(
    request({ email: "player@example.com" }),
    dependencies({
      async deliver() {
        return { invite: "failed", admin: "sent" };
      },
    }),
  );
  assert.equal(failed.status, 503);
  assert.deepEqual(await responseJson(failed), {
    ok: false,
    code: "delivery_failed",
  });
});

test("malformed JSON is treated as invalid input rather than a server error", async () => {
  const malformed = new Request("https://www.ponglens.com/api/ios-beta", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{broken",
  });
  const response = await handleIosBetaRequest(malformed, dependencies());

  assert.equal(response.status, 400);
  assert.deepEqual(await responseJson(response), {
    ok: false,
    code: "invalid_request",
  });
});
