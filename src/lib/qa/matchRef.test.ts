import assert from "node:assert/strict";
import { test } from "node:test";

import { matchOptionLabel, parseMatchRef } from "./matchRef.ts";

const ID = "f070a568-8404-4b1e-9f4b-2c1d3e5a7b90";

test("nothing typed is not an error", () => {
  // A bug in upload or sign in has no match, and saying so must not
  // block the report.
  assert.deepEqual(parseMatchRef(""), { ok: true, id: null });
  assert.deepEqual(parseMatchRef("   "), { ok: true, id: null });
});

test("a bare id is taken as written, in either case", () => {
  assert.deepEqual(parseMatchRef(ID), { ok: true, id: ID });
  assert.deepEqual(parseMatchRef(`  ${ID.toUpperCase()}  `), {
    ok: true,
    id: ID,
  });
});

test("the whole address works, which is what people actually copy", () => {
  for (const text of [
    `https://www.ponglens.com/match/${ID}`,
    `https://www.ponglens.com/match/${ID}?t=132`,
    `www.ponglens.com/match/${ID}/`,
    `/match/${ID}`,
    `http://localhost:3000/match/${ID}#notes`,
  ]) {
    assert.deepEqual(parseMatchRef(text), { ok: true, id: ID }, text);
  }
});

test("a share link is refused by name, not as gibberish", () => {
  // It does resolve to a match, so "that is not a match id" would be
  // both unhelpful and arguable.
  const out = parseMatchRef("https://www.ponglens.com/s/8Kd2mQ4xRt7bLp0aVe");
  assert.equal(out.ok, false);
  assert.match(out.ok === false ? out.message : "", /share link/i);
});

test("the token that started this is refused with instructions", () => {
  // An R2 multipart upload id, lifted off the network tab on /upload by
  // a tester who had no other way to guess what a match id looks like.
  const out = parseMatchRef("4-b9lXnmlon5OQrgm_NsWPWLjVj1VMyz");
  assert.equal(out.ok, false);
  assert.match(out.ok === false ? out.message : "", /paste its whole address/);
});

test("a nearly-right id is still refused", () => {
  assert.equal(parseMatchRef(ID.slice(0, -1)).ok, false);
  assert.equal(parseMatchRef(`${ID}00`).ok, false);
  assert.equal(parseMatchRef(ID.replace("f0", "gg")).ok, false);
});

test("the picker label leads with the date and survives a blank match", () => {
  assert.equal(
    matchOptionLabel({
      played_at: "2026-08-18T00:00:00Z",
      created_at: "2026-08-19T00:00:00Z",
      opponent_name: "Kumar",
      status: "ready",
    }),
    `${new Date("2026-08-18T00:00:00Z").toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    })} · Kumar`,
  );

  // No opponent, no play date: it still has to read as something.
  const bare = matchOptionLabel({
    played_at: null,
    created_at: "2026-08-19T00:00:00Z",
    opponent_name: null,
    status: "ready",
  });
  assert.ok(bare.length > 0);
  assert.ok(!bare.includes("·"));
});

test("a match still processing says so in the label", () => {
  const label = matchOptionLabel({
    played_at: "2026-08-18T00:00:00Z",
    created_at: "2026-08-18T00:00:00Z",
    opponent_name: "Kumar",
    status: "processing",
  });
  assert.match(label, /\(processing\)$/);
});
