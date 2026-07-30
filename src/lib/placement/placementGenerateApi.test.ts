import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../app/api/placement-generate/route.ts", import.meta.url),
  "utf8",
);

test("late generation route authenticates and delegates to the atomic RPC", () => {
  assert.match(source, /auth\.getUser\(\)/);
  assert.match(source, /request_placement_generation/);
  assert.match(source, /p_match_id: matchId/);
  assert.doesNotMatch(source, /\.from\\(["']matches["']\\).*\.update/s);
});
