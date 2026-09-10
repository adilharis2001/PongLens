import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  canEndAccess,
  canSendInvite,
  coachAccessLine,
  coachStandingWords,
  coachingTabDoor,
  duplicateNotice,
  endAccessConfirm,
  invitesWaitingLabel,
  inviteWaitingLine,
  removeConfirm,
  restoreNotice,
  type CoachListState,
} from "./coachActions.ts";
import type { PlayerCoach, PlayerCoachStatus } from "./playerCoaches.ts";

/**
 * The web half of the coach-action rules, checked against the same JSON table
 * the phone reads. Neither side produces the table; it is the spec written
 * down once, so that comparing two ports cannot degenerate into reading the
 * same paragraph twice and making the same mistake twice.
 */
const TABLE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../ios/Tests/fixtures/coach-actions.json", import.meta.url),
    ),
    "utf8",
  ),
);

function row(partial: Partial<PlayerCoach> & { status: PlayerCoachStatus }): PlayerCoach {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    coach_id: null,
    display_name: "Coach",
    coach_email: null,
    invite_id: null,
    entry_count: 0,
    shared_count: 0,
    ...partial,
  };
}

test("the door onto the coaches list", () => {
  assert.ok(TABLE.tabDoor.length > 0, "the fixture is not empty");
  for (const c of TABLE.tabDoor) {
    assert.equal(
      coachingTabDoor(c.coaches, c.pending, c.state as CoachListState),
      c.expected,
      c.name,
    );
  }
});

test("how many invites are waiting", () => {
  for (const c of TABLE.invitesWaiting) {
    assert.equal(invitesWaitingLabel(c.n), c.expected);
  }
});

test("who can be sent an invite", () => {
  for (const c of TABLE.canSendInvite) {
    assert.equal(
      canSendInvite(row({ status: c.status })),
      c.expected,
      c.status,
    );
  }
});

test("whose access can be ended", () => {
  for (const c of TABLE.canEndAccess) {
    assert.equal(canEndAccess(row({ status: c.status })), c.expected, c.status);
  }
});

test("the standing, in words", () => {
  for (const c of TABLE.standingWords) {
    assert.equal(coachStandingWords(c.status), c.expected, c.status);
  }
});

test("the line under the name", () => {
  for (const c of TABLE.accessLine) {
    assert.equal(
      coachAccessLine(
        row({
          status: c.status,
          coach_id: c.hasAccount ? "33333333-3333-4333-8333-333333333333" : null,
        }),
        c.access,
      ),
      c.expected,
      c.name,
    );
  }
});

test("recognising a name already on the list", () => {
  assert.ok(TABLE.duplicateNotice.length > 0, "the fixture is not empty");
  for (const c of TABLE.duplicateNotice) {
    const got = duplicateNotice(c.rows as PlayerCoach[], c.typed);
    if (c.expected === null) {
      assert.equal(got, null, c.name);
      continue;
    }
    assert.ok(got, c.name);
    assert.equal(got.line, c.expected.line, c.name);
    assert.equal(got.action, c.expected.action, c.name);
  }
});

test("what removing a coach asks", () => {
  for (const c of TABLE.removeConfirm) {
    const got = removeConfirm(
      row({ status: c.status, display_name: c.name }),
    );
    assert.deepEqual(
      { title: got.title, body: got.body, confirmLabel: got.confirmLabel },
      c.expected,
      c.status,
    );
  }
});

test("what ending access asks", () => {
  for (const c of TABLE.endAccessConfirm) {
    const got = endAccessConfirm(
      row({ status: "connected", display_name: c.name }),
    );
    assert.deepEqual(
      { title: got.title, body: got.body, confirmLabel: got.confirmLabel },
      c.expected,
    );
  }
});

test("what a restored coach is told", () => {
  for (const c of TABLE.restoreNotice) {
    assert.equal(restoreNotice(c.status), c.expected, c.status);
  }
});

test("the sentence under an invite link", () => {
  for (const c of TABLE.inviteWaitingLine) {
    assert.equal(inviteWaitingLine(c.revokeIsHere), c.expected);
  }
});
