import assert from "node:assert/strict";
import test from "node:test";
import { handleBetaAdminReconcile } from "./adminReconcile.ts";
const id = "30000000-0000-0000-0000-000000000001";
const request = (ids: unknown, origin = "https://ponglens.com") =>
  new Request("https://ponglens.com/api/admin/ios-beta/reconcile", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
test("reconciliation requires admin and same origin before provider work", async () => {
  let calls = 0;
  const dependencies = {
    admin: async () => false,
    reconcile: async () => {
      calls++;
      return "scheduled";
    },
  };
  assert.equal(
    (await handleBetaAdminReconcile(request([id]), dependencies)).status,
    403,
  );
  assert.equal(
    (
      await handleBetaAdminReconcile(request([id], "https://other.org"), {
        ...dependencies,
        admin: async () => true,
      })
    ).status,
    403,
  );
  assert.equal(calls, 0);
});
test("reconciliation is bounded, deduplicated, and returns only safe per-request state", async () => {
  const calls: string[] = [];
  const dependencies = {
    admin: async () => true,
    reconcile: async (value: string) => {
      calls.push(value);
      return "scheduled";
    },
  };
  const response = await handleBetaAdminReconcile(
    request([id, id]),
    dependencies,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    results: [{ id, status: "scheduled" }],
  });
  assert.deepEqual(calls, [id]);
  assert.equal(
    (await handleBetaAdminReconcile(request(Array(11).fill(id)), dependencies))
      .status,
    400,
  );
  assert.equal(
    (await handleBetaAdminReconcile(request(["bad"]), dependencies)).status,
    400,
  );
});
test("provider failure remains visible and does not swallow the whole refreshed roster", async () => {
  const response = await handleBetaAdminReconcile(request([id]), {
    admin: async () => true,
    reconcile: async () => {
      throw new Error("private provider error");
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: false,
    results: [{ id, status: "unknown" }],
  });
});
