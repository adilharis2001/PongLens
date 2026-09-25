import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The owner's game ends through marking a match again, read out of the
// migration so a later edit cannot quietly drop one step. Behaviour, down
// to the games the canonical projection draws, is checked against a real
// Postgres by supabase/tests/marker_game_ends.sql (commands in
// supabase/tests/marker_game_ends_stubs.sql); the marker's own score by
// handCut.test.ts and the iOS parity fixture.
const sql = readFileSync("supabase/migrations/20260925182951_marker_game_ends.sql", "utf8");
const code = sql.replace(/--.*$/gm, "");
const web = readFileSync("src/app/match/[id]/handCut.ts", "utf8");
const swift = readFileSync("ios/PongLens/PongLens/Core/HandCut.swift", "utf8");

function fn(name: string): string {
  const start = code.search(new RegExp(`create or replace function public\\.${name}\\(`, "i"));
  assert.ok(start >= 0, `${name} is defined`);
  const rest = code.slice(start);
  return rest.slice(0, rest.search(/\n\$\$;/));
}

/** The marks loop, with the one name that differs between the two. */
function marksLoop(body: string, duration: string): string {
  const start = body.indexOf("for v_mark in select * from jsonb_array_elements(p_marks) loop");
  const end = body.indexOf("end loop;", start);
  assert.ok(start >= 0 && end > start, "marks loop");
  return body.slice(start, end).replace(duration, "DURATION").replace(/\s+/g, " ");
}

test("both claims check the game keys, and with the same loop", () => {
  const recut = marksLoop(fn("_hand_cut_validate_marks"), "p_duration_s");
  const first = marksLoop(fn("_hand_cut_claim_checks"), "v_match.duration_s");
  assert.equal(recut, first);
  assert.match(recut, /v_mark->>'gameEnd' is not null and v_mark->>'gameEnd' not in \('end', 'continue'\)/);
  assert.match(recut, /v_mark->>'gameWinner' is not null and v_mark->>'gameWinner' not in \('user', 'opponent'\)/);
});

test("the prefill copies a visible point's corrections, only when set", () => {
  const body = fn("_recut_marks_from_points");
  assert.match(body, /p\.game_end_override, p\.game_winner_override/);
  assert.match(body, /and not p\.deleted/);
  assert.match(
    body,
    /when r\.game_end_override in \('end', 'continue'\)\s+then jsonb_build_object\('gameEnd', r\.game_end_override\)\s+else '\{\}'::jsonb end/,
  );
  assert.match(
    body,
    /when r\.game_winner_override in \('user', 'opponent'\)\s+then jsonb_build_object\('gameWinner', r\.game_winner_override\)\s+else '\{\}'::jsonb end/,
  );
});

test("the cut writes them after the pairing is checked and before the score is projected", () => {
  const first = fn("publish_hand_cut_v2");
  const checked = first.indexOf("normalize_manual_cut_observations(p_match_id)");
  const applied = first.indexOf("_apply_hand_cut_game_marks(");
  const projected = first.indexOf("refresh_match_score_state(p_match_id)");
  assert.ok(checked > 0 && checked < applied && applied < projected, "publish_hand_cut_v2 order");

  const recut = fn("publish_hand_recut");
  const recutChecked = recut.indexOf("_normalize_manual_cut_observations_for_version(");
  const recutApplied = recut.indexOf("_apply_hand_cut_game_marks(p_match_id, v.id)");
  const live = recut.lastIndexOf("_activate_hand_recut(");
  assert.ok(
    recutChecked > 0 && recutChecked < recutApplied && recutApplied < live,
    "publish_hand_recut order",
  );
  // Once, at the first publication: the 'ready' branch (a later
  // activation) returns before it and never writes them again.
  const ready = recut.indexOf("if v.status = 'ready' then");
  assert.ok(ready > 0 && ready < recut.indexOf("return public._activate_hand_recut") &&
    recut.indexOf("return public._activate_hand_recut") < recutApplied);
});

test("the pairing is the observations' own: marks by start, points by (t0, idx, id)", () => {
  const body = fn("_apply_hand_cut_game_marks");
  assert.match(body, /security definer/);
  assert.match(body, /row_number\(\) over \(order by \(mark->>'t0'\)::numeric\) as ordinal/);
  assert.match(body, /where mark->>'t0' is not null and mark->>'t1' is not null/);
  assert.match(body, /row_number\(\) over \(order by p\.t0, p\.idx, p\.id\) as ordinal/);
  assert.match(body, /p\.processing_version_id = p_version_id\s+and not p\.deleted/);
  assert.match(
    code,
    /revoke all on function public\._apply_hand_cut_game_marks\(uuid, uuid\)\s+from public, anon, authenticated;/,
  );
});

test("no replaced function opens to a client", () => {
  for (const signature of [
    "_recut_marks_from_points\\(public\\.matches\\)",
    "_hand_cut_validate_marks\\(jsonb, double precision\\)",
    "_hand_cut_claim_checks\\(uuid, jsonb\\)",
    "publish_hand_cut_v2\\(uuid, uuid\\)",
    "publish_hand_recut\\(uuid, uuid, text, text, text, jsonb\\)",
  ]) {
    assert.match(code, new RegExp(`revoke all on function public\\.${signature}\\s+from public, anon, authenticated;`), signature);
  }
  assert.doesNotMatch(code, /\bgrant\b/i);
});

test("web, iPhone and database spell the two keys the same way", () => {
  for (const key of ["gameEnd", "gameWinner"]) {
    assert.match(web, new RegExp(`\\b${key}\\?:`), `handCut.ts Mark.${key}`);
    assert.match(swift, new RegExp(`var ${key}: `), `HandCut.swift ${key}`);
    assert.match(code, new RegExp(`'${key}'`), `migration reads ${key}`);
  }
  // Both apps send them in the claim only when set.
  assert.match(swift, /try c\.encodeIfPresent\(gameEnd, forKey: \.gameEnd\)/);
  assert.match(web, /if \(m\.gameEnd\) out\.gameEnd = m\.gameEnd;/);
});
