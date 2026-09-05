import assert from "node:assert/strict";
import test from "node:test";
import {
  runBetaDelivery,
  type BetaJob,
  type ScheduledDeliveryDependencies,
} from "./scheduledDelivery.ts";

const deadline = "2026-09-06T11:00:00.000Z";

test("a webhook between lease and prepare prevents another create and preserves delivered evidence", async () => {
  const f = fixture({
    state: "unknown",
    first_attempt_at: "2026-09-05T11:00:00Z",
    create_payload: "{}",
  });
  f.deps.prepare = async () => ({
    ...f.job,
    state: "delivered",
    provider_email_id: "provider-1",
    create_allowed: false,
  });
  assert.equal(await runBetaDelivery("job-1", f.deps), "delivered");
  assert.equal(f.job.state, "delivered");
  assert.deepEqual(f.calls, []);
});

test("scheduled identity appearing during prepare is retrieved instead of posted again", async () => {
  const f = fixture({
    state: "unknown",
    first_attempt_at: "2026-09-05T11:00:00Z",
    create_payload: "{}",
  });
  f.deps.prepare = async () => ({
    ...f.job,
    state: "scheduled",
    provider_email_id: "provider-1",
    create_allowed: false,
  });
  assert.equal(await runBetaDelivery("job-1", f.deps), "scheduled");
  assert.deepEqual(f.calls, ["GET:provider-1"]);
});

test("confirmed provider failure is not turned back into a sendable invitation", async () => {
  const f = fixture({
    state: "failed",
    provider_email_id: "provider-1",
    early_target_at: "2026-09-05T12:01:00Z",
  });
  assert.equal(await runBetaDelivery("job-1", f.deps), "failed");
  assert.deepEqual(f.calls, []);
});

test("a retry cannot begin inside the final minute of provider idempotency protection", async () => {
  const f = fixture({
    state: "unknown",
    first_attempt_at: "2026-09-04T12:00:30Z",
    create_payload: "{}",
  });
  assert.equal(await runBetaDelivery("job-1", f.deps), "needs_attention");
  assert.deepEqual(f.calls, []);
});
function fixture(over: Partial<BetaJob> = {}) {
  let job: BetaJob = {
    id: "job-1",
    request_id: "request-1",
    kind: "invite",
    recipient: "player@example.com",
    state: "pending",
    provider_email_id: null,
    idempotency_key: "ios-beta-request-1-invite",
    create_payload: null,
    first_attempt_at: null,
    error_code: null,
    early_target_at: null,
    early_applied_at: null,
    cancel_requested: false,
    ...over,
  };
  let locked = false;
  let current = Date.parse("2026-09-05T12:00:00Z");
  let suppressed = false;
  const calls: string[] = [];
  const payloads: string[] = [];
  const deps: ScheduledDeliveryDependencies = {
    now: () => current,
    async lease() {
      if (locked) return null;
      locked = true;
      return { ...job };
    },
    async read() {
      return { ...job };
    },
    async prepare(_job, _token, payload) {
      job = {
        ...job,
        create_payload: payload,
        first_attempt_at:
          job.first_attempt_at ?? new Date(current).toISOString(),
        state: "unknown",
      };
      return { ...job, create_allowed: true };
    },
    async finish(_job, _token, result) {
      job = {
        ...job,
        state: result.state,
        provider_email_id: result.id ?? job.provider_email_id,
        error_code: result.error ?? null,
        early_applied_at:
          result.state === "sending"
            ? new Date(current).toISOString()
            : job.early_applied_at,
      };
      locked = false;
      return true;
    },
    async payload() {
      return JSON.stringify({
        scheduled_at: job.early_target_at ?? deadline,
        version: 1,
      });
    },
    async isSuppressed() {
      return suppressed;
    },
    provider: {
      async create(payload, key) {
        assert.ok(job.first_attempt_at);
        assert.equal(job.create_payload, payload);
        calls.push(`POST:${key}`);
        payloads.push(payload);
        return { state: "scheduled", id: "provider-1" };
      },
      async retrieve(id) {
        calls.push(`GET:${id}`);
        return { state: "scheduled", id, scheduledAt: deadline };
      },
      async update(id, at) {
        calls.push(`PATCH:${id}:${at}`);
        return { state: "sending", id };
      },
      async cancel(id) {
        calls.push(`CANCEL:${id}`);
        return { state: "canceled", id };
      },
    },
  };
  return {
    deps,
    calls,
    payloads,
    get job() {
      return job;
    },
    now(value: string) {
      current = Date.parse(value);
    },
    suppress() {
      suppressed = true;
    },
    requestEarly() {
      job = { ...job, early_target_at: "2026-09-05T12:01:00.000Z" };
    },
  };
}

