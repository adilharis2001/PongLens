import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const oldVersion = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const newVersion = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function route() {
  let active = oldVersion;
  const signs: string[] = [];
  const source = readFileSync(new URL("../../app/api/media-url/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const exports: { POST?: (req: Request) => Promise<Response> } = {};
  const deps: Record<string, unknown> = {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/supabase/server": { createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
      from: (table: string) => {
        assert.equal(table, "matches");
        const query = { select: () => query, eq: () => query, single: async () => ({ data: {
          id: "match", user_id: "owner", status: "ready", active_processing_version_id: active,
          cut_path: `r2://ponglens-media/${active}.mp4`,
        }, error: null }) };
        return query;
      },
    }) },
    "@/lib/r2": { presignGet: async (_bucket: string, key: string) => { signs.push(key); return `https://signed.example/${key}`; } },
  };
  new Function("require", "exports", compiled.outputText)((name: string) => {
    if (!(name in deps)) throw new Error(name);
    return deps[name];
  }, exports);
  return { signs, publish: () => { active = newVersion; }, restore: () => { active = oldVersion; },
    call: (expectedVersionId?: unknown) => exports.POST!(new Request("https://ponglens.test/api/media-url", {
      method: "POST", body: JSON.stringify({ matchId: "match", preview: true, expectedVersionId }),
    })) };
}

test("publish between point read and cut signing refuses stale identity; canonical retry signs the new cut", async () => {
  const boundary = route();
  // The page has already read oldVersion and its points.
  boundary.publish();
  const stale = await boundary.call(oldVersion);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "active_version_changed");
  assert.deepEqual(boundary.signs, [], "never sign the new cut for old point state");
  const current = await boundary.call(newVersion);
  assert.equal(current.status, 200);
  assert.deepEqual(boundary.signs, [`${newVersion}.mp4`]);
  boundary.restore();
  assert.equal((await boundary.call(newVersion)).status, 409);
  assert.equal((await boundary.call(oldVersion)).status, 200);
  assert.deepEqual(boundary.signs, [`${newVersion}.mp4`, `${oldVersion}.mp4`]);
});

test("expected cut identity is strictly validated; older unversioned callers remain compatible", async () => {
  for (const value of ["bad", 1, [oldVersion], { id: oldVersion }]) {
    const boundary = route();
    assert.equal((await boundary.call(value)).status, 400);
    assert.deepEqual(boundary.signs, []);
  }
  const boundary = route();
  assert.equal((await boundary.call()).status, 200);
  assert.equal((await boundary.call(null)).status, 409, "an explicit legacy expectation must not sign a newer version");
});
