/**
 * Which test cases a release needs re-run.
 *
 *   npm run qa:affected -- 67008811..HEAD
 *   npm run qa:affected                     (defaults to origin/main..HEAD)
 *
 * Walks the changed files through src/lib/qa/areaPaths.ts and prints the
 * cases for every area they touch. The every-release set is always
 * printed, because those run whatever the diff says.
 *
 * Output is meant to be pasted to whoever is testing, so it is plain text
 * with the case ids visible: those are what a bug report cites.
 */

import { execFileSync } from "node:child_process";

import { areasForPaths, unmappedPaths } from "../../src/lib/qa/areaPaths.ts";
import {
  AREA_TITLE,
  casesByArea,
  testCases,
  type TestArea,
} from "../../src/lib/qa/testLibrary.ts";

const range = process.argv[2] ?? "origin/main..HEAD";

let changed: string[];
try {
  changed = execFileSync("git", ["diff", "--name-only", range], {
    encoding: "utf8",
  })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
} catch {
  console.error(`Could not read a diff for "${range}".`);
  process.exit(1);
}

if (changed.length === 0) {
  console.log(`No files changed in ${range}.`);
  process.exit(0);
}

const areas = areasForPaths(changed);
const unmapped = unmappedPaths(changed);

const always = testCases.filter((c) => c.depth === "smoke");
const byChange = areas
  .flatMap((a) => casesByArea(a))
  .filter((c) => c.depth !== "smoke" && !c.blocked);

console.log(`\n${changed.length} file(s) changed in ${range}.`);
console.log(
  `Touched: ${areas.length ? areas.map((a) => AREA_TITLE[a]).join(", ") : "nothing the map knows about"}\n`,
);

console.log(`Every release (${always.length}), run these regardless:`);
for (const c of always) console.log(`  ${c.id.padEnd(34)}${c.title}`);

if (byChange.length) {
  console.log(`\nBecause of what changed (${byChange.length}):`);
  let current: TestArea | null = null;
  for (const c of byChange) {
    if (c.area !== current) {
      current = c.area;
      console.log(`\n  ${AREA_TITLE[c.area]}`);
    }
    console.log(`    ${c.id.padEnd(32)}${c.title}`);
  }
}

const blocked = areas
  .flatMap((a) => casesByArea(a))
  .filter((c) => c.blocked);
if (blocked.length) {
  console.log(`\nIn scope but still blocked (${blocked.length}):`);
  for (const c of blocked) console.log(`  ${c.id.padEnd(34)}${c.blocked}`);
}

if (unmapped.length) {
  // Never let a silent gap read as "nothing to re-test".
  console.log(
    `\n${unmapped.length} changed file(s) map to no area. Add them to AREA_PATHS if they should:`,
  );
  for (const p of unmapped.slice(0, 20)) console.log(`  ${p}`);
  if (unmapped.length > 20) console.log(`  and ${unmapped.length - 20} more`);
}

console.log(`\nTotal to run: ${always.length + byChange.length}\n`);
