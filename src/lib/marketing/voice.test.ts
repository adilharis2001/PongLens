import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanVoice,
  firstMessage,
  followUpMessage,
  greeting,
  messageFor,
  secondMessage,
  voiceProblems,
  type VoiceCoach,
} from "./voice.ts";

const coach = (over: Record<string, unknown> = {}): VoiceCoach => ({
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

test("the greeting names them, or greets them without a name", () => {
  assert.equal(greeting(coach({ full_name: "Craig Bryant | Table Tennis Coach" })), "hey Craig,");
  assert.equal(greeting(coach({ entity_type: "club", full_name: "888 Table Tennis Center 🏓" })), "hey 888 Table Tennis Center,");
  assert.equal(greeting(coach({ full_name: null })), "hey,");
  assert.equal(greeting(coach({ full_name: "Coach V" })), "hey,");
});

test("the first message asks permission and sells nothing", () => {
  const m = firstMessage(coach());
  assert.match(m, /would you mind if i sent you what i'm building\?/);
  // It names the category. "something i'm building" makes a coach work out
  // whether it is worth their attention; this tells them in three words.
  assert.match(m, /a match analysis tool called PongLens/);
  assert.doesNotMatch(m, /something called PongLens/);
  // And it says what he wants back, which is what makes permission worth
  // granting rather than a question left hanging.
  assert.match(m, /i'd love to get your feedback on it\.$/);
  // The sport is established by the first clause; saying it twice is padding.
  assert.equal((m.match(/table tennis/gi) ?? []).length, 1);
  // No pitch, no features, no link, no calendar. Its job is a reply.
  assert.doesNotMatch(m, /https?:\/\/|ponglens\.com/);
  assert.doesNotMatch(m, /point by point|heat map|placement map|score a match/i);
  // Word boundaries: "called PongLens" is not a request for a call.
  assert.doesNotMatch(m, /\b(call|demo|chat|meeting)\b|15 minutes/i);
  assert.ok(m.split(/\s+/).length < 70, `${m.split(/\s+/).length} words is too long for a first DM`);
  assert.deepEqual(voiceProblems(m), []);
});

test("a real detail replaces the generic line, and is never invented", () => {
  const generic = firstMessage(coach());
  assert.match(generic, /came across your coaching page/);
  const real = firstMessage(coach(), "saw that you coach out of Lily Yip");
  assert.match(real, /saw that you coach out of Lily Yip/);
  assert.doesNotMatch(real, /came across your coaching page/);
  // Whitespace or a stray full stop must not produce a double punctuation.
  assert.doesNotMatch(firstMessage(coach(), "  saw you at Westchester.  "), /\.\s*,/);
  assert.match(firstMessage(coach(), "   "), /came across your coaching page/);
});

test("the second message explains, states a hypothesis, and carries the link", () => {
  const m = secondMessage(coach());
  assert.match(m, /ponglens\.com$/);
  assert.match(m, /breaks it down point by point/);
  assert.match(m, /tell me where i'm wrong/);
  // Never claim to know their pain: that is the thing being tested.
  assert.doesNotMatch(m, /i know how frustrating|struggle|pain/i);
  assert.deepEqual(voiceProblems(m), []);
});

test("a club hears about its coaches, not its students", () => {
  const club = coach({ entity_type: "club", full_name: "HiTT Academy" });
  assert.match(firstMessage(club), /useful for the coaches you have there/);
  assert.match(secondMessage(club), /a few clubs actually using it with their coaches/);
});

test("the follow up is one nudge that lets them off the hook", () => {
  const m = followUpMessage(coach());
  assert.match(m, /no worries if this isn't for you/);
  assert.ok(m.split(/\s+/).length < 40);
  assert.deepEqual(voiceProblems(m), []);
});

test("messageFor picks the right one and passes the note through", () => {
  assert.equal(messageFor("first", coach()), firstMessage(coach()));
  assert.equal(messageFor("second", coach()), secondMessage(coach()));
  assert.equal(messageFor("followup", coach()), followUpMessage(coach()));
  assert.match(messageFor("first", coach(), "saw you coach at Lily Yip"), /Lily Yip/);
  // The note belongs to the first message only.
  assert.doesNotMatch(messageFor("second", coach(), "saw you coach at Lily Yip"), /Lily Yip/);
});
