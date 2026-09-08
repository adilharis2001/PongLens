import assert from "node:assert/strict";
import test from "node:test";
import {
  agoLabel,
  countLabel,
  durationsLabel,
  filterPlayers,
  formatClock,
  gbLabel,
  isNew,
  retentionLabel,
  scoringLabel,
  sortPlayers,
  type PlayerOverviewRow,
} from "./playersView.ts";

const NOW = Date.parse("2026-09-05T12:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

function player(over: Partial<PlayerOverviewRow>): PlayerOverviewRow {
  return {
    user_id: over.email ?? "u", email: "a@b.com", name: null,
    created_at: day(100), last_sign_in_at: null, last_upload_at: null,
    kind: "real", used_bytes: 0, storage_limit_bytes: 0,
    matches: 0, matches_scored: 0, points: 0, starred: 0, notes: 0,
    voice_notes: 0, journal_entries: 0, exports: 0, share_links: 0,
    est_cost_usd: 0, ...over,
  } as PlayerOverviewRow;
}

test("formatClock covers minutes, hours, and bad input", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(754), "12:34");
  assert.equal(formatClock(59.6), "1:00");
  assert.equal(formatClock(5025), "1:23:45");
  assert.equal(formatClock(3600), "1:00:00");
  assert.equal(formatClock(null), null);
  assert.equal(formatClock(-3), null);
  assert.equal(formatClock(Number.NaN), null);
});

test("retention rounds, clamps at 100, and needs both timelines", () => {
  assert.equal(retentionLabel(843, 648), "77% kept");
  assert.equal(retentionLabel(100, 104), "100% kept");
  assert.equal(retentionLabel(null, 648), null);
  assert.equal(retentionLabel(843, null), null);
  assert.equal(retentionLabel(0, 0), null);
});

test("durations show both timelines, or whichever exists", () => {
  assert.equal(durationsLabel(843, 648), "14:03 → 10:48");
  assert.equal(durationsLabel(843, null), "14:03");
  assert.equal(durationsLabel(null, null), null);
});

test("scoring label follows the library's chip rule", () => {
  const base = { points: 51, scored_points: 0, unscored_points: 49 };
  assert.equal(scoringLabel({ ...base, points: 0 }), "No points");
  assert.equal(scoringLabel(base), "51 points");
  // two lets: everything callable is called, so the match reads scored
  assert.equal(
    scoringLabel({ points: 51, scored_points: 49, unscored_points: 0 }),
    "51 points, scored"
  );
  assert.equal(
    scoringLabel({ points: 92, scored_points: 31, unscored_points: 61 }),
    "31/92 scored"
  );
});

test("storage labels trim the trailing .0", () => {
  assert.equal(gbLabel(5 * 1024 ** 3), "5 GB");
  assert.equal(gbLabel(1.9 * 1024 ** 3), "1.9 GB");
});

test("counts pluralize, including the irregular match", () => {
  assert.equal(countLabel(1, "point"), "1 point");
  assert.equal(countLabel(2, "point"), "2 points");
  assert.equal(countLabel(1, "match", "matches"), "1 match");
  assert.equal(countLabel(0, "match", "matches"), "0 matches");
  assert.equal(
    scoringLabel({ points: 1, scored_points: 1, unscored_points: 0 }),
    "1 point, scored"
  );
});


test("recently active ranks by the newest upload", () => {
  const rows = [
    player({ email: "old@x", last_upload_at: day(30) }),
    player({ email: "new@x", last_upload_at: day(1) }),
    player({ email: "mid@x", last_upload_at: day(5) }),
  ];
  assert.deepEqual(
    sortPlayers(rows, "active").map((r) => r.email),
    ["new@x", "mid@x", "old@x"],
  );
});

test("a signup that has never uploaded still surfaces by when it joined", () => {
  // The whole point of the page: notice somebody who turned up today.
  // Ranking a never-uploaded account at the bottom would bury exactly
  // the person worth looking at.
  const rows = [
    player({ email: "uploaded-a-month-ago@x", last_upload_at: day(30), created_at: day(200) }),
    player({ email: "joined-today@x", last_upload_at: null, created_at: day(0) }),
  ];
  assert.equal(sortPlayers(rows, "active")[0].email, "joined-today@x");
});

test("most matches keeps the old ordering, newest first on a tie", () => {
  const rows = [
    player({ email: "few@x", matches: 2, created_at: day(10) }),
    player({ email: "tie-old@x", matches: 9, created_at: day(50) }),
    player({ email: "tie-new@x", matches: 9, created_at: day(3) }),
  ];
  assert.deepEqual(
    sortPlayers(rows, "matches").map((r) => r.email),
    ["tie-new@x", "tie-old@x", "few@x"],
  );
});

test("the kind filter is what hides the test accounts", () => {
  const rows = [
    player({ email: "real@x", kind: "real" }),
    player({ email: "us@x", kind: "team" }),
    player({ email: "throwaway@x", kind: "test" }),
  ];
  assert.deepEqual(
    filterPlayers(rows, "real", "").map((r) => r.email),
    ["real@x"],
  );
  assert.equal(filterPlayers(rows, "all", "").length, 3);
});

test("search reaches both the name and the address, and ignores case", () => {
  const rows = [
    player({ email: "guillaumemuller90@gmail.com", name: "Guillaume Muller" }),
    player({ email: "other@x", name: "Someone Else" }),
  ];
  assert.equal(filterPlayers(rows, "all", "GUILLAUME").length, 1);
  assert.equal(filterPlayers(rows, "all", "muller90").length, 1);
  assert.equal(filterPlayers(rows, "all", "nobody").length, 0);
});

test("search still obeys the kind filter", () => {
  const rows = [
    player({ email: "adil@test", name: "Adil", kind: "team" }),
    player({ email: "adil@real", name: "Adil", kind: "real" }),
  ];
  assert.deepEqual(
    filterPlayers(rows, "real", "adil").map((r) => r.email),
    ["adil@real"],
  );
});

test("ago reads as a person would say it, never '0 days ago'", () => {
  assert.equal(agoLabel(day(0), NOW), "today");
  assert.equal(agoLabel(day(1), NOW), "yesterday");
  assert.equal(agoLabel(day(6), NOW), "6d");
  assert.equal(agoLabel(day(20), NOW), "2w");
  assert.equal(agoLabel(null, NOW), "—");
});

test("new means the last week", () => {
  assert.equal(isNew(player({ created_at: day(2) }), NOW), true);
  assert.equal(isNew(player({ created_at: day(8) }), NOW), false);
});
