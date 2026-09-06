import assert from "node:assert/strict";
import test from "node:test";
import * as provider from "./provider.ts";

test("beta management uses only its dedicated server credential", () => {
  assert.equal(typeof provider.betaApiKey, "function");
  assert.equal(provider.betaApiKey({ RESEND_BETA_API_KEY: "beta-key", RESEND_API_KEY: "ordinary-key" }), "beta-key");
});

test("missing beta credentials never fall back to the ordinary sending key", () => {
  assert.equal(typeof provider.betaApiKey, "function");
  assert.equal(provider.betaApiKey({ RESEND_API_KEY: "ordinary-key" }), "");
  assert.equal(provider.betaApiKey({ RESEND_BETA_API_KEY: "  " }), "");
});
