import assert from "node:assert/strict";
import test from "node:test";
import {
  durationLabel,
  groupStarred,
  outcomeLabel,
  outcomeOf,
  rallySeconds,
  reasonLabel,
  summaryLine,
  type StarredPointRow,
} from "./starred.ts";

/**
 * The Starred shelf's shaping. The Swift port of this logic is checked by
 * the same cases in ios/Tests/StarredTests.swift — when one changes, both
 * should.
 */

function row(over: Partial<StarredPointRow> = {}): StarredPointRow {
  return {
    id: "p1",
    match_id: "m1",
    display_no: 12,
    t0: 100,
    t1: 106.5,
    has_clip: true,
    confirmed_winner: "user",
    confirmed_how: null,
    direction: null,
    loss_reasons: null,
    is_let: false,
    edited: false,
    opponent_name: "Chris",
    venue: "Pingpod",
    played_at: "2026-08-22T12:00:00+00:00",
    match_type: "match",
    has_thumb: true,
    ...over,
  };
}

test("one group per match, in the order the rows arrived", () => {
  const groups = groupStarred([
    row({ id: "a", match_id: "m1", display_no: 12 }),
    row({ id: "b", match_id: "m2", display_no: 5 }),
    row({ id: "c", match_id: "m2", display_no: 9 }),
    row({ id: "d", match_id: "m2", display_no: 40 }),
    row({ id: "e", match_id: "m3", display_no: 1 }),
  ]);
  assert.equal(groups.length, 3);
  assert.equal(groups[1].points.length, 3);
  assert.deepEqual(
    groups[1].points.map((p) => p.display_no),
    [5, 9, 40]
  );
});

test("interleaved rows split, because grouping trusts the RPC's order", () => {
  // If anything ever re-sorts the rows before this, the same match comes
  // out as two groups. That is the failure this case names.
  const groups = groupStarred([
    row({ id: "a", match_id: "m1" }),
    row({ id: "b", match_id: "m2" }),
    row({ id: "c", match_id: "m1" }),
  ]);
  assert.equal(groups.length, 3);
});

test("no rows, no groups", () => {
  assert.deepEqual(groupStarred([]), []);
});

test("group title and subtitle", () => {
  const [g] = groupStarred([row()]);
  assert.equal(g.title, "Chris · Pingpod");
  assert.equal(g.subtitle, "Aug 22, 2026 · Match");
});

test("an untitled match falls back to its capture time", () => {
  const [g] = groupStarred([
    row({ opponent_name: null, venue: null, match_type: null }),
  ]);
  assert.match(g.title, /^Match · /);
});

test("the count line", () => {
  const rows = [
    row({ id: "a", match_id: "m1" }),
    row({ id: "b", match_id: "m2" }),
    row({ id: "c", match_id: "m2" }),
  ];
  assert.equal(summaryLine(rows), "3 points · 2 matches");
  assert.equal(summaryLine([rows[0]]), "1 point · 1 match");
  assert.equal(summaryLine([]), "0 points · 0 matches");
});

test("outcome", () => {
  assert.equal(outcomeOf(row()), "won");
  assert.equal(outcomeLabel(row()), "I won");
  assert.equal(outcomeLabel(row({ confirmed_winner: "opponent" })), "They won");
  assert.equal(outcomeLabel(row({ confirmed_winner: null })), "Not scored");
  assert.equal(
    outcomeLabel(row({ is_let: true, confirmed_how: "let" })),
    "Let"
  );
  assert.equal(outcomeLabel(row({ is_let: true })), "Skipped");
});

test("a stored reason slug renders as words, never as the slug", () => {
  // "too_aggressive" reached a tile once. Joining the raw array is the
  // database talking.
  assert.equal(
    reasonLabel(row({ confirmed_winner: "opponent", loss_reasons: ["too_aggressive"] })),
    "Too aggressive"
  );
});

test("the owner's own pills resolve through the label map", () => {
  const custom = new Map([["abc", "Rushed the loop"]]);
  assert.equal(
    reasonLabel(
      row({ confirmed_winner: "opponent", loss_reasons: ["custom:abc"] }),
      custom
    ),
    "Rushed the loop"
  );
  assert.equal(
    reasonLabel(
      row({ confirmed_winner: "opponent", loss_reasons: ["custom:gone"] }),
      custom
    ),
    "Removed reason"
  );
});

test("no second line where there is nothing to say", () => {
  assert.equal(reasonLabel(row()), null);
  // A skipped point already names its reason in the outcome line.
  assert.equal(reasonLabel(row({ is_let: true, confirmed_how: "let" })), null);
});

test("duration", () => {
  assert.equal(durationLabel(row()), "6.5s");
  assert.equal(durationLabel(row({ t0: null, t1: null })), null);
  // A zero-length rally is missing timing, not a rally.
  assert.equal(rallySeconds(row({ t0: 100, t1: 100 })), null);
});
