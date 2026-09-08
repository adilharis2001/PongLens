import assert from "node:assert/strict";
import test from "node:test";
import { handleBetaAdminSend } from "./adminAction.ts";
const id = "50aa4d45-9570-4d9b-90d6-79768994ce80";
function request(origin = "https://www.ponglens.com", method = "POST") {
  return new Request(
    "https://www.ponglens.com/api/admin/ios-beta/" + id + "/send",
    { method, headers: { origin } },
  );
}
test("only same-origin authenticated admins may bring forward a server-held invitation", async () => {
  let sent = 0;
  const deps = {
    async admin() {
      return { id: "actual-admin-id" };
    },
    async send(requestId: string, actor: string) {
      assert.equal(requestId, id);
      assert.equal(actor, "actual-admin-id");
      sent++;
      return "sending" as const;
    },
  };
  assert.equal(
    (await handleBetaAdminSend(request("https://attacker.example"), id, deps))
      .status,
    403,
  );
  assert.equal(
    (
      await handleBetaAdminSend(request(), id, {
        ...deps,
        async admin() {
          return null;
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (await handleBetaAdminSend(request(), "not-a-uuid", deps)).status,
    400,
  );
  assert.equal(sent, 0);
  const result = await handleBetaAdminSend(request(), id, deps);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true, status: "sending" });
  assert.equal(sent, 1);
});
test("admin action reports uncertain delivery without returning provider secrets", async () => {
  const result = await handleBetaAdminSend(request(), id, {
    async admin() {
      return { id: "admin" };
    },
    async send() {
      return "unknown";
    },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: false, status: "unknown" });
});

test("the original future schedule is not a successful send-now result", async () => {
  const result = await handleBetaAdminSend(request(), id, {
    async admin() { return { id: "admin" }; },
    async send() { return "scheduled"; },
  });
  assert.deepEqual(await result.json(), { ok: false, status: "scheduled" });
});
