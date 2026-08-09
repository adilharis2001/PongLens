import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAnswer } from "./answer.ts";

const known = new Set(["n1", "l1", "m2"]);

test("a properly cited answer survives intact", () => {
  const result = validateAnswer(
    JSON.stringify({
      answer: [
        { text: "You lost that one 1-3.", sourceIds: ["m2"] },
        { text: "Jonathan told you to keep the racket up.", sourceIds: ["l1"] },
      ],
      refused: null,
    }),
    known,
  );
  assert.equal(result?.answer.length, 2);
  assert.equal(result?.dropped, 0);
  assert.equal(result?.refused, null);
});

test("a sentence citing an id we never sent is dropped", () => {
  const result = validateAnswer(
    JSON.stringify({
      answer: [
        { text: "Real, from your notes.", sourceIds: ["n1"] },
        { text: "Invented, with a plausible id.", sourceIds: ["l9"] },
      ],
      refused: null,
    }),
    known,
  );
  assert.equal(result?.answer.length, 1);
  assert.equal(result?.answer[0].text, "Real, from your notes.");
  assert.equal(result?.dropped, 1);
});

test("an uncited sentence is dropped even when it reads well", () => {
  const result = validateAnswer(
    JSON.stringify({
      answer: [
        { text: "Cited.", sourceIds: ["n1"] },
        { text: "Keep your elbow in and brush up the back of the ball." },
      ],
      refused: null,
    }),
    known,
  );
  assert.equal(result?.answer.length, 1);
  assert.equal(result?.dropped, 1);
});

test("an answer that is entirely uncited fails rather than half-ships", () => {
  const result = validateAnswer(
    JSON.stringify({
      answer: [{ text: "General table tennis wisdom.", sourceIds: [] }],
      refused: null,
    }),
    known,
  );
  assert.equal(result, null);
});

test("a refusal is allowed through with nothing to cite", () => {
  const result = validateAnswer(
    JSON.stringify({
      answer: [{ text: "Your journal doesn't cover that.", sourceIds: [] }],
      refused: "not_in_journal",
    }),
    known,
  );
  assert.equal(result?.refused, "not_in_journal");
  assert.equal(result?.answer.length, 1);
});

test("only the ids we sent survive a mixed citation", () => {
  const result = validateAnswer(
    JSON.stringify({
      answer: [{ text: "Half traceable.", sourceIds: ["n1", "n42", "n1"] }],
      refused: null,
    }),
    known,
  );
  assert.deepEqual(result?.answer[0].sourceIds, ["n1"]);
});

test("an id written into the sentence is lifted out, not shown", () => {
  const result = validateAnswer(
    JSON.stringify({
      answer: [
        { text: "Close the racket face and brush up. [l1]", sourceIds: ["l1"] },
      ],
      refused: null,
    }),
    known,
  );
  assert.equal(result?.answer[0].text, "Close the racket face and brush up.");
  assert.deepEqual(result?.answer[0].sourceIds, ["l1"]);
});

test("a sentence cited only inline still counts as cited", () => {
  const result = validateAnswer(
    JSON.stringify({
      answer: [{ text: "You lost that one [m2] in four." }],
      refused: null,
    }),
    known,
  );
  assert.equal(result?.answer.length, 1);
  assert.equal(result?.answer[0].text, "You lost that one in four.");
  assert.deepEqual(result?.answer[0].sourceIds, ["m2"]);
});

test("an inline id we never sent does not rescue an uncited sentence", () => {
  const result = validateAnswer(
    JSON.stringify({ answer: [{ text: "Invented [l9]." }], refused: null }),
    known,
  );
  assert.equal(result, null);
});

test("junk that is not JSON is a failure, not an empty answer", () => {
  assert.equal(validateAnswer("I'm sorry, I can't do that.", known), null);
  assert.equal(validateAnswer("", known), null);
});

test("an unexpected refusal value is not honoured", () => {
  // A model inventing its own refusal string must not get an uncited
  // sentence through on the strength of it.
  const result = validateAnswer(
    JSON.stringify({
      answer: [{ text: "Uncited.", sourceIds: [] }],
      refused: "because_i_said_so",
    }),
    known,
  );
  assert.equal(result, null);
});
