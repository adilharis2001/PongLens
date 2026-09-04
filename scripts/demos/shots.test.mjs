import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("the showcase capture catalog includes every desktop coach video screen", () => {
  const result = spawnSync(process.execPath, ["scripts/demos/shots.mjs", "--list"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const names = result.stdout.trim().split("\n");
  for (const expected of [
    "coach-students-d",
    "coach-entry-compose-d",
    "coach-entry-shared-d",
    "coach-order-d",
    "coach-payout-d",
  ]) {
    assert.ok(names.includes(expected), `missing capture spec: ${expected}`);
  }
});
