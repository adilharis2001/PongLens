import assert from "node:assert/strict";
import test from "node:test";
import { betaInvitationEmail } from "./catalog.ts";
import { renderEmail } from "./render.ts";
import { PLAYER_INTERESTS, COACH_INTERESTS } from "../iosBeta/questionnaire.ts";

const url = "https://testflight.apple.com/join/H9XdnySg";
test("invitation puts one install link before instructions in HTML and plain text", () => {
  const rendered = renderEmail(betaInvitationEmail(url));
  assert.ok(rendered.html.indexOf(`href="${url}"`) < rendered.html.indexOf("Install TestFlight"));
  assert.ok(rendered.text.indexOf(url) < rendered.text.indexOf("Install TestFlight"));
  assert.equal(rendered.html.split(`href="${url}"`).length - 1, 1);
});

test("player invitation includes each chosen feature once and a short separate set of suggestions", () => {
  const message = betaInvitationEmail(url, { role: "player", interests: ["lesson_audio", "video_library", "lesson_audio", "coach_profile", "<script>"] });
  const lists = message.blocks.filter(b => b.type === "bullets");
  assert.equal(lists.length, 2);
  assert.deepEqual(lists[0].items, ["Keep your table tennis videos in one dedicated library.", "Record a lesson and revisit your coach’s advice."]);
  assert.ok(lists[1].items.length <= 3);
  assert.equal(new Set(lists.flatMap(b => b.items)).size, lists.flatMap(b => b.items).length);
  assert.doesNotMatch(renderEmail(message).text, /coach profile|<script>/i);
});

test("coach invitation and combined-role invitation retain the selected role groups", () => {
  const coach = betaInvitationEmail(url, { role: "coach", interests: ["coach_students", "coach_shared_journal"] });
  const text = renderEmail(coach).text;
  assert.match(text, /Keep your students and coaching history together/);
  assert.match(text, /Share lesson notes and training journals with your students/);
  assert.doesNotMatch(text, /Record a match on your iPhone/);
  const both = betaInvitationEmail(url, { role: "both", interests: ["iphone_recording", "coach_profile"] });
  const lists = both.blocks.filter(b => b.type === "bullets");
  assert.deepEqual(lists.slice(0,2).map(b => b.items), [["Record a match on your iPhone."], ["Create a coach profile players can find and share."]]);
});

test("every signup option has invitation copy; all-selected invitations do not add duplicates", () => {
  const choices = [...PLAYER_INTERESTS,...COACH_INTERESTS];
  const message = betaInvitationEmail(url,{role:"both",interests:choices.map(x=>x.value)});
  const lists = message.blocks.filter(b=>b.type === "bullets");
  assert.equal(lists.length,2);
  assert.equal(lists.flatMap(b=>b.items).length,choices.length);
  assert.ok(lists.flatMap(b=>b.items).every(x=>x.length>10));
});

test("older applicants get a short starter list without claiming they selected anything", () => {
  const message = betaInvitationEmail(url);
  const lists = message.blocks.filter(b=>b.type === "bullets");
  assert.equal(lists.length,1);
  assert.equal(lists[0].items.length,3);
  assert.doesNotMatch(renderEmail(message).text,/you selected/);
});
