import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  AREA_PATHS,
  NO_SURFACE,
  areasForPaths,
  unmappedPaths,
} from "./areaPaths.ts";
import { TEST_AREAS, type TestArea } from "./testLibrary.ts";

const REPO = join(import.meta.dirname, "../../..");

test("every mapped path still exists", () => {
  // The failure this guards is the quiet one: a directory gets renamed,
  // the map keeps pointing at the old name, and qa:affected answers
  // confidently that a release touched nothing.
  for (const [area, prefixes] of Object.entries(AREA_PATHS)) {
    for (const prefix of prefixes) {
      assert.ok(
        existsSync(join(REPO, prefix)),
        `${area} maps to "${prefix}", which is not in the repo any more`,
      );
    }
  }
});

test("every area has at least one path", () => {
  for (const area of TEST_AREAS) {
    const prefixes = AREA_PATHS[area.key as TestArea];
    assert.ok(prefixes && prefixes.length > 0, `${area.key} maps to nothing`);
  }
});

test("a changed file selects the areas that render it", () => {
  // The match page renders scoring and placement, so touching it should
  // pull all three in rather than just the one whose folder it sits in.
  const areas = areasForPaths(["src/app/match/[id]/PointScorecard.tsx"]);
  assert.ok(areas.includes("match"));
  assert.ok(areas.includes("scoring"));

  assert.deepEqual(areasForPaths(["src/app/stats/page.tsx"]), ["stats"]);
  assert.deepEqual(areasForPaths([]), []);
});

test("prefixes match on a path boundary, not on characters", () => {
  // src/app/s is the share-link route. A bare startsWith swallows
  // src/app/stats and src/app/showcase with it, and a stats change then
  // reports sharing cases that have nothing to do with it.
  assert.ok(!areasForPaths(["src/app/stats/page.tsx"]).includes("sharing"));
  assert.ok(!areasForPaths(["src/app/showcase/page.tsx"]).includes("sharing"));
  assert.ok(areasForPaths(["src/app/s/[token]/page.tsx"]).includes("sharing"));

  // Same trap between /match and /matches, in the other direction: both
  // are the match area here, but only because both are mapped by name.
  assert.ok(areasForPaths(["src/app/matches/page.tsx"]).includes("match"));
});

test("the worker selects processing and email", () => {
  const areas = areasForPaths(["worker/worker.py"]);
  assert.ok(areas.includes("processing"));
  assert.ok(areas.includes("email"));
});

test("paths the map says nothing about are reported, not swallowed", () => {
  // Silence here would read as "nothing to re-test", which is the one
  // answer this tool must never give by accident.
  assert.deepEqual(
    unmappedPaths(["src/app/feedback/page.tsx", "src/app/stats/page.tsx"]),
    ["src/app/feedback/page.tsx"],
  );
});

test("surfaceless paths are quiet, so the warning keeps meaning something", () => {
  // The QA tooling, docs, config and admin pages have no cases by design.
  // Reporting them every release is how a warning gets ignored.
  assert.deepEqual(
    unmappedPaths([
      "docs/hiring/qa-engineer.md",
      "package.json",
      "src/app/testing/page.tsx",
      "src/lib/qa/csv.ts",
      "src/app/admin/adminPageView.ts",
      "src/lib/auth/paths.test.ts",
    ]),
    [],
  );

  // A migration stays loud: it reaches users through some area, and which
  // one is a judgement worth making each time.
  assert.deepEqual(unmappedPaths(["supabase/migrations/104_qa_bugs.sql"]), [
    "supabase/migrations/104_qa_bugs.sql",
  ]);
});

test("every surfaceless prefix still exists", () => {
  for (const prefix of NO_SURFACE) {
    assert.ok(
      existsSync(join(REPO, prefix)),
      `NO_SURFACE lists "${prefix}", which is not in the repo any more`,
    );
  }
});
