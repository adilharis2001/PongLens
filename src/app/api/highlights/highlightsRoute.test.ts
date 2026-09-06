import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  new URL("./route.ts", import.meta.url),
  "utf8",
);
const worker = readFileSync(
  new URL("../../../../worker/worker.py", import.meta.url),
  "utf8",
);

test("highlight route is authenticated, owner-only, and switch guarded", () => {
  assert.match(route, /supabase\.auth\.getUser\(\)/);
  assert.match(route, /match\.user_id !== user\.id/);
  assert.match(route, /automatic_highlights/);
  assert.match(route, /createAdminClient\(\)/);
});

test("ready assets are prefix pinned and signed inline", () => {
  assert.match(route, /reels\/\$\{matchId\}-highlights-/);
  assert.match(route, /presignGet\(MEDIA_BUCKET, reel\.r2_key/);
  assert.match(route, /disposition: "inline"/);
});

test("stale or absent artifacts enqueue only the server-authoritative scope", () => {
  assert.match(route, /p_scope: "highlights"/);
  assert.match(route, /p_manifest: emptyManifest/);
  assert.doesNotMatch(route, /n_hits\s*>?=/);
  assert.doesNotMatch(route, /connected_crossings\s*>?=/);
});

test("the reel worker rebuilds automatic membership and uses its renderer", () => {
  assert.match(worker, /scope == "highlights"/);
  assert.match(worker, /build_manifest\(stored_points\)/);
  assert.match(worker, /render_auto_highlights\(/);
});
