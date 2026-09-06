import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  createNotificationPoll,
  type PollPort,
  type Timers,
} from "./notificationPoll.ts";

type Row = { id: string; read_at: string | null };

/**
 * The two bugs these tests exist for both produced NO visible symptom: the
 * bell rendered an empty badge whether the read succeeded, was refused, or
 * ran twice. So the fakes count what the old code did silently — how many
 * times the server was asked, and how many timers were running.
 */
let asked: number;
let sessions: boolean;
let authListeners: ((signedIn: boolean) => void)[];
let rows: Row[];
let ticks: (() => void)[];

const port: PollPort<Row> = {
  hasSession: async () => sessions,
  fetch: async () => {
    asked++;
    return rows;
  },
  watchAuth: (onChange) => {
    authListeners.push(onChange);
    return () => {
      authListeners = authListeners.filter((l) => l !== onChange);
    };
  },
};

// A timer we drive by hand, so a "minute" costs nothing.
const timers: Timers = {
  set: (fn) => {
    ticks.push(fn);
    return ticks.length - 1;
  },
  clear: (h) => {
    ticks[h as number] = () => {};
  },
};

function make() {
  return createNotificationPoll(port, { timers, intervalMs: 60_000 });
}
const settle = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  asked = 0;
  sessions = true;
  authListeners = [];
  rows = [{ id: "a", read_at: null }];
  ticks = [];
});

test("signed out, the server is never asked", async () => {
  sessions = false;
  const poll = make();
  poll.subscribe(() => {});
  await settle();
  assert.equal(asked, 0, "a signed-out bell must make no request");
  assert.deepEqual(poll.getSnapshot(), [], "and shows an empty bell");

  // The old bug: the timer kept running and asked again, forever.
  ticks[0]();
  await settle();
  assert.equal(asked, 0, "still nothing a minute later");
});

test("signed in, the server is asked once per tick", async () => {
  const poll = make();
  poll.subscribe(() => {});
  await settle();
  assert.equal(asked, 1);
  ticks[0]();
  await settle();
  assert.equal(asked, 2);
});

test("two bells on one page share a single poll", async () => {
  const poll = make();
  // AppNav mounts the desktop header and the mobile header at once.
  const dropDesktop = poll.subscribe(() => {});
  const dropMobile = poll.subscribe(() => {});
  await settle();

  assert.equal(asked, 1, "two bells, one request");
  assert.equal(poll.timerCount(), 1, "two bells, one timer");

  ticks[0]();
  await settle();
  assert.equal(asked, 2, "and one request per minute, not two");

  // The first to unmount must not stop the one still on screen.
  dropDesktop();
  assert.equal(poll.timerCount(), 1, "the surviving bell keeps polling");
  dropMobile();
  assert.equal(poll.timerCount(), 0, "the last one out turns it off");
});

test("both bells read the same rows", async () => {
  const poll = make();
  let desktopRenders = 0;
  let mobileRenders = 0;
  poll.subscribe(() => desktopRenders++);
  poll.subscribe(() => mobileRenders++);
  await settle();

  poll.applyRead(["a"], "2026-09-04T00:00:00.000Z");
  assert.equal(poll.getSnapshot()?.[0].read_at, "2026-09-04T00:00:00.000Z");
  assert.ok(desktopRenders > 0 && mobileRenders > 0, "both are told");
});

test("signing out stops the asking immediately", async () => {
  const poll = make();
  poll.subscribe(() => {});
  await settle();
  assert.equal(asked, 1);

  sessions = false;
  authListeners.forEach((l) => l(false));
  await settle();
  assert.deepEqual(poll.getSnapshot(), [], "the bell empties");

  ticks[0]();
  await settle();
  assert.equal(asked, 1, "and the next tick asks for nothing");
});

test("signing back in fills the bell without waiting a minute", async () => {
  sessions = false;
  const poll = make();
  poll.subscribe(() => {});
  await settle();
  assert.equal(asked, 0);

  sessions = true;
  authListeners.forEach((l) => l(true));
  await settle();
  assert.equal(asked, 1, "asked on sign-in, not at the next tick");
});

test("a refused read leaves the last good rows alone", async () => {
  const poll = make();
  poll.subscribe(() => {});
  await settle();
  const good = poll.getSnapshot();
  assert.deepEqual(good, [{ id: "a", read_at: null }]);

  rows = null as unknown as Row[];
  ticks[0]();
  await settle();
  assert.deepEqual(poll.getSnapshot(), good, "a failed poll is not an empty bell");
});
