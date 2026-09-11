import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as access from "./access.ts";
import * as endPolicy from "./endPolicy.ts";
import * as highlightShare from "../share/highlightShare.ts";

const route = readFileSync(
  new URL("./route.ts", import.meta.url),
  "utf8",
);
const worker = readFileSync(
  new URL("../../../../worker/worker.py", import.meta.url),
  "utf8",
);
const reelRoute = readFileSync(
  new URL("../reel/route.ts", import.meta.url),
  "utf8",
);

test("highlight route is authenticated, owner-only, availability guarded, and score gated", () => {
  assert.match(route, /supabase\.auth\.getUser\(\)/);
  assert.match(route, /match\.user_id !== user\.id/);
  assert.match(route, /highlights_enabled/);
  assert.doesNotMatch(route, /eq\("key", "automatic_highlights"\)/);
  assert.match(route, /createAdminClient\(\)/);
  assert.match(route, /highlight_generation_eligibility/);
  assert.match(route, /highlights_score_required/);
  assert.match(route, /scoredPoints/);
  assert.match(route, /scorablePoints/);
});

const matchId = "10000000-0000-4000-8000-000000000001";

function readyRoute(key: string) {
  const points = [{ id: "70000000-0000-4000-8000-000000000007", idx: 0, t0: 10, t1: 20,
    cut_t0: 1, rally_end_cut_s: 5, clip_path: "r2://media/clip.mp4", deleted: false, edited: false,
    is_let: false, confirmed_winner: "user", highlight_evidence: { v: 2, status: "ready", n_hits: 8, connected_crossings: 7,
      table_bounces: 4, alternating_table_landings: 5 } }];
  const manifest = { v: 2, rule: "quality-first-v2", points_revision: endPolicy.highlightPointsRevision(points),
    duration_s: 4.25, points: [{ point_id: points[0].id, cut_start_s: 1, cut_end_s: 5.25 }] };
  const signs: { bucket: string; key: string; options: unknown }[] = [];
  function query(data: unknown) {
    const result = { data, error: null };
    const q = { select: () => q, eq: () => q, maybeSingle: async () => result,
      then: (fulfilled: (value: typeof result) => unknown) => Promise.resolve(result).then(fulfilled) };
    return q;
  }
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/supabase/server": { createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
      from: (table: string) => {
        assert.ok(["matches", "match_reels", "points"].includes(table));
        return query(table === "matches" ? { id: matchId, user_id: "owner", cut_path: "cut", status: "ready" }
          : table === "match_reels" ? { status: "ready", r2_key: key, manifest } : points);
      },
    }) },
    "@/lib/supabase/admin": { createAdminClient: () => ({
      from: () => query({ value: "on" }),
      rpc: async () => ({ data: [{ scored_points: 1, scorable_points: 1,
        required_points: 1, required_percent: 75, eligible: true }], error: null }),
    }) },
    "@/lib/r2": { MEDIA_BUCKET: "media", presignGet: async (bucket: string, key: string, options: unknown) => {
      signs.push({ bucket, key, options }); return "https://signed.example/highlights.mp4";
    } },
    "./access": access,
    "./endPolicy": endPolicy,
    "../share/highlightShare": highlightShare,
  };
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  const compiled = ts.transpileModule(route, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  new Function("require", "exports", compiled.outputText)((name: string) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, exports);
  return { signs, get: () => exports.GET!(new Request(`https://ponglens.test/api/highlights?matchId=${matchId}`)) };
}

test("ready legacy and versioned highlight attempts are signed inline", async () => {
  for (const suffix of [
    "highlights-abcdef0123456789.mp4",
    "v-40000000-0000-4000-8000-000000000004-highlights-abcdef0123456789-0123456789abcdef0123456789abcdef.mp4",
    "v-4000000000004000-highlights-abcdef0123456789-0123456789abcdef0123456789abcdef.mp4",
  ]) {
    const key = `reels/${matchId}-${suffix}`;
    const handler = readyRoute(key);
    const response = await handler.get();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "ready", key);
    assert.deepEqual(handler.signs, [{ bucket: "media", key, options: { expiresSeconds: 6 * 3600, disposition: "inline" } }]);
  }
});

test("ready highlights never sign another match or an unrelated artifact", async () => {
  for (const key of [
    "reels/20000000-0000-4000-8000-000000000002-highlights-abcdef0123456789.mp4",
    "reels/20000000-0000-4000-8000-000000000002-v-4000000000004000-highlights-abcdef0123456789-0123456789abcdef0123456789abcdef.mp4",
    `reels/${matchId}-full.mp4`,
  ]) {
    const handler = readyRoute(key);
    assert.equal((await (await handler.get()).json()).status, "needs_update");
    assert.deepEqual(handler.signs, []);
  }
});

test("opening highlights never enqueues work; every missing or stale artifact requires POST", () => {
  const getHandler = route.slice(0, route.indexOf("export async function POST"));
  assert.match(route, /p_scope: "highlights"/);
  assert.doesNotMatch(getHandler, /enqueue_reel/);
  assert.match(route, /export async function POST/);
  assert.match(route, /refresh_evidence: true/);
  assert.match(route, /highlightManifestIsFresh\(/);
  assert.doesNotMatch(route, /n_hits\s*>?=/);
  assert.doesNotMatch(route, /connected_crossings\s*>?=/);
});

test("the reel worker rebuilds automatic membership and uses its renderer", () => {
  assert.match(worker, /scope == "highlights"/);
  assert.match(worker, /build_manifest\(points\)/);
  assert.match(worker, /highlight_revision_is_current\(/);
  assert.match(worker, /_mark_reel_failed\(/);
  assert.match(worker, /except HighlightRefreshObsoleteError/);
  assert.match(worker, /archive_message\(conn, msg\["msg_id"\]\)/);
  assert.match(worker, /render_auto_highlights\(/);
});

test("legacy vertical derivatives use only the canonical qualified pool", () => {
  assert.match(reelRoute, /eq\("scope", "highlights"\)/);
  assert.match(reelRoute, /canonicalHighlightPoints\(automatic\?\.manifest\)/);
  assert.doesNotMatch(reelRoute, /pickHighlights/);
  assert.doesNotMatch(reelRoute, /MIN_HITS|MIN_CROSSINGS|MIN_TABLE_BOUNCES/);
});
