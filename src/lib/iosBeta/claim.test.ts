import assert from "node:assert/strict";
import test from "node:test";

import {
  claimIosBetaRequest,
  hashBetaSource,
  type BetaClaimClient,
} from "./claim.ts";

test("source hashing is stable, keyed, and does not retain the source address", () => {
  const first = hashBetaSource("203.0.113.4", "secret-one");
  const repeated = hashBetaSource("203.0.113.4", "secret-one");
  const otherSecret = hashBetaSource("203.0.113.4", "secret-two");

  assert.equal(first, repeated);
  assert.notEqual(first, otherSecret);
  assert.equal(first.length, 64);
  assert.doesNotMatch(first, /203\.0\.113\.4/);
});

test("claim adapter returns the database decision with stable application names", async () => {
  const client: BetaClaimClient = {
    async rpc(name, params) {
      assert.equal(name, "claim_ios_beta_request");
      assert.deepEqual(params, {
        p_email: "player@example.com",
        p_ip_hash: "abc123",
      });
      return {
        data: [
          {
            request_id: "50aa4d45-9570-4d9b-90d6-79768994ce80",
            request_email: "player@example.com",
            requested_at: "2026-09-04T14:30:00.000Z",
            invite_needed: true,
            admin_notice_needed: false,
            rate_limited: false,
          },
        ],
        error: null,
      };
    },
  };

  assert.deepEqual(
    await claimIosBetaRequest("player@example.com", "abc123", client),
    {
      id: "50aa4d45-9570-4d9b-90d6-79768994ce80",
      email: "player@example.com",
      requestedAt: "2026-09-04T14:30:00.000Z",
      inviteNeeded: true,
      adminNoticeNeeded: false,
      rateLimited: false,
    },
  );
});

test("claim adapter preserves a rate-limit decision without inventing a request", async () => {
  const client: BetaClaimClient = {
    async rpc() {
      return {
        data: [
          {
            request_id: null,
            request_email: null,
            requested_at: null,
            invite_needed: false,
            admin_notice_needed: false,
            rate_limited: true,
          },
        ],
        error: null,
      };
    },
  };

  assert.deepEqual(
    await claimIosBetaRequest("fresh@example.com", "abc123", client),
    {
      id: null,
      email: null,
      requestedAt: null,
      inviteNeeded: false,
      adminNoticeNeeded: false,
      rateLimited: true,
    },
  );
});

test("claim adapter fails closed on database errors and malformed rows", async () => {
  const failing: BetaClaimClient = {
    async rpc() {
      return { data: null, error: { message: "database unavailable" } };
    },
  };
  await assert.rejects(
    claimIosBetaRequest("player@example.com", "abc123", failing),
    /database unavailable/,
  );

  const malformed: BetaClaimClient = {
    async rpc() {
      return { data: [{ invite_needed: true }], error: null };
    },
  };
  await assert.rejects(
    claimIosBetaRequest("player@example.com", "abc123", malformed),
    /malformed/i,
  );
});
