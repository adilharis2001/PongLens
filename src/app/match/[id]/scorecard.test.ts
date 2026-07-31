import assert from "node:assert/strict";
import test from "node:test";
import {
  LOSS_REASONS,
  MISREAD_KINDS,
  customReasonId,
  customReasonValue,
  isCustomReason,
  lossReasonLabel,
  lossReasonsFor,
  lossReasonsSummary,
  hasLossAnalysis,
  misreadKindApplies,
  outOfPositionApplies,
  normalizeCustomReasonLabel,
  serverContextLine,
  pruneLossReasons,
  serveApplies,
} from "./scorecard.ts";

const values = (rows: { value: string }[]) => rows.map((r) => r.value);

test("the rotation decides which serve chip is offered, and leads with it", () => {
  // You served: blaming your own serve is on the table, receiving is not.
  const served = values(lossReasonsFor(true));
  assert.equal(served[0], "weak_serve");
  assert.ok(!served.includes("receive_error"));

  // They served: the mirror.
  const received = values(lossReasonsFor(false));
  assert.equal(received[0], "receive_error");
  assert.ok(!received.includes("weak_serve"));

  // The same six either way — but ordered for the rally that was played.
  // Serving, you gave away the initiative: the third ball leads. Receiving,
  // you were under it from the first ball: the read leads.
  assert.deepEqual(served.slice(1, 3), ["too_aggressive", "their_winner"]);
  assert.deepEqual(received.slice(1, 3), ["misread_spin", "too_passive"]);
  for (const rows of [served, received]) {
    assert.deepEqual([...rows.slice(1)].sort(), [
      "lost_focus",
      "misread_spin",
      "out_of_position",
      "their_winner",
      "too_aggressive",
      "too_passive",
    ]);
  }
});

test("the question names who served, so the chip set reads as reasoned", () => {
  const labels = { you: "Adil", them: "Chris" };
  assert.equal(serverContextLine(true, labels, false), "You served");
  assert.equal(serverContextLine(false, labels, false), "Chris served");
  // Neutral match: the uploader is not "you", so name them.
  assert.equal(serverContextLine(true, labels, true), "Adil served");
  // Nothing known: say nothing rather than "Server unknown", which invites
  // a shrug exactly where an answer is wanted.
  assert.equal(serverContextLine(null, labels, false), null);
});

test("an unknown server offers neither serve chip rather than guessing", () => {
  // first_server unset: offering the wrong mirror invites an answer that is
  // simply false, so the question stays at the six that are always true.
  const rows = values(lossReasonsFor(null));
  assert.equal(rows.length, 6);
  assert.ok(!rows.includes("weak_serve"));
  assert.ok(!rows.includes("receive_error"));
});

test("the player's own pills are offered after the built-ins", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const rows = lossReasonsFor(false, [{ id, label: "Misread the pips" }]);
  const last = rows[rows.length - 1];
  assert.equal(last.value, `custom:${id}`);
  assert.equal(last.label, "Misread the pips");
});

test("custom reason values round-trip through their stored form", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const stored = customReasonValue(id);
  assert.equal(stored, `custom:${id}`);
  assert.ok(isCustomReason(stored));
  assert.equal(customReasonId(stored), id);
  // Built-ins are never mistaken for custom ones.
  assert.equal(isCustomReason("misread_spin"), false);
  assert.equal(customReasonId("misread_spin"), null);
});

test("retired reasons still read, under the label they merged into", () => {
  // 'rushed' is never offered again but old points keep the value; it must
  // not start rendering as a raw key.
  assert.equal(lossReasonLabel("rushed"), "Too aggressive");
  assert.ok(!values(lossReasonsFor(true)).includes("rushed"));
  assert.equal(lossReasonLabel("too_aggressive"), "Too aggressive");
});

test("a custom reason whose label is gone says so instead of vanishing", () => {
  // points.loss_reasons has no foreign key (migration 060), so a label
  // deleted straight from SQL leaves a dangling id. The chip must still
  // report that the point carries a reason.
  const stored = customReasonValue("11111111-2222-3333-4444-555555555555");
  assert.equal(lossReasonLabel(stored, new Map()), "Removed reason");
  assert.equal(lossReasonLabel(stored), "Removed reason");
});

test("the summary resolves built-in, retired and custom reasons together", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const custom = new Map([[id, "Misread the pips"]]);
  assert.equal(
    lossReasonsSummary(
      ["receive_error", "rushed", customReasonValue(id)],
      custom,
    ),
    "Receive error · Too aggressive · Misread the pips",
  );
  assert.equal(lossReasonsSummary([], custom), null);
  assert.equal(lossReasonsSummary(null, custom), null);
});

