import assert from "node:assert/strict";
import test from "node:test";
import {
  canReceiveEntries,
  entryCountLabel,
  findCoachByName,
  mergeCandidates,
  moveSummary,
  normalizeCoachName,
  shareHint,
  sortCoaches,
  statusLabel,
  type PlayerCoach,
  type PlayerCoachStatus,
} from "./playerCoaches.ts";

function coach(over: Partial<PlayerCoach> = {}): PlayerCoach {
  return {
    id: over.id ?? "c1",
    coach_id: over.coach_id ?? null,
    display_name: over.display_name ?? "Jonathan",
    coach_email: over.coach_email ?? null,
    invite_id: over.invite_id ?? null,
    status: over.status ?? "offline",
    entry_count: over.entry_count ?? 0,
    shared_count: over.shared_count ?? 0,
  };
}

test("an invited coach can still be shared with", () => {
  // The share waits for the accept rather than being refused: the RPC
  // needs an accepted link too, so nothing is live before the link is.
  assert.equal(canReceiveEntries("invited"), true);
  assert.equal(canReceiveEntries("connected"), true);
  assert.equal(canReceiveEntries("offline"), false);
});

test("a coach who removed you is never offered a share", () => {
  // They keep the lessons they taught, and nothing else.
  assert.equal(canReceiveEntries("past"), false);
  assert.equal(shareHint("past"), null);
  assert.equal(
    statusLabel(coach({ status: "past", entry_count: 2 })),
    "No longer connected",
  );
});

test("a former coach sorts below everyone still in play", () => {
  const rows = [
    coach({ id: "p", display_name: "Aa", status: "past" }),
    coach({ id: "o", display_name: "Zz", status: "offline" }),
    coach({ id: "c", display_name: "Zz", status: "connected" }),
  ];
  assert.deepEqual(sortCoaches(rows).map((c) => c.id), ["c", "o", "p"]);
});

test("the share hint never guesses a pronoun", () => {
  for (const status of ["connected", "invited"] as PlayerCoachStatus[]) {
    const hint = shareHint(status);
    assert.ok(hint);
    assert.doesNotMatch(hint, /\b(he|she|his|her|hers|him)\b/i);
  }
  assert.equal(shareHint("offline"), null);
});

test("a coach with no account reads as such, not as an empty journal", () => {
  assert.equal(statusLabel(coach({ status: "offline" })), "Not on PongLens");
  assert.equal(statusLabel(coach({ status: "invited" })), "Invite sent");
  assert.equal(
    statusLabel(coach({ status: "connected", entry_count: 3 })),
    "3 entries",
  );
  assert.equal(
    statusLabel(coach({ status: "connected", entry_count: 3, shared_count: 1 })),
    "1 of 3 entries shared",
  );
});

test("entry counts read as English", () => {
  assert.equal(entryCountLabel(0), "No entries yet");
  assert.equal(entryCountLabel(1), "1 entry");
  assert.equal(entryCountLabel(4), "4 entries");
});

test("the coach you work with today sorts first", () => {
  const rows = [
    coach({ id: "a", display_name: "Zoe", status: "offline" }),
    coach({ id: "b", display_name: "Bo", status: "connected" }),
    coach({ id: "c", display_name: "Ana", status: "invited" }),
    coach({ id: "d", display_name: "Al", status: "connected" }),
  ];
  assert.deepEqual(
    sortCoaches(rows).map((c) => c.id),
    ["d", "b", "c", "a"],
  );
  // and the input is not mutated
  assert.equal(rows[0].id, "a");
});

test("typing a name that already exists reuses that coach", () => {
  const rows = [coach({ id: "j", display_name: "Jonathan" })];
  assert.equal(findCoachByName(rows, "jonathan")?.id, "j");
  assert.equal(findCoachByName(rows, "  JONATHAN  ")?.id, "j");
  // A different spelling is a different coach: the app must not decide
  // that "Jonotan" meant "Jonathan". That is the player's call.
  assert.equal(findCoachByName(rows, "Jonotan"), undefined);
  assert.equal(findCoachByName(rows, "   "), undefined);
});

test("names are normalised the way the column is", () => {
  assert.equal(normalizeCoachName("  Coach   Lee \n"), "Coach Lee");
  assert.equal(normalizeCoachName("x".repeat(200)).length, 80);
});

test("two connected accounts are never offered as a merge", () => {
  const typed = coach({ id: "typed", display_name: "Jonathan" });
  const bound = coach({ id: "bound", coach_id: "u1", status: "connected" });
  const other = coach({ id: "other", coach_id: "u2", status: "connected" });

  // Folding a typed row into a bound one, and the reverse, are both fine.
  assert.deepEqual(
    mergeCandidates([typed, bound, other], typed).map((c) => c.id),
    ["bound", "other"],
  );
  assert.deepEqual(
    mergeCandidates([typed, bound, other], bound).map((c) => c.id),
    ["typed"],
  );
});

test("a bulk move says what it is about to do", () => {
  assert.equal(moveSummary(1, "Jonathan", false), "Move 1 entry to Jonathan.");
  assert.equal(
    moveSummary(12, "Jonathan", true),
    "Move 12 entries to Jonathan and share them.",
  );
});
