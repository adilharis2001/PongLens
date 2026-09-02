import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  ADMIN_PAGES,
  ADMIN_WORKSPACES,
  hubDetail,
  type PortalCounts,
} from "./adminPageView.ts";

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

// Research and marketing are advertised nowhere else on purpose. The admin
// hub is the one door, and it is admin-only, so this reveals nothing to
// anyone who could not already open them.
test("the private workspaces are linked from the admin hub, and live outside /admin", () => {
  assert.deepEqual(
    ADMIN_WORKSPACES.map((w) => w.href),
    ["/research", "/marketing", "/testing"],
  );
  for (const workspace of ADMIN_WORKSPACES) {
    assert.doesNotMatch(workspace.href, /^\/admin/);
    assert.ok(workspace.title.length > 0);
  }
  const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  assert.match(page, /ADMIN_WORKSPACES\.map/);
  assert.match(page, /href=\{workspace\.href\}/);
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

// A due follow-up is a promise with a date on it, so it gets the accent;
// merely-new signups are information, not urgency.
test("the outreach card surfaces its queues, due follow-ups with urgency", () => {
  assert.deepEqual(
    hubDetail("outreach", COUNTS, null, { to_contact: 3, follow_ups_due: 0 }),
    { text: "3 to contact", attention: false }
  );
  assert.deepEqual(
    hubDetail("outreach", null, null, { to_contact: 2, follow_ups_due: 1 }),
    { text: "2 to contact · 1 follow-up due", attention: true }
  );
  assert.equal(
    hubDetail("outreach", COUNTS, null, { to_contact: 0, follow_ups_due: 0 }),
    null
  );
  assert.equal(hubDetail("outreach", COUNTS, null, null), null);
});
