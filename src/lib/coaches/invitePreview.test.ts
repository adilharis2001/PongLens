import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERIC_INVITE,
  coachInvitePreview,
  studentInvitePreview,
} from "./invitePreview.ts";

test("the headline is the invite page's own sentence", () => {
  // Somebody who taps through must find the sentence they were shown.
  assert.equal(
    coachInvitePreview({
      inviterName: "Adil Haris",
      invitedName: null,
      scope: "selected",
    }).headline,
    "Adil Haris added you as their coach",
  );
  assert.equal(
    coachInvitePreview({
      inviterName: "Adil Haris",
      invitedName: null,
      scope: "all",
    }).headline,
    "Adil Haris shared their matches with you",
  );
  assert.equal(
    coachInvitePreview({
      inviterName: "Adil Haris",
      invitedName: null,
      scope: "match",
    }).headline,
    "Adil Haris shared a match with you",
  );
});

test("a named invite opens with the coach's name", () => {
  const copy = coachInvitePreview({
    inviterName: "Adil Haris",
    invitedName: "Jonotan",
    scope: "selected",
  });
  assert.equal(copy.eyebrow, "Jonotan");
  assert.equal(copy.title, "Jonotan, Adil Haris added you as their coach");
});

test("the inviter's name keeps its capital after the comma", () => {
  // "Jonotan, adil Haris…" would be worse than not personalising at all.
  const copy = coachInvitePreview({
    inviterName: "Adil Haris",
    invitedName: "Jonotan",
    scope: "all",
  });
  assert.match(copy.title, /, Adil Haris shared/);
});

test("a coach inviting a student reads from the other side", () => {
  const copy = studentInvitePreview({
    inviterName: "Miguel Santos",
    invitedName: "Larry",
  });
  assert.equal(copy.headline, "Miguel Santos invited you as their student");
  assert.equal(copy.title, "Larry, Miguel Santos invited you as their student");
  assert.equal(copy.detail, "Your matches and their lesson notes, in one place.");
});

test("a missing name never renders as empty punctuation", () => {
  for (const invitedName of [null, "", "   "]) {
    const copy = coachInvitePreview({
      inviterName: "Adil Haris",
      invitedName,
      scope: "selected",
    });
    assert.equal(copy.eyebrow, null);
    assert.doesNotMatch(copy.title, /^,|,\s*$/);
    assert.equal(copy.title, copy.headline);
  }
});

test("an inviter with no name at all still makes a sentence", () => {
  assert.equal(
    coachInvitePreview({ inviterName: "  ", invitedName: null, scope: "all" })
      .headline,
    "A player shared their matches with you",
  );
  assert.equal(
    studentInvitePreview({ inviterName: "", invitedName: null }).headline,
    "A coach invited you as their student",
  );
});

test("a spent link says nothing about anybody", () => {
  assert.equal(GENERIC_INVITE.eyebrow, null);
  assert.doesNotMatch(GENERIC_INVITE.headline, /Adil|Haris|Jonotan/);
});
