import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_PAGES, hubDetail, type PortalCounts } from "./adminPageView.ts";

const COUNTS: PortalCounts = {
  quota_requests: 1,
  players: 7,
  matches: 33,
};

test("every admin page has a distinct route under /admin", () => {
  const hrefs = ADMIN_PAGES.map((p) => p.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
  for (const href of hrefs) {
    assert.match(href, /^\/admin\/[a-z]+$/);
  }
});

test("pending requests surface on the hub", () => {
  assert.deepEqual(hubDetail("storage", COUNTS), {
    text: "1 request waiting",
    attention: true,
  });
  assert.deepEqual(hubDetail("storage", { ...COUNTS, quota_requests: 2 }), {
    text: "2 requests waiting",
    attention: true,
  });
});

test("cards stay quiet when there is nothing to do", () => {
  const idle = { ...COUNTS, quota_requests: 0 };
  assert.equal(hubDetail("storage", idle), null);
  assert.equal(hubDetail("costs", COUNTS), null);
});

test("players card carries the headline counts without urgency", () => {
  assert.deepEqual(hubDetail("players", COUNTS), {
    text: "7 players · 33 matches",
    attention: false,
  });
});

test("counts that failed to load leave the cards bare", () => {
  for (const page of ADMIN_PAGES) {
    assert.equal(hubDetail(page.key, null), null);
  }
});

test("the backlog card counts open items, and stays quiet when empty", () => {
  assert.deepEqual(hubDetail("backlog", COUNTS, 6), {
    text: "6 open",
    attention: false,
  });
  assert.equal(hubDetail("backlog", COUNTS, 0), null);
  assert.equal(hubDetail("backlog", COUNTS, null), null);
});

// The two numbers come from different queries. Either one failing must
// leave the other card intact.
test("the backlog count survives a failed portal-counts load", () => {
  assert.deepEqual(hubDetail("backlog", null, 3), {
    text: "3 open",
    attention: false,
  });
});
