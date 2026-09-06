import assert from "node:assert/strict";
import test from "node:test";

import {
  buildThemeReach,
  cardCutOffset,
  cardWhere,
  distinctMatchIds,
  reachLine,
  type ThemeCardRow,
  type ThemeRow,
} from "./themeView.ts";

function card(over: Partial<ThemeCardRow> = {}): ThemeCardRow {
  return {
    point_id: "p1",
    match_id: "m1",
    idx: 1,
    t0: 100,
    t1: 110,
    cut_t0: 50,
    tight_start: false,
    tight_end: false,
    has_clip: true,
    note: null,
    note_at: null,
    theme_ids: ["t1"],
    themes: ["lob cut short"],
    opponent_name: "Young 2",
    venue: "Westchester TTC",
    played_at: "2026-08-30T10:00:00Z",
    clip_pads: { pre: 0.3, post: 0.4 },
    strictness: "normal",
    match_json_path: "r2://media/x/match.json",
    has_cut: true,
    ...over,
  };
}

function theme(id: string, label: string): ThemeRow {
  return { id, label, points: 0, created_at: "2026-08-30T10:00:00Z" };
}

test("a theme reaching more matches outranks one with more cards", () => {
  const themes = [theme("t1", "one match"), theme("t2", "many matches")];
  const rows = [
    card({ point_id: "a", match_id: "m1", theme_ids: ["t1"] }),
    card({ point_id: "b", match_id: "m1", theme_ids: ["t1"] }),
    card({ point_id: "c", match_id: "m1", theme_ids: ["t1"] }),
    card({ point_id: "d", match_id: "m2", theme_ids: ["t2"] }),
    card({ point_id: "e", match_id: "m3", theme_ids: ["t2"] }),
  ];
  const reach = buildThemeReach(themes, rows);
  assert.deepEqual(
    reach.map((t) => t.label),
    ["many matches", "one match"]
  );
  assert.equal(reach[0].matches, 2);
  assert.equal(reach[1].cards, 3);
  assert.equal(reach[1].matches, 1);
});

test("a card carrying several themes appears under every one of them", () => {
  const themes = [theme("t1", "body obstruction"), theme("t2", "two points in one")];
  const rows = [card({ point_id: "a", theme_ids: ["t1", "t2"] })];
  const reach = buildThemeReach(themes, rows);
  assert.equal(reach.length, 2);
  assert.equal(reach[0].rows[0].point_id, "a");
  assert.equal(reach[1].rows[0].point_id, "a");
});

test("a theme with no cards left is dropped, not listed empty", () => {
  const themes = [theme("t1", "live"), theme("t2", "abandoned")];
  const rows = [card({ theme_ids: ["t1"] })];
  assert.deepEqual(
    buildThemeReach(themes, rows).map((t) => t.label),
    ["live"]
  );
});

test("reach reads as a sentence, singular where it should be", () => {
  const themes = [theme("t1", "x")];
  const one = buildThemeReach(themes, [card({ theme_ids: ["t1"] })]);
  assert.equal(reachLine(one[0]), "1 card · 1 match · Westchester TTC");

  const many = buildThemeReach(themes, [
    card({ point_id: "a", match_id: "m1", venue: "A", theme_ids: ["t1"] }),
    card({ point_id: "b", match_id: "m2", venue: "B", theme_ids: ["t1"] }),
  ]);
  assert.equal(reachLine(many[0]), "2 cards · 2 matches · 2 venues");
});

test("the cut offset is the admin page's, and refuses a card with no cut place", () => {
  // cut_t0 is where the PADDED clip starts, and that padding begins at
  // source t0 - pre. So source 100 with pre 0.3 sits at cut 50 + 0.3.
  assert.equal(cardCutOffset(card(), 0.3), -49.7);
  assert.equal(cardCutOffset(card({ cut_t0: null }), 0.3), null);
  assert.equal(
    cardCutOffset(card({ cut_t0: Number.NaN }), 0.3),
    null
  );
});

test("matches are listed once however many cards they carry", () => {
  assert.deepEqual(
    distinctMatchIds([
      card({ match_id: "m1" }),
      card({ match_id: "m1" }),
      card({ match_id: "m2" }),
    ]),
    ["m1", "m2"]
  );
});

test("a card with no opponent still says where it is from", () => {
  assert.equal(cardWhere(card()), "Young 2 · Westchester TTC");
  assert.equal(
    cardWhere(card({ opponent_name: null, venue: "Pingpod" })),
    "Match · Pingpod"
  );
  assert.equal(
    cardWhere(card({ opponent_name: null, venue: null })),
    "Match"
  );
});
