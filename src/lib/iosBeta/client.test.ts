import assert from "node:assert/strict";
import test from "node:test";

import { submitBetaSignup } from "./client.ts";
import type { BetaAnswers } from "./questionnaire.ts";

test("signup submits only the address and honeypot to the public endpoint", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const result = await submitBetaSignup(
    "player@example.com",
    "",
    async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return Response.json({ ok: true });
    },
  );

  assert.equal(result, "success");
  assert.equal(capturedUrl, "/api/ios-beta");
  assert.equal(capturedInit?.method, "POST");
  assert.equal(capturedInit?.headers instanceof Headers, false);
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    email: "player@example.com",
    company: "",
  });
});

test("signup nests questionnaire answers in the public request payload", async () => {
  const answers: BetaAnswers = {
    formVersion: 2,
    role: "both",
    interests: ["iphone_recording", "coach_students"],
    feedback: ["video_call"],
  };
  let capturedBody: unknown;

  const result = await submitBetaSignup(
    "player@example.com",
    "",
    async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return Response.json({ ok: true });
    },
    answers,
  );

  assert.equal(result, "success");
  assert.deepEqual(capturedBody, {
    email: "player@example.com",
    company: "",
    answers,
  });
});

test("signup turns server outcomes into stable visitor-facing states", async () => {
  const cases: Array<{
    status: number;
    body: unknown;
    expected: Awaited<ReturnType<typeof submitBetaSignup>>;
  }> = [
    { status: 400, body: { ok: false, code: "invalid_email" }, expected: "invalid_email" },
    { status: 400, body: { ok: false, code: "invalid_answers" }, expected: "invalid_answers" },
    { status: 429, body: { ok: false, code: "rate_limited" }, expected: "rate_limited" },
    { status: 503, body: { ok: false, code: "delivery_failed" }, expected: "unavailable" },
    { status: 500, body: { ok: false, code: "anything" }, expected: "unavailable" },
  ];

  for (const item of cases) {
    const result = await submitBetaSignup("player@example.com", "", async () =>
      Response.json(item.body, { status: item.status }),
    );
    assert.equal(result, item.expected);
  }
});

test("signup treats broken network and non-JSON responses as temporarily unavailable", async () => {
  assert.equal(
    await submitBetaSignup("player@example.com", "", async () => {
      throw new Error("offline");
    }),
    "unavailable",
  );
  assert.equal(
    await submitBetaSignup("player@example.com", "", async () =>
      new Response("not json", { status: 502 }),
    ),
    "unavailable",
  );
});
