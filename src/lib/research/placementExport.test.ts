import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("placement export exposes latest analysis labels without blind snapshots", () => {
  const route = readFileSync(
    new URL(
      "../../app/api/research/placement-export/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(route, /analysis_label/);
  assert.doesNotMatch(route, /human_label:\\s*row\\.human_label/);
  assert.doesNotMatch(route, /blind_snapshot/);
});
