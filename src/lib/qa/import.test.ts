import assert from "node:assert/strict";
import { test } from "node:test";

import { csvDocument } from "./csv.ts";
import { parseVideoSeconds, planImport } from "./import.ts";

const HEADER = [
  "id",
  "title",
  "severity",
  "kind",
  "area",
  "steps",
  "expected",
  "actual",
  "case_id",
  "match_id",
  "video_seconds",
  "device",
  "url",
];

const ID = "f070a568-8404-412e-8e38-2d14889feafe";

function doc(rows: unknown[][]) {
  return csvDocument(HEADER, rows);
}

test("a blank id creates and a known id updates", () => {
  const plan = planImport(
    doc([
      ["", "Clip stalls", "major", "functional", "match", "1. Open", "", "", "", "", "", "", ""],
      [ID, "Edited title", "minor", "visual", "match", "1. Open", "", "", "", "", "", "", ""],
    ]),
    new Set([ID]),
  );
  assert.equal(plan.creates, 1);
  assert.equal(plan.updates, 1);
  assert.equal(plan.errors, 0);
});

test("display labels from the export are accepted as well as keys", () => {
  // The bugs export writes "Major" and "The match page"; a round trip
  // through Sheets must not have to be lossless in wording.
  const plan = planImport(
    doc([["", "Clip stalls", "Major", "Accuracy", "The match page", "1. Open", "", "", "", "", "", "", ""]]),
    new Set(),
  );
  assert.equal(plan.errors, 0);
  assert.equal(plan.rows[0].values.severity, "major");
  assert.equal(plan.rows[0].values.kind, "accuracy");
  assert.equal(plan.rows[0].values.area, "match");
});

test("empty severity, kind and area fall back rather than failing", () => {
  const plan = planImport(
    doc([["", "Clip stalls", "", "", "", "1. Open", "", "", "", "", "", "", ""]]),
    new Set(),
  );
  assert.equal(plan.errors, 0);
  assert.deepEqual(
    [
      plan.rows[0].values.severity,
      plan.rows[0].values.kind,
      plan.rows[0].values.area,
    ],
    ["major", "functional", "other"],
  );
});

test("one bad row does not take the others with it", () => {
  // The whole reason for a per-row plan: a wrong severity in the middle
  // must not throw away the rows around it.
  const plan = planImport(
    doc([
      ["", "Good one", "major", "functional", "match", "1. Open", "", "", "", "", "", "", ""],
      ["", "Bad one", "catastrophic", "functional", "match", "1. Open", "", "", "", "", "", "", ""],
      ["", "Another good one", "minor", "functional", "match", "1. Open", "", "", "", "", "", "", ""],
    ]),
    new Set(),
  );
  assert.equal(plan.creates, 2);
  assert.equal(plan.errors, 1);
  assert.equal(plan.rows[1].action, "error");
  assert.match(plan.rows[1].errors[0], /catastrophic/);
});

test("errors name the line a person sees in the spreadsheet", () => {
  const plan = planImport(
    doc([
      ["", "Fine", "major", "functional", "match", "1. Open", "", "", "", "", "", "", ""],
      ["", "", "major", "functional", "match", "1. Open", "", "", "", "", "", "", ""],
    ]),
    new Set(),
  );
  // Header is line 1, so the second data row is line 3.
  assert.equal(plan.rows[1].line, 3);
  assert.deepEqual(plan.rows[1].errors, ["title is empty"]);
});

test("an id nobody can edit is refused rather than silently inserted", () => {
  const plan = planImport(
    doc([[ID, "Clip stalls", "major", "functional", "match", "1. Open", "", "", "", "", "", "", ""]]),
    new Set(),
  );
  assert.equal(plan.errors, 1);
  assert.match(plan.rows[0].errors[0], /does not match a bug you can edit/);
});

test("a malformed id or match id is caught", () => {
  const plan = planImport(
    doc([
      ["not-a-uuid", "A", "major", "functional", "match", "1. Open", "", "", "", "", "", "", ""],
      ["", "B", "major", "functional", "match", "1. Open", "", "", "", "nope", "", "", ""],
    ]),
    new Set(),
  );
  assert.equal(plan.errors, 2);
  assert.match(plan.rows[0].errors[0], /id is not a valid identifier/);
  assert.match(plan.rows[1].errors[0], /match_id is not a match id/);
});

test("a match address in the spreadsheet becomes the match id", () => {
  // The sheet is filled in by the same person as the form, from the same
  // clipboard, so it forgives the same shapes.
  const id = "f070a568-8404-4b1e-9f4b-2c1d3e5a7b90";
  const plan = planImport(
    doc([
      ["", "Clip stalls", "major", "functional", "match", "1. Open", "", "", "",
       `https://www.ponglens.com/match/${id}?t=12`, "", "", ""],
    ]),
    new Set(),
  );
  assert.equal(plan.errors, 0);
  assert.equal(plan.rows[0].values.match_id, id);
});

test("a title longer than the column is caught before the database sees it", () => {
  const plan = planImport(
    doc([["", "x".repeat(201), "major", "functional", "match", "1. Open", "", "", "", "", "", "", ""]]),
    new Set(),
  );
  assert.equal(plan.errors, 1);
  assert.match(plan.rows[0].errors[0], /longer than 200/);
});

test("multiline steps survive the round trip into a plan", () => {
  const steps = "1. Open a match\n2. Tap point 4\n3. Drag the scrubber";
  const plan = planImport(
    doc([["", "Clip stalls", "major", "functional", "match", steps, "", "", "", "", "", "", ""]]),
    new Set(),
  );
  assert.equal(plan.errors, 0);
  assert.equal(plan.rows[0].values.steps, steps);
});

test("a column the importer does not know is reported, not ignored", () => {
  const text = csvDocument(
    ["title", "sevrity"],
    [["Clip stalls", "major"]],
  );
  const plan = planImport(text, new Set());
  assert.deepEqual(plan.unknownColumns, ["sevrity"]);
});

test("video_seconds takes a clock reading or a number", () => {
  assert.equal(parseVideoSeconds("2:12"), 132);
  assert.equal(parseVideoSeconds("132"), 132);
  assert.equal(parseVideoSeconds("132.5"), 132.5);
  assert.equal(parseVideoSeconds(""), null);
  assert.equal(parseVideoSeconds("0:00"), 0);
  assert.equal(parseVideoSeconds("2:75"), "invalid");
  assert.equal(parseVideoSeconds("-4"), "invalid");
  assert.equal(parseVideoSeconds("soon"), "invalid");
  assert.equal(parseVideoSeconds("1:2:3"), "invalid");
});

test("an empty file is an empty plan, not an error", () => {
  const plan = planImport("", new Set());
  assert.deepEqual(
    [plan.creates, plan.updates, plan.errors, plan.rows.length],
    [0, 0, 0, 0],
  );
});
