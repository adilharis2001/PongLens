import assert from "node:assert/strict";
import { test } from "node:test";

import { scrub, tells } from "./scrub.ts";

test("an em dash becomes a comma", () => {
  assert.equal(
    scrub("Your serve is short — that is why the receive is easy."),
    "Your serve is short, that is why the receive is easy.",
  );
});

test("a typed double hyphen becomes a comma", () => {
  assert.equal(scrub("Watch the third ball--it is the pattern."),
    "Watch the third ball, it is the pattern.");
});

test("hyphenated words are left alone", () => {
  const line = "Play more cross-court and use a three-ball attack.";
  assert.equal(scrub(line), line);
});

test("the not-X-it's-Y sentence keeps only the affirmative half", () => {
  assert.equal(
    scrub("It's not a technique problem, it's a footwork problem."),
    "It is a footwork problem.",
  );
});

test("not just X, but Y loses the negation", () => {
  assert.equal(
    scrub("This isn't just about the serve, it's about the third ball."),
    "It is about the third ball.",
  );
});

test("not only X but also Y keeps Y", () => {
  assert.equal(
    scrub("You lost not only the long rallies, but also the short ones."),
    "You lost the short ones.",
  );
});

test("a plain negative sentence a coach would really write survives", () => {
  const line = "Your backhand is not the problem here.";
  assert.equal(scrub(line), line);
});

test("running it twice changes nothing further", () => {
  const once = scrub("It's not the serve — it's the recovery step.");
  assert.equal(scrub(once), once);
});

test("paragraph breaks survive, stray whitespace does not", () => {
  assert.equal(
    scrub("First point.\n\n\n\nSecond point.   \nThird.  "),
    "First point.\n\nSecond point.\nThird.",
  );
});

test("tells names what is still wrong", () => {
  assert.deepEqual(tells("Clean sentence."), []);
  assert.deepEqual(tells("A — b"), ["dash"]);
  assert.deepEqual(
    tells("It's not this, it's that."),
    ["negation"],
  );
});

test("everything the scrub emits is clean by its own test", () => {
  const samples = [
    "It's not a technique problem, it's a footwork problem.",
    "Your serve is short — that is why the receive is easy.",
    "This isn't just about the serve, it's about the third ball.",
    "You lost not only the long rallies, but also the short ones.",
    "Watch the third ball--it is the pattern.",
  ];
  for (const s of samples) {
    assert.deepEqual(tells(scrub(s)), [], `left a tell in: ${s}`);
  }
});
