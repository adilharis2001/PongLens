import assert from "node:assert/strict";
import test from "node:test";

test("publish and restore change the identity that owns all point and signed-media state", async () => {
  const api = await import("./activeVersion.ts").catch(() => assert.fail("Active-version refresh is missing"));
  assert.notEqual(api.activeMatchVersionKey("match", "old"), api.activeMatchVersionKey("match", "new"));
  assert.equal(api.activeMatchVersionKey("match", "old"), "match:old");
  assert.equal(api.shouldRefreshActiveVersion("old", "new"), true);
  assert.equal(api.shouldRefreshActiveVersion("new", "old"), true);
});

test("unrelated issue updates and legacy responses do not invalidate the current playhead", async () => {
  const api = await import("./activeVersion.ts").catch(() => assert.fail("Active-version refresh is missing"));
  assert.equal(api.shouldRefreshActiveVersion("old", "old"), false);
  assert.equal(api.shouldRefreshActiveVersion("old", undefined), false);
  assert.equal(api.shouldRefreshActiveVersion(null, null), false);
  assert.equal(api.shouldRefreshActiveVersion(null, "first"), true);
});

test("version-bound preview reports a stale conflict without returning mismatched media", async () => {
  const api = await import("./activeVersion.ts");
  const sent: unknown[] = [];
  const request = async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ error: "Match version changed", code: "active_version_changed" }, { status: 409 });
  };
  assert.deepEqual(await api.activeCutPreview("match", "old", request), { url: null, stale: true });
  assert.deepEqual(sent, [{ matchId: "match", preview: true, expectedVersionId: "old" }]);
  assert.deepEqual(await api.activeCutPreview("match", "new", async () => Response.json({ url: "https://signed.example/new" })), { url: "https://signed.example/new", stale: false });
  assert.deepEqual(await api.activeCutPreview("match", "new", async () => Response.json({ error: "Video not ready" }, { status: 409 })), { url: null, stale: false });
});
