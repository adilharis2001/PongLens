import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  LEGACY_PENDING_KEY,
  MAX_PENDING,
  PENDING_KEY,
  PENDING_MAX_AGE,
  PENDING_OWNER_TTL,
  clearPending,
  heldElsewhere,
  readAllPending,
  readPending,
  tabId,
  updatePending,
  writePending,
  type PendingUpload,
} from "./pendingUploads.ts";

/**
 * Two tabs of the same browser share one localStorage and have their own
 * sessionStorage. That pairing is the whole subject of these tests, so the
 * fakes model it exactly: one store for the "browser", a swappable one for
 * "the tab that is running right now".
 */
class Store {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const browser = new Store();
const tabs: Record<string, Store> = { a: new Store(), b: new Store() };

function inTab(name: "a" | "b") {
  (globalThis as { sessionStorage?: Store }).sessionStorage = tabs[name];
}

beforeEach(() => {
  browser.map.clear();
  tabs.a = new Store();
  tabs.b = new Store();
  (globalThis as { localStorage?: Store }).localStorage = browser;
  inTab("a");
});

function rec(over: Partial<PendingUpload<string>> = {}): PendingUpload<string> {
  return {
    bucket: "ponglens-raw",
    key: "user/one.mp4",
    uploadId: "upload-1",
    name: "one.mp4",
    size: 1000,
    contentType: "video/mp4",
    startedAt: Date.now(),
    form: "answers",
    ...over,
  };
}

test("a tab reads back the upload it started", () => {
  writePending(rec());
  const got = readPending<string>();
  assert.equal(got?.key, "user/one.mp4");
  assert.equal(got?.owner, tabId());
  assert.equal(got?.form, "answers");
});

test("a second tab does not see the first tab's live upload", () => {
  inTab("a");
  writePending(rec());

  inTab("b");
  assert.equal(readPending(), null, "tab B must start its own upload");
  // The record is still there — tab B simply may not have it.
  assert.equal(readAllPending().length, 1);
});

test("two tabs uploading at once keep both records", () => {
  inTab("a");
  writePending(rec({ key: "user/one.mp4", uploadId: "upload-1" }));
  inTab("b");
  writePending(
    rec({ key: "user/two.mp4", uploadId: "upload-2", name: "two.mp4" })
  );

  const all = readAllPending();
  assert.equal(all.length, 2);
  // Each tab still resumes its own, not the other's.
  inTab("a");
  assert.equal(readPending()?.key, "user/one.mp4");
  inTab("b");
  assert.equal(readPending()?.key, "user/two.mp4");
});

test("an upload whose tab stopped beating can be picked up", () => {
  inTab("a");
  writePending(rec());
  // Tab A is gone: age its heartbeat past the window.
  const stale = readAllPending<string>().map((r) => ({
    ...r,
    beatAt: Date.now() - PENDING_OWNER_TTL - 1,
  }));
  browser.setItem(PENDING_KEY, JSON.stringify(stale));

  inTab("b");
  assert.equal(readPending()?.key, "user/one.mp4");
});

test("heartbeat keeps an upload out of another tab's reach", () => {
  inTab("a");
  writePending(rec());
  const aged = readAllPending<string>().map((r) => ({
    ...r,
    beatAt: Date.now() - PENDING_OWNER_TTL - 1,
  }));
  browser.setItem(PENDING_KEY, JSON.stringify(aged));

  inTab("a");
  updatePending("user/one.mp4", {}); // the beat
  inTab("b");
  assert.equal(readPending(), null);
});

test("a record with no owner is free to anyone", () => {
  browser.setItem(PENDING_KEY, JSON.stringify([rec({ owner: undefined })]));
  inTab("b");
  assert.equal(readPending()?.key, "user/one.mp4");
  assert.equal(heldElsewhere(rec({ owner: undefined })), false);
});

test("clearing one upload leaves the others alone", () => {
  inTab("a");
  writePending(rec({ key: "user/one.mp4", uploadId: "upload-1" }));
  writePending(rec({ key: "user/two.mp4", uploadId: "upload-2" }));
  clearPending("user/one.mp4");

  const left = readAllPending();
  assert.equal(left.length, 1);
  assert.equal(left[0].key, "user/two.mp4");
});

test("clearing with no key changes nothing", () => {
  writePending(rec());
  clearPending(undefined);
  assert.equal(readAllPending().length, 1);
});

test("updating addresses one record by key", () => {
  writePending(rec({ key: "user/one.mp4", uploadId: "upload-1" }));
  writePending(rec({ key: "user/two.mp4", uploadId: "upload-2" }));
  updatePending("user/two.mp4", { bytesUploaded: 512 });

  const all = readAllPending();
  assert.equal(all.find((r) => r.key === "user/two.mp4")?.bytesUploaded, 512);
  assert.equal(
    all.find((r) => r.key === "user/one.mp4")?.bytesUploaded,
    undefined
  );
});

test("updating a record that is already gone is a no-op", () => {
  updatePending("user/never.mp4", { bytesUploaded: 1 });
  assert.equal(readAllPending().length, 0);
});

test("expired records are dropped on read", () => {
  browser.setItem(
    PENDING_KEY,
    JSON.stringify([
      rec({ key: "user/old.mp4", startedAt: Date.now() - PENDING_MAX_AGE - 1 }),
      rec({ key: "user/new.mp4" }),
    ])
  );
  const all = readAllPending();
  assert.equal(all.length, 1);
  assert.equal(all[0].key, "user/new.mp4");
});

test("the single-record key from before is carried over once", () => {
  browser.setItem(LEGACY_PENDING_KEY, JSON.stringify(rec()));
  assert.equal(readPending()?.key, "user/one.mp4");
  assert.equal(browser.getItem(LEGACY_PENDING_KEY), null);
  // And it survives as a normal record.
  assert.equal(readAllPending().length, 1);
});

test("the list stays bounded", () => {
  for (let i = 0; i < MAX_PENDING + 3; i++) {
    writePending(rec({ key: `user/${i}.mp4`, uploadId: `upload-${i}` }));
  }
  assert.equal(readAllPending().length, MAX_PENDING);
});

test("junk in localStorage reads as empty rather than throwing", () => {
  browser.setItem(PENDING_KEY, "{not json");
  assert.deepEqual(readAllPending(), []);
  browser.setItem(PENDING_KEY, JSON.stringify({ key: "not-a-list" }));
  assert.deepEqual(readAllPending(), []);
});

test("newest first", () => {
  const now = Date.now();
  browser.setItem(
    PENDING_KEY,
    JSON.stringify([
      rec({ key: "user/older.mp4", startedAt: now - 5000 }),
      rec({ key: "user/newer.mp4", startedAt: now }),
    ])
  );
  assert.equal(readAllPending()[0].key, "user/newer.mp4");
});