test("correcting who served drops only the mirrored chip", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const stored = ["weak_serve", "misread_spin", customReasonValue(id)];

  // Turns out they served: "weak serve" can't be true, the rest still is.
  assert.deepEqual(pruneLossReasons(stored, false), [
    "misread_spin",
    customReasonValue(id),
  ]);
  // Still your serve: nothing to drop.
  assert.deepEqual(pruneLossReasons(stored, true), stored);
  // Server became unknown: both mirrors go, core and custom survive.
  assert.deepEqual(pruneLossReasons(["receive_error", "lost_focus"], null), [
    "lost_focus",
  ]);
});

test("the serve follow-up is asked only when a serve decided the point", () => {
  assert.equal(serveApplies(["weak_serve"]), true);
  assert.equal(serveApplies(["receive_error"]), true);
  // The old gate fired on every clean winner, guessing at third-ball
  // attacks it could not detect. Ordinary rally reasons ask nothing.
  assert.equal(serveApplies(["misread_spin", "out_of_position"]), false);
  assert.equal(serveApplies([]), false);
  assert.equal(serveApplies(null), false);
});

test("each follow-up belongs to exactly one reason", () => {
  // Misread -> which part of the spin beat you. Two chips, because reading
  // it wrong and misjudging how much are different practice sessions.
  assert.equal(misreadKindApplies(["misread_spin"]), true);
  assert.equal(misreadKindApplies(["out_of_position"]), false);
  assert.equal(misreadKindApplies(null), false);
  assert.deepEqual(values(MISREAD_KINDS), ["type", "amount"]);

  // Out of position -> where they got you, not where your ball ended up:
  // "caught at the middle" is a footwork drill, "into the net" is not.
  assert.equal(outOfPositionApplies(["out_of_position"]), true);
  assert.equal(outOfPositionApplies(["misread_spin"]), false);
  assert.equal(outOfPositionApplies(null), false);
});

test("reasons that stand on their own ask nothing further", () => {
  // The ceiling is one follow-up per reason, and most have none: a player
  // who says they were too passive has already said the whole thing.
  for (const r of ["too_aggressive", "too_passive", "lost_focus", "their_winner"]) {
    assert.equal(misreadKindApplies([r]), false, r);
    assert.equal(outOfPositionApplies([r]), false, r);
    assert.equal(serveApplies([r]), false, r);
  }
  // A custom pill never carries a built-in follow-up either.
  const custom = customReasonValue("11111111-2222-3333-4444-555555555555");
  assert.equal(misreadKindApplies([custom]), false);
  assert.equal(outOfPositionApplies([custom]), false);
  assert.equal(serveApplies([custom]), false);
});

test("custom pills are normalized to the shape the built-ins already have", () => {
  // Sentence case either way in, so a pill never sits beside "Misread the
  // spin" looking like a different kind of thing.
  assert.equal(normalizeCustomReasonLabel("misread the pips"), "Misread the pips");
  assert.equal(normalizeCustomReasonLabel("MISREAD THE PIPS"), "Misread the pips");
  assert.equal(normalizeCustomReasonLabel("Misread The Pips"), "Misread the pips");
  // Stray whitespace would otherwise make two spellings of one problem.
  assert.equal(normalizeCustomReasonLabel("  served   too   long  "), "Served too long");
  // Capped, and the cap is applied before casing so the result is stable.
  const long = normalizeCustomReasonLabel("x".repeat(60));
  assert.equal(long.length, 24);
  assert.equal(long, "X" + "x".repeat(23));
  // Nothing typed stays nothing, rather than becoming a blank pill.
  assert.equal(normalizeCustomReasonLabel("   "), "");
});

test("only a point the owner lost has anything to ask about", () => {
  const lost = { confirmed_winner: "opponent", is_let: false };
  assert.equal(hasLossAnalysis(lost, false), true);

  // Won: nothing is asked, so the card must not mount and leave an empty
  // bordered box sitting above the notes.
  assert.equal(hasLossAnalysis({ confirmed_winner: "user", is_let: false }, false), false);
  // Unscored: no outcome to explain yet.
  assert.equal(hasLossAnalysis({ confirmed_winner: null, is_let: false }, false), false);
  // Skipped: the ball never counted.
  assert.equal(hasLossAnalysis({ confirmed_winner: null, is_let: true }, false), false);
  // Neutral third-party match: the question is first-person and there is no
  // "you" in it.
  assert.equal(hasLossAnalysis(lost, true), false);
});

test("every offered reason is spelled in plain first-person language", () => {
  // These are read mid-match on a phone by someone who just lost a point.
  for (const { value, label } of LOSS_REASONS) {
    assert.ok(label.length <= 24, `${value} label too long: ${label}`);
    assert.equal(label, label[0].toUpperCase() + label.slice(1));
    assert.ok(!/[.!]$/.test(label), `${value} should not end in punctuation`);
  }
});
