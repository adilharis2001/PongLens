import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CAMERA_GUIDE_MAX_SHOWINGS,
  cameraGuideGate,
  cameraGuideStorageKey,
  readSeenCount,
} from "./cameraGuideGate.ts";

/**
 * The cases are not written here. They live in one JSON table that
 * CameraGuideGateTests.swift reads too, so the web rule and the iOS rule
 * are compared against the same answers rather than each being read
 * against the same paragraph — which is how the placement mirror survived
 * eight months in two files at once.
 */
const TABLE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../ios/Tests/fixtures/camera-guide-gate.json", import.meta.url)),
    "utf8",
  ),
) as {
  readSeenCount: {
    name: string;
    account: unknown;
    device: unknown;
    expected: number | null;
  }[];
  gate: {
    name: string;
    seen: number | null;
    hasAnyMatch: boolean;
    shownThisSession: boolean;
    show: boolean;
    persist: number | null;
  }[];
};

test("the two copies of the count are read as one", () => {
  assert.ok(TABLE.readSeenCount.length > 0, "the fixture is not empty");
  for (const c of TABLE.readSeenCount) {
    assert.equal(readSeenCount(c.account, c.device), c.expected, c.name);
  }
});

test("the gate agrees with the shared table", () => {
  assert.ok(TABLE.gate.length > 0, "the fixture is not empty");
  for (const c of TABLE.gate) {
    const got = cameraGuideGate({
      seen: c.seen,
      hasAnyMatch: c.hasAnyMatch,
      shownThisSession: c.shownThisSession,
    });
    assert.deepEqual(got, { show: c.show, persist: c.persist }, c.name);
  }
});

test("two showings, and the count is what stops the third", () => {
  // Walking the real sequence rather than asserting one row at a time:
  // the failure that matters is a counter that never advances, and a
  // per-case check cannot see it.
  let seen: number | null = null;
  let shown = 0;
  for (let launch = 0; launch < 6; launch++) {
    const d = cameraGuideGate({ seen, hasAnyMatch: false, shownThisSession: false });
    if (d.show) shown++;
    if (d.persist !== null) seen = d.persist;
  }
  assert.equal(shown, CAMERA_GUIDE_MAX_SHOWINGS);
  assert.equal(seen, CAMERA_GUIDE_MAX_SHOWINGS);
});

test("a failed account write cannot buy a third showing", () => {
  // The sports-hall case. Supabase never accepts anything; only the device
  // copy advances. The cap has to hold on that alone.
  let device: string | null = null;
  let shown = 0;
  for (let launch = 0; launch < 6; launch++) {
    const seen = readSeenCount(null, device);
    const d = cameraGuideGate({ seen, hasAnyMatch: false, shownThisSession: false });
    if (d.show) shown++;
    if (d.persist !== null) device = String(d.persist); // localStorage holds strings
  }
  assert.equal(shown, CAMERA_GUIDE_MAX_SHOWINGS);
});

test("one launch cannot spend both showings", () => {
  // Record, then practice, then upload, all without quitting the app.
  let seen: number | null = null;
  let shownThisSession = false;
  let shown = 0;
  for (const _door of ["record", "practice", "upload"]) {
    const d = cameraGuideGate({ seen, hasAnyMatch: false, shownThisSession });
    if (d.show) {
      shown++;
      shownThisSession = true;
    }
    if (d.persist !== null) seen = d.persist;
  }
  assert.equal(shown, 1);
  assert.equal(seen, 1, "the second showing is still owed");
});

test("the device key is per account", () => {
  // One simulator and one browser get shared between accounts, so a key
  // without the user id caps the wrong person.
  assert.notEqual(cameraGuideStorageKey("a"), cameraGuideStorageKey("b"));
  assert.match(cameraGuideStorageKey("abc"), /abc$/);
});
