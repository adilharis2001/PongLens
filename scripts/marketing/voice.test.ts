import assert from "node:assert/strict";
import test from "node:test";
import {
  FAMOUS_FOLLOWERS,
  cleanVoice,
  displayName,
  draftMessage,
  opener,
  voiceProblems,
} from "./voice.mjs";

const coach = (over = {}) => ({
  handle: "mhtabletennis",
  full_name: "Matt Hetherington",
  followers: 112897,
  entity_type: "coach",
  ...over,
});

test("the cleanup turns every dash into a comma and opens lowercase", () => {
  assert.equal(cleanVoice("Hey there"), "hey there");
  assert.equal(cleanVoice("i built this — it works"), "i built this, it works");
  assert.equal(cleanVoice("a – b"), "a, b");
  assert.equal(cleanVoice("a -- b"), "a, b");
  // A dash right before a full stop must not leave a stranded comma.
  assert.equal(cleanVoice("done — ."), "done.");
  assert.equal(cleanVoice(""), "");
});

test("the tells that were rejected by name cannot survive a draft", () => {
  for (const bad of [
    "no pitch, i just want a real opinion",
    "quick question if you don't mind",
    "this is a game changer",
    "let's circle back",
    "the vibe is good",
  ]) {
    assert.ok(voiceProblems(bad).length > 0, bad);
  }
  assert.deepEqual(voiceProblems("hey, i built a thing. have a look."), []);
});

test("more than two paragraphs is a problem, because that is the tell", () => {
  assert.deepEqual(voiceProblems("one\n\ntwo"), []);
  assert.match(
    voiceProblems("one\n\ntwo\n\nthree\n\nfour").join(" "),
    /4 paragraphs/,
  );
});

test("a dash or the word AI never leaves the building", () => {
  assert.match(voiceProblems("built with AI").join(" "), /says AI/);
  assert.match(voiceProblems("a — b").join(" "), /contains a dash/);
});

test("the opener only claims a history when there plausibly is one", () => {
  assert.match(opener(coach({ followers: 112_897 })), /following your breakdowns/);
  // Two thousand followers means he just found them, and they know it.
  assert.match(opener(coach({ followers: 2_000 })), /came across your account/);
  assert.doesNotMatch(opener(coach({ followers: 2_000 })), /following your/);
  assert.equal(FAMOUS_FOLLOWERS > 2_000, true);
});

test("the opener names the person, not their whole title", () => {
  assert.match(
    opener(coach({ full_name: "Craig Bryant - Table Tennis Coach | Serve Specialist" })),
    /^hey Craig,/,
  );
  assert.equal(displayName(coach({ full_name: "Tatiana Garnova | TABLE TENNIS Coach" })), "Tatiana");
  assert.equal(displayName(coach({ full_name: "Mario Alvarez- Las Vegas' Top Coach" })), "Mario");
});

test("a club is greeted by its whole name, not its first word", () => {
  const club = (full_name: string) =>
    displayName(coach({ entity_type: "club", full_name }));
  // "hey 888," was what the first version produced.
  assert.equal(club("888 Table Tennis Center 🏓"), "888 Table Tennis Center");
  assert.equal(club("HiTT Table Tennis Academy"), "HiTT Table Tennis Academy");
  assert.equal(club("Sharp Shot Academy"), "Sharp Shot Academy");
  assert.match(
    opener(coach({ entity_type: "club", full_name: "888 Table Tennis Center 🏓" })),
    /^hey 888 Table Tennis Center, came across your page/,
  );
});

test("no usable name means no name, never a handle or a job title", () => {
  // "hey pingpongcoach38" announces that a script wrote it.
  assert.equal(displayName(coach({ full_name: null, handle: "pingpongcoach38" })), null);
  assert.equal(displayName(coach({ full_name: "   ", handle: "x" })), null);
  assert.equal(displayName(coach({ full_name: "🏓🏓", handle: "x" })), null);
  // "hey Coach," reads as a mailshot, and "Coach V" has no name behind it.
  assert.equal(displayName(coach({ full_name: "Coach V" })), null);
  assert.equal(displayName(coach({ full_name: "Coach Cheung" })), "Cheung");
  assert.match(
    opener(coach({ full_name: null, handle: "pingpongcoach38", followers: 900 })),
    /^hey, came across your account/,
  );
  assert.match(
    opener(coach({ full_name: null, handle: "pingpongcoach38" })),
    /^hey, i came across your channel/,
  );
  assert.doesNotMatch(draftMessage(coach({ full_name: null, handle: "x_37" })), /x_37/);
});

test("a club and a pro get their own opener and their own ask", () => {
  assert.match(opener(coach({ entity_type: "club", full_name: "Jaipur Academy" })), /clubs and academies/);
  assert.match(opener(coach({ entity_type: "pro", full_name: "Timo Boll" })), /coaching page/);

  const club = draftMessage(coach({ entity_type: "club", full_name: "Jaipur Academy" }));
  assert.match(club, /club setup/);
  assert.match(club, /isn't built yet/);

  const pro = draftMessage(coach({ entity_type: "pro", full_name: "Timo Boll" }));
  // Offering review income to a well known player reads as not knowing them.
  assert.doesNotMatch(pro, /earn from the professional reviews/);
  assert.match(pro, /whether the analysis part holds up/);
});

test("every draft is two paragraphs, in his voice, with no link", () => {
  for (const kind of ["coach", "club", "pro"]) {
    for (const followers of [500, 112_897]) {
      const message = draftMessage(coach({ entity_type: kind, followers }));
      assert.deepEqual(voiceProblems(message), [], `${kind}/${followers}`);
      assert.equal(message.trim().split(/\n\s*\n/).length, 2);
      assert.equal(message[0], message[0].toLowerCase());
      // A link is what gets a first message filtered, so there is not one.
      assert.doesNotMatch(message, /https?:\/\/|ponglens\.com|www\./);
    }
  }
});

test("the coach draft carries the two things he asked to be in it", () => {
  const message = draftMessage(coach());
  assert.match(message, /earn from the professional reviews/);
  assert.match(message, /honest feedback is what i'm after most/);
  // And the thing he asked to be added last: quick scoring.
  assert.match(message, /score a match in about ten minutes/);
});