test("scheduling persists attempt and original 23-hour payload before provider IO, without marking sent", async () => {
  const f = fixture();
  assert.equal(await runBetaDelivery("job-1", f.deps), "scheduled");
  assert.deepEqual(JSON.parse(f.payloads[0]), {
    scheduled_at: "2026-09-06T11:00:00.000Z",
    version: 1,
  });
  assert.equal(f.job.provider_email_id, "provider-1");
  assert.equal(f.job.state, "scheduled");
});
test("two concurrent early sends update one provider ID without a second POST", async () => {
  const f = fixture({
    state: "scheduled",
    provider_email_id: "provider-1",
    early_target_at: "2026-09-05T12:01:00.000Z",
  });
  await Promise.all([
    runBetaDelivery("job-1", f.deps),
    runBetaDelivery("job-1", f.deps),
  ]);
  assert.deepEqual(f.calls, [
    "GET:provider-1",
    "PATCH:provider-1:2026-09-05T12:01:00.000Z",
  ]);
  assert.equal(f.job.state, "sending");
});

for (const boundary of ["retrieve", "finish"] as const) {
  test(`normal lease before early intent at ${boundary} brings forward the existing message`, async () => {
    const f = fixture({
      state: "scheduled", provider_email_id: "provider-1",
      create_payload: '{"scheduled_at":"2026-09-06T11:00:00.000Z","version":1}',
      first_attempt_at: "2026-09-05T11:00:00Z",
    });
    let admin: Promise<string> | undefined;
    const requestEarly = () => {
      if (admin) return;
      f.requestEarly();
      admin = runBetaDelivery("job-1", f.deps);
    };
    if (boundary === "retrieve") {
      const retrieve = f.deps.provider.retrieve;
      f.deps.provider.retrieve = async (id) => {
        const observed = await retrieve(id);
        requestEarly();
        return observed;
      };
    } else {
      const finish = f.deps.finish;
      f.deps.finish = async (job, token, result) => {
        requestEarly(); // after the owner's last intent read, before releasing its lease
        return finish(job, token, result);
      };
    }
    const normal = await runBetaDelivery("job-1", f.deps);
    assert.equal(await admin, "sending");
    assert.equal(normal, "sending");
    assert.deepEqual(f.calls.filter(c => !c.startsWith("GET:")), [
      "PATCH:provider-1:2026-09-05T12:01:00.000Z",
    ]);
    assert.equal(f.job.provider_email_id, "provider-1");
    assert.equal(f.job.create_payload, '{"scheduled_at":"2026-09-06T11:00:00.000Z","version":1}');
    assert.equal(f.job.idempotency_key, "ios-beta-request-1-invite");
    assert.ok(f.job.early_applied_at);
  });
}

test("busy early-send retries are bounded and preserve unapplied intent", async () => {
  const f = fixture({ state: "scheduled", provider_email_id: "provider-1" });
  f.requestEarly();
  let leases = 0;
  f.deps.lease = async () => { leases++; return null; };
  assert.equal(await runBetaDelivery("job-1", f.deps), "scheduled");
  assert.ok(leases > 1 && leases <= 4, `bounded handoff attempts: ${leases}`);
  assert.ok(f.job.early_target_at);
  assert.equal(f.job.early_applied_at, null);
  assert.deepEqual(f.calls, []);
});

test("delivered evidence during retrieval prevents a stale scheduled response from triggering early update", async () => {
  const f = fixture({ state: "scheduled", provider_email_id: "provider-1" });
  f.requestEarly();
  const retrieve = f.deps.provider.retrieve;
  f.deps.provider.retrieve = async (id) => {
    const result = await retrieve(id);
    f.job.state = "delivered";
    return result;
  };
  assert.equal(await runBetaDelivery("job-1", f.deps), "delivered");
  assert.deepEqual(f.calls, ["GET:provider-1"]);
});

