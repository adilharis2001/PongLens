import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePointText,
  parseSortedPoints,
  themePoints,
} from "./sorting.ts";

const SOURCE = [
  "Keep the racket up high and use the racket edge/hand higher as the main contact area",
  "Step out one small step when the ball is slightly too far",
];

test("themes flatten to the lines the model may keep", () => {
  assert.deepEqual(
    themePoints([
      { name: "Backhand", points: ["Keep the racket high", "  "] },
      { name: "Footwork", points: ["Step out one small step"] },
    ]),
    ["Keep the racket high", "Step out one small step"],
  );
});

test("a point filed under an unknown topic is dropped", () => {
  assert.deepEqual(
    parseSortedPoints(
      {
        points: [
          { topic_key: "spin_theory", text: SOURCE[0], duplicate: false },
        ],
      },
      SOURCE,
    ),
    [],
  );
});

test("text the model rewrote is dropped rather than stored", () => {
  // This is the whole guard against inventing advice: anything not copied
  // from the source cannot match, so it cannot be filed.
  const sorted = parseSortedPoints(
    {
      points: [
        { topic_key: "backhand", text: "Keep the bat up, roughly", duplicate: false },
        { topic_key: "footwork", text: SOURCE[1], duplicate: false },
      ],
    },
    SOURCE,
  );
  assert.equal(sorted.length, 1);
  assert.equal(sorted[0].text, SOURCE[1]);
  assert.equal(sorted[0].topicKey, "footwork");
});

test("copied text survives casing and punctuation drift", () => {
  const sorted = parseSortedPoints(
    {
      points: [
        {
          topic_key: "footwork",
          text: "step out one small step when the ball is slightly too far.",
          theme_name: "Footwork & positioning",
          duplicate: false,
        },
      ],
    },
    SOURCE,
  );
  // The stored text is the source's, not the model's near-miss.
  assert.equal(sorted[0].text, SOURCE[1]);
  assert.equal(sorted[0].themeName, "Footwork & positioning");
});

test("a short note with no distilled source keeps the model's split", () => {
  const sorted = parseSortedPoints(
    {
      points: [
        { topic_key: "serve", text: "Short side-under to the forehand", duplicate: false },
        { topic_key: "practice", text: "Falkenberg drill, three by ten", duplicate: false },
      ],
    },
    [],
  );
  assert.equal(sorted.length, 2);
  assert.equal(sorted[0].topicKey, "serve");
});

test("duplicates are flagged, and repeats within one sort collapse", () => {
  const sorted = parseSortedPoints(
    {
      points: [
        { topic_key: "backhand", text: SOURCE[0], duplicate: true },
        { topic_key: "backhand", text: SOURCE[0], duplicate: false },
      ],
    },
    SOURCE,
  );
  assert.equal(sorted.length, 1);
  assert.equal(sorted[0].duplicate, true);
});

test("normalization reads the way a person would", () => {
  assert.equal(
    normalizePointText("Keep the racket high."),
    normalizePointText("keep the  racket high"),
  );
});
