import assert from "node:assert/strict";
import test from "node:test";

import {
  betaIdempotencyKey,
  deliverBetaRecord,
  type BetaDeliveryDependencies,
  type BetaRequestRecord,
} from "../iosBeta/delivery.ts";

const request: BetaRequestRecord = {
  id: "50aa4d45-9570-4d9b-90d6-79768994ce80",
  email: "player@example.com",
  requestedAt: "2026-09-04T14:30:00.000Z",
  inviteNeeded: true,
  adminNoticeNeeded: true,
};

test("delivery keys distinguish the two messages and stay bound to the request", () => {
  assert.equal(
    betaIdempotencyKey(request.id, "invite"),
    `ios-beta-${request.id}-invite`,
  );
  assert.equal(
    betaIdempotencyKey(request.id, "admin"),
    `ios-beta-${request.id}-admin`,
  );
});

test("successful delivery stamps each independently completed message", async () => {
  const sent: string[] = [];
  const stamps: string[] = [];
  const dependencies: BetaDeliveryDependencies = {
    async send(kind) {
      sent.push(kind);
      return "sent";
    },
    async stamp(kind) {
      stamps.push(kind);
    },
  };

  const result = await deliverBetaRecord(request, dependencies);

  assert.deepEqual(result, { invite: "sent", admin: "sent" });
  assert.deepEqual(sent, ["invite", "admin"]);
  assert.deepEqual(stamps, ["invite_sent", "admin_sent"]);
});

test("visitor and administrator messages begin together so one provider delay cannot hold the other", async () => {
  const started: string[] = [];
  let releaseInvite!: () => void;
  const inviteGate = new Promise<void>((resolve) => {
    releaseInvite = resolve;
  });
  const delivery = deliverBetaRecord(request, {
    async send(kind) {
      started.push(kind);
      if (kind === "invite") await inviteGate;
      return "sent";
    },
    async stamp() {},
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, ["invite", "admin"]);
  releaseInvite();
  assert.deepEqual(await delivery, { invite: "sent", admin: "sent" });
});

test("visitor delivery failure does not prevent the administrator notification", async () => {
  const stamps: string[] = [];
  const result = await deliverBetaRecord(request, {
    async send(kind) {
      return kind === "invite" ? "failed" : "sent";
    },
    async stamp(kind) {
      stamps.push(kind);
    },
  });

  assert.deepEqual(result, { invite: "failed", admin: "sent" });
  assert.deepEqual(stamps, ["admin_sent"]);
});

test("an unexpected visitor send error is isolated from the administrator message", async () => {
  const sent: string[] = [];
  const errors: string[] = [];
  const result = await deliverBetaRecord(request, {
    async send(kind) {
      sent.push(kind);
      if (kind === "invite") throw new Error("network reset");
      return "sent";
    },
    async stamp() {},
    reportError(kind) {
      errors.push(kind);
    },
  });

  assert.deepEqual(result, { invite: "failed", admin: "sent" });
  assert.deepEqual(sent, ["invite", "admin"]);
  assert.deepEqual(errors, ["invite"]);
});

test("a failed visitor stamp is retryable and does not block the administrator", async () => {
  const sent: string[] = [];
  const errors: string[] = [];
  const result = await deliverBetaRecord(request, {
    async send(kind) {
      sent.push(kind);
      return "sent";
    },
    async stamp(kind) {
      if (kind === "invite_sent") throw new Error("write failed");
    },
    reportError(kind) {
      errors.push(kind);
    },
  });

  assert.deepEqual(result, { invite: "failed", admin: "sent" });
  assert.deepEqual(sent, ["invite", "admin"]);
  assert.deepEqual(errors, ["invite"]);
});

test("a suppressed visitor is stamped once and not represented as delivered", async () => {
  const stamps: string[] = [];
  const result = await deliverBetaRecord(request, {
    async send(kind) {
      return kind === "invite" ? "suppressed" : "sent";
    },
    async stamp(kind) {
      stamps.push(kind);
    },
  });

  assert.deepEqual(result, { invite: "suppressed", admin: "sent" });
  assert.deepEqual(stamps, ["invite_suppressed", "admin_sent"]);
});

test("a suppressed administrator notification is also closed out", async () => {
  const stamps: string[] = [];
  const result = await deliverBetaRecord(request, {
    async send(kind) {
      return kind === "admin" ? "suppressed" : "sent";
    },
    async stamp(kind) {
      stamps.push(kind);
    },
  });

  assert.deepEqual(result, { invite: "sent", admin: "suppressed" });
  assert.deepEqual(stamps, ["invite_sent", "admin_suppressed"]);
});

test("already completed messages cause no external calls", async () => {
  let calls = 0;
  const result = await deliverBetaRecord(
    { ...request, inviteNeeded: false, adminNoticeNeeded: false },
    {
      async send() {
        calls += 1;
        return "sent";
      },
      async stamp() {
        calls += 1;
      },
    },
  );

  assert.deepEqual(result, {
    invite: "already_sent",
    admin: "already_sent",
  });
  assert.equal(calls, 0);
});