for (const observed of ["bounced", "failed", "canceled"] as const) {
  test(`provider ${observed} during retrieval reaches finish even when Sent arrives locally`, async () => {
    const f = fixture({ state: "scheduled", provider_email_id: "provider-1" });
    f.requestEarly();
    f.deps.provider.retrieve = async (id) => {
      f.calls.push(`GET:${id}`);
      f.job.state = "sent";
      return { state: observed, id };
    };
    assert.equal(await runBetaDelivery("job-1", f.deps), observed);
    assert.deepEqual(f.calls, ["GET:provider-1"]);
  });
}
test("early send racing dispatch retrieves sent evidence and never updates or recreates", async () => {
  const f = fixture({
    state: "scheduled",
    provider_email_id: "provider-1",
    early_target_at: "2026-09-05T12:01:00Z",
  });
  f.deps.provider.retrieve = async () => ({ state: "sent", id: "provider-1" });
  assert.equal(await runBetaDelivery("job-1", f.deps), "sent");
  assert.deepEqual(f.calls, []);
});
test("unknown create retries exact bytes/key, despite changed template or later time", async () => {
  const f = fixture();
  const create = f.deps.provider.create;
  let first = true;
  f.deps.provider.create = async (payload, key) => {
    await create(payload, key);
    if (first) {
      first = false;
      return { state: "unknown", error: "provider_unconfirmed" };
    }
    return { state: "scheduled", id: "provider-1" };
  };
  assert.equal(await runBetaDelivery("job-1", f.deps), "unknown");
  f.now("2026-09-05T20:00:00Z");
  f.deps.payload = async () => '{"changed":true}';
  assert.equal(await runBetaDelivery("job-1", f.deps), "scheduled");
  assert.equal(f.payloads[0], f.payloads[1]);
  assert.equal(f.calls[0], f.calls[1]);
});
test("expired ambiguous attempt is attention, never a fresh POST", async () => {
  const f = fixture({
    state: "unknown",
    first_attempt_at: "2026-09-04T12:00:00Z",
    create_payload: '{"scheduled_at":"2026-09-06T11:00:00Z"}',
  });
  assert.equal(await runBetaDelivery("job-1", f.deps), "needs_attention");
  assert.deepEqual(f.calls, []);
});
test("suppression closes an unattempted invite but cancels an accepted one", async () => {
  const fresh = fixture();
  fresh.suppress();
  assert.equal(await runBetaDelivery("job-1", fresh.deps), "suppressed");
  assert.deepEqual(fresh.calls, []);
  const scheduled = fixture({
    state: "scheduled",
    provider_email_id: "provider-1",
    early_target_at: "2026-09-05T12:01:00Z",
  });
  scheduled.suppress();
  assert.equal(await runBetaDelivery("job-1", scheduled.deps), "suppressed");
  assert.deepEqual(scheduled.calls, ["GET:provider-1", "CANCEL:provider-1"]);
});
test("cancellation uncertainty is visible and cannot trigger an early update or replacement", async () => {
  const f = fixture({
    state: "scheduled",
    provider_email_id: "provider-1",
    cancel_requested: true,
    early_target_at: "2026-09-05T12:01:00Z",
  });
  f.deps.provider.cancel = async () => ({
    state: "unknown",
    error: "cancel_unconfirmed",
  });
  assert.equal(await runBetaDelivery("job-1", f.deps), "unknown");
  assert.equal(f.job.error_code, "cancel_unconfirmed");
  assert.deepEqual(f.calls, ["GET:provider-1"]);
});
test("suppressed unknown acceptance does not POST again just to discover the ID", async () => {
  const f = fixture({
    state: "unknown",
    first_attempt_at: "2026-09-05T11:59:00Z",
    create_payload: "{}",
  });
  f.suppress();
  assert.equal(await runBetaDelivery("job-1", f.deps), "needs_attention");
  assert.deepEqual(f.calls, []);
});
test("a failure to persist provider acceptance does not report scheduled success", async () => {
  const f = fixture();
  f.deps.finish = async () => {
    throw new Error("database unavailable");
  };
  assert.equal(await runBetaDelivery("job-1", f.deps), "unknown");
  assert.equal(f.job.state, "unknown");
  assert.equal(f.payloads.length, 1);
});
test("historic unknown and definitively canceled records never recreate automatically", async () => {
  for (const state of [
    "needs_attention",
    "canceled",
    "sent",
    "suppressed",
  ] as const) {
    const f = fixture({
      state,
      error_code: state === "needs_attention" ? "legacy_unconfirmed" : null,
    });
    assert.equal(await runBetaDelivery("job-1", f.deps), state);
    assert.deepEqual(f.calls, []);
  }
});

test("suppression appearing during provider acceptance is canceled in the same delivery operation", async () => {
  const f = fixture();
  const create = f.deps.provider.create;
  f.deps.provider.create = async (payload, key) => {
    const result = await create(payload, key);
    f.suppress();
    return result;
  };
  assert.equal(await runBetaDelivery("job-1", f.deps), "suppressed");
  assert.deepEqual(f.calls, [
    "POST:ios-beta-request-1-invite",
    "GET:provider-1",
    "CANCEL:provider-1",
  ]);
});
