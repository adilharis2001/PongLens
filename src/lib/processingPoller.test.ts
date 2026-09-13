import test from "node:test";
import assert from "node:assert/strict";
import { startProcessingPoller } from "./processingPoller.ts";

const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));
test("polling has no overlap, clears failed reads and recovers", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const seen: string[] = [];
  let finish: (v: string) => void = () => {};
  let calls = 0;
  const poll = startProcessingPoller({
    read: () => { calls++; return new Promise<string>((r) => { finish = r; }); },
    publish: (v) => seen.push(v), unknown: "unknown", visible: () => true,
  });
  poll.refresh();
  assert.equal(calls, 1);
  finish("unavailable"); await settle();
  assert.equal(seen.at(-1), "unavailable");
  t.mock.timers.tick(15_000);
  assert.equal(calls, 2);
  t.mock.timers.tick(8_000);
  assert.equal(seen.at(-1), "unknown");
  finish("unavailable"); await settle(); // aborted response cannot revive an outage
  assert.equal(seen.at(-1), "unknown");
  t.mock.timers.tick(7_000);
  finish("available"); await settle();
  assert.equal(seen.at(-1), "available");
  poll.stop();
});
test("background and stop invalidate in-flight responses; foreground refreshes immediately", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const pending: { resolve: (v: string) => void; signal: AbortSignal }[] = [];
  const seen: string[] = [];
  let visible = true;
  const poll = startProcessingPoller({
    read: (signal) => new Promise<string>((resolve) => pending.push({ resolve, signal })),
    publish: (v) => seen.push(v), unknown: "unknown", visible: () => visible,
  });
  visible = false; poll.invalidate();
  assert.equal(pending[0].signal.aborted, true);
  assert.equal(seen.at(-1), "unknown");
  visible = true; poll.invalidate();
  assert.equal(pending.length, 2);
  pending[0].resolve("unavailable"); await settle();
  assert.equal(seen.at(-1), "unknown");
  pending[1].resolve("available"); await settle();
  assert.equal(seen.at(-1), "available");
  poll.refresh(); poll.stop();
  pending[2].resolve("maintenance"); await settle();
  assert.equal(seen.at(-1), "available");
});
test("rejected reads clear old state and hidden pages do not poll", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const seen: string[] = [];
  let visible = false;
  let calls = 0;
  const poll = startProcessingPoller({
    read: async () => { calls++; throw new Error("offline"); },
    publish: (v) => seen.push(v), unknown: "unknown", visible: () => visible,
  });
  t.mock.timers.tick(30_000);
  assert.equal(calls, 0);
  visible = true; poll.invalidate(); await settle();
  assert.equal(calls, 1);
  assert.equal(seen.at(-1), "unknown");
  poll.stop();
});
